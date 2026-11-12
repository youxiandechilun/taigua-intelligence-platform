/*
 * 中文导读：数字员工与话术：personal-playbook.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {workspaceVoiceDelivery,workspaceVoicePolicy,voiceExpressionInstructions} from '../telephony/voice-delivery-policy.js';
import {freezeRecordings} from '../telephony/script-recordings.js';
import {assertFixedCallModel,CALL_VOICE_MODEL} from '../telephony/voice-model-policy.js';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type CrmDb, type Scope, type Row } from '../crm/crm.service.js';
import { publishedRelease, releaseRuntime, assertRuntimeSize } from './agent.release.js';
import { playbookSchema, compilePlaybook, playbookVariables, playbookOpening } from './agent.playbook.js';
import { personalPlaybookRow, personalScript, personalSnapshot, assertPersonalChanges, writePersonalPlaybook } from './personal-playbook.store.js';
import { initialPersonalConfig, personalAgentConfigSchema, type PersonalAgentConfig } from './personal-agent-config.js';
import { validateHandoff } from './agent.handoff.js';
import { presets, realtimeAuthorized } from '../telephony/models.service.js';
import { resolvedVoice } from '../telephony/voices.service.js';
import { voiceAccessible } from '../telephony/voice-options.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import CustomApiError from '../../common/errors/customApiError.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';

const revisionSchema = z.object({ expectedRevision: z.number().int().min(0), baseReleaseId: z.string().min(1).max(200) }).strict();
export const personalPlaybookSaveSchema = revisionSchema.extend({
  playbook: playbookSchema,
  placeholders: z.record(z.string().max(100), z.string().max(4000)).refine(v => Object.keys(v).length <= 100).default({}),
}).strict();
export const personalConfigurationSaveSchema = revisionSchema.extend({ configuration: personalAgentConfigSchema, employee: playbookSchema.shape.employee, aiInstructions: playbookSchema.shape.aiInstructions }).strict();
export const personalRehearsalSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }).strict()).min(1).max(20),
  playbook: playbookSchema,
  placeholders: z.record(z.string().max(100), z.string().max(4000)).refine(v => Object.keys(v).length <= 100).default({}),
}).strict();

export async function effectivePersonalRow(db:CrmDb,s:Scope,agentId:string,release:Row){
  const row=await personalPlaybookRow(db,s,agentId);
  // Follow a newly published shared voice only when the previous selection was
  // the old shared voice. An explicit personal voice must survive reloading.
  const voiceId=release.snapshot.playbook.recordingReplies?.voiceId;
  const baseVoiceId=row?.basePlaybook?.recordingReplies?.voiceId;
  const personalVoiceId=row?.configuration?.profile?.voiceId || row?.playbook?.recordingReplies?.voiceId;
  if(row?.playbook && voiceId && baseVoiceId && voiceId!==baseVoiceId && personalVoiceId===baseVoiceId && (await memberAccess(db,s)).isSystemAdmin){
    row.playbook={...row.playbook,recordingReplies:structuredClone(release.snapshot.playbook.recordingReplies)};
    if(row.configuration)row.configuration={...row.configuration,profile:{...row.configuration.profile,voiceId}};
  }
  return row;
}
export async function employeeRelease(s: Scope, agentId: string, db: CrmDb = crmDb): Promise<Row> {
  const release = await publishedRelease(s, agentId, db);
  const snapshot = personalSnapshot(release.snapshot as Row, await effectivePersonalRow(db, s, agentId, release), s.userId);
  snapshot.profile={...snapshot.profile,audio:{...snapshot.profile.audio,...await workspaceVoiceDelivery(s.workspaceId,db)}};
  snapshot.voiceExpression=voiceExpressionInstructions(await workspaceVoicePolicy(s.workspaceId,db));
  assertRuntimeSize(releaseRuntime(snapshot));
  return { ...release, snapshot };
}
function view(release: Row, row: Row | undefined, userId: string) {
  const snapshot = personalSnapshot(release.snapshot, row, userId);
  return { centralFaqIds: release.snapshot.playbook.faq.map((x:Row)=>x.id), centralObjectionIds: release.snapshot.playbook.objections.map((x:Row)=>x.id), agentName: snapshot.agentName, playbook: snapshot.playbook, placeholders: snapshot.placeholders || {},
    configuration: initialPersonalConfig(snapshot), compiledPrompt: compilePlaybook(snapshot.playbook), updatedAt: row?.updatedAt || null, saved: !!row?.playbook,
    revision: row?.revision ?? 0, baseReleaseId: release.id, source: row?.playbook ? 'personal' : 'company',
    legacyOpening: row?.playbook?.recordingReplies?.openingSource==='generated' && playbookOpening(row.playbook)!==playbookOpening(release.snapshot.playbook) ? playbookOpening(row.playbook) : null,
  };
}
export async function myPlaybook(s: Scope, agentId: string) {
  const release = await publishedRelease(s, agentId);
  const result=view(release, await effectivePersonalRow(crmDb, s, agentId, release), s.userId);
  result.configuration.profile.audio={...result.configuration.profile.audio,...await workspaceVoiceDelivery(s.workspaceId)};
  return result;
}
export async function validateConfiguration(db: CrmDb, s: Scope, next: PersonalAgentConfig, previous: PersonalAgentConfig) {
  if(next.profile.realtimeModel)assertFixedCallModel(next.profile.realtimeModel);
  next.profile.realtimeModel=CALL_VOICE_MODEL;
  if (next.textModelId && next.textModelId !== previous.textModelId) {
    const settings = (await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1', [s.workspaceId]))[0]?.settings || {};
    if (!(settings.enabled || []).includes(next.textModelId) || !presets.some(p => p.kind === 'text' && p.id === next.textModelId)) throw new BadRequestError('请选择公司已开放的文字模型。');
  }
  if (JSON.stringify([next.profile.voiceId, next.profile.voice, next.profile.realtimeModel]) !== JSON.stringify([previous.profile.voiceId, previous.profile.voice, previous.profile.realtimeModel])) {
    const sound = await resolvedVoice(s.workspaceId, next.profile, db);
    await realtimeAuthorized(s.workspaceId, sound.model, db);
    if (next.profile.voiceId) {
      const row = (await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL', [s.workspaceId, next.profile.voiceId]))[0];
      if (!row || !voiceAccessible(row, s.userId)) throw new BadRequestError('该音色未开放给当前账号。');
    }
  }
  next.communication.language = next.profile.language;
}
async function save(s: Scope, agentId: string, input: z.infer<typeof revisionSchema> & { playbook?: z.infer<typeof playbookSchema>; placeholders?: Record<string, string>; configuration?: PersonalAgentConfig; employee?: z.infer<typeof playbookSchema>['employee']; aiInstructions?: string }, reset = false) {
  const result = await crmDb.transaction(async db => {
    const release = await publishedRelease(s, agentId, db), row = await personalPlaybookRow(db, s, agentId);
    if (input.baseReleaseId !== release.id) throw new CustomApiError('统一设置已更新，请读取最新内容后保存。', 409);
    const prior = personalSnapshot(release.snapshot, await effectivePersonalRow(db,s,agentId,release), s.userId);
    const candidate = personalScript(reset ? release.snapshot.playbook : input.playbook || {...prior.playbook,...(input.employee?{employee:input.employee}:{}),...(input.aiInstructions!==undefined?{aiInstructions:input.aiInstructions}:{})});
    if(input.configuration || input.employee || input.aiInstructions!==undefined) throw new ForbiddenError('参数已改为统一管理，请由超级管理员在统一设置中保存并发布。');
    if(!reset)assertPersonalChanges(prior,candidate,release.snapshot.playbook,input.placeholders||prior.placeholders||{});
    await freezeRecordings(s,agentId,candidate,db);
    await validateHandoff(db, s.workspaceId, s.userId, candidate.handoff, prior.playbook.handoff, true);
    const placeholders = playbookVariables(candidate, reset ? release.snapshot.placeholders || {} : input.placeholders || prior.placeholders || {}).placeholders;
    const configuration = structuredClone(input.configuration || initialPersonalConfig(reset ? release.snapshot : prior));
    configuration.profile.audio={...configuration.profile.audio,...await workspaceVoiceDelivery(s.workspaceId,db)};
    if(candidate.recordingReplies?.voiceId)configuration.profile={...configuration.profile,voiceId:candidate.recordingReplies.voiceId,realtimeModel:CALL_VOICE_MODEL,voice:''};
    await validateConfiguration(db, s, configuration, initialPersonalConfig(prior));
    assertRuntimeSize(releaseRuntime(personalSnapshot(release.snapshot, { basePlaybook: release.snapshot.playbook, playbook: candidate, placeholders, configuration, revision: input.expectedRevision + 1, baseReleaseId: release.id }, s.userId)));
    // Keep historical personal script and recording references intact; only the
    // account's voice preference is updated in configuration.
    const retainedPlaybook = row?.playbook || candidate;
    const updated = await writePersonalPlaybook(db, s, agentId, { ...input, baseReleaseId: release.id, playbook: retainedPlaybook, placeholders, configuration });
    return view(release, {...updated,basePlaybook:release.snapshot.playbook}, s.userId);
  });
  await recordAuditEvent({ organizationId: s.workspaceId, userId: s.userId, action: reset ? 'agent.personal-playbook.reset' : 'agent.personal-configuration.saved', resourceType: 'agent', resourceId: agentId, metadata: { revision: result.revision } });
  return result;
}
export const saveMyPlaybook = (s: Scope, agentId: string, raw: unknown, reset = false) => save(s, agentId, reset ? revisionSchema.parse(raw) : personalPlaybookSaveSchema.parse(raw), reset);
export const saveMyConfiguration = (s: Scope, agentId: string, raw: unknown) => save(s, agentId, personalConfigurationSaveSchema.parse(raw));
