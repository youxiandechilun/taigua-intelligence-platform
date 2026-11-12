/*
 * 中文导读：数字员工与话术：personal-playbook.store.ts。维护共享状态及读写辅助。
 */
import type { CrmDb, Scope, Row } from '../crm/crm.service.js';
import { isDeepStrictEqual } from 'node:util';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import CustomApiError from '../../common/errors/customApiError.js';
import { compilePlaybook, normalizeScript, playbookOpening, playbookSchema, releasePlaybook, type ConversationPlaybook } from './agent.playbook.js';
import { initialPersonalConfig, personalAgentConfigSchema, type PersonalAgentConfig } from './personal-agent-config.js';

// The actor always comes from the authenticated session. There is intentionally
// no caller-supplied owner for personal edits. The separate super-admin sync
// service authorizes each target before invoking this store.
export async function personalPlaybookRow(db: CrmDb, s: Scope, agentId: string) {
  const row = (await db.query('SELECT * FROM "EmployeePlaybook" WHERE "workspaceId"=$1 AND "userId"=$2 AND "agentId"=$3', [s.workspaceId, s.userId, agentId]))[0];
  if (row?.baseReleaseId) row.basePlaybook = (await db.query('SELECT "snapshot" FROM "AgentRelease" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3', [s.workspaceId, agentId, row.baseReleaseId]))[0]?.snapshot?.playbook;
  return row;
}

export function personalScript(input: ConversationPlaybook): ConversationPlaybook {
  return releasePlaybook(normalizeScript(playbookSchema.parse(input)));
}

// Script text comes from the published company version. Personal rows retain
// voice preferences and remain in storage for historical review.
export function personalSnapshot(snapshot: Row, row: Row | undefined, ownerId: string): Row {
  const playbook = structuredClone(personalScript(snapshot.playbook));
  const personal = row?.playbook;
  const ownVoice = row?.configuration?.profile?.voiceId || personal?.recordingReplies?.voiceId;
  const manifest = structuredClone(playbook.recordingReplies || {version:1 as const,entries:{}});
  const companyVoice = playbook.recordingReplies?.voiceId || snapshot.profile?.voiceId;
  if (ownVoice && ownVoice !== companyVoice) {
    manifest.voiceId = ownVoice;
    // A voice library recording is a separate piece of speech. A different
    // personal voice must speak the published text instead of substituting it.
    delete manifest.openingSource;
    delete manifest.entries['opening-recordings'];
  } else if (ownVoice) {
    manifest.voiceId = ownVoice;
  }
  if(ownVoice && ownVoice!==companyVoice) {
    for(const [key,entry] of Object.entries(manifest.entries)) if(key!=='opening-recordings' && entry.clips.some(clip=>(clip.voiceId||snapshot.playbook.recordingReplies?.voiceId)!==ownVoice)) manifest.entries[key]={mode:'ai',clips:[]};
  }
  if(snapshot.playbook.recordingReplies || ownVoice)playbook.recordingReplies=manifest;
  const configuration=initialPersonalConfig(snapshot);
  if(ownVoice)configuration.profile={...configuration.profile,voiceId:ownVoice,voice:''};
  return {...snapshot,...configuration,playbook,placeholders:snapshot.placeholders||{},
    opening:playbookOpening(playbook),compiledPrompt:compilePlaybook(playbook),
    scriptSelection:{source:'managed',ownerId,revision:row?.revision??0,baseReleaseId:row?.baseReleaseId}};
}

export function assertPersonalChanges(prior: Row, candidate: ConversationPlaybook, central: ConversationPlaybook, placeholders: Record<string,string>) {
  const before=prior.playbook.recordingReplies,after=candidate.recordingReplies;
  const protectedPart = (p: ConversationPlaybook) => {
    const {recordingReplies,...rest}=structuredClone(personalScript(p));
    return rest;
  };
  if(!isDeepStrictEqual(protectedPart(prior.playbook),protectedPart(candidate)) || !isDeepStrictEqual(prior.placeholders||{},placeholders))
    throw new ForbiddenError('话术由管理员统一维护，你可以选择通话声音。');
  const changedVoice=before?.voiceId!==after?.voiceId;
  if(!changedVoice){if(!isDeepStrictEqual(before,after))throw new ForbiddenError('话术录音由管理员统一维护。');return;}
  if(!after?.voiceId||after.openingSource)throw new ForbiddenError('请选择声音库中的通话声音。');
  const expected=Object.fromEntries(Object.keys(before?.entries||{}).filter(key=>key!=='opening-recordings').map(key=>[key,{mode:'ai',clips:[]}]));
  if(!isDeepStrictEqual(after.entries,expected))throw new ForbiddenError('更换声音时不能修改话术录音。');
}

export async function writePersonalPlaybook(db: CrmDb, s: Scope, agentId: string, input: {
  expectedRevision: number; baseReleaseId: string; playbook: ConversationPlaybook | null; placeholders: Record<string, string>; configuration: PersonalAgentConfig;
}) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['employee-playbook:' + s.workspaceId + ':' + s.userId + ':' + agentId]);
  const previous = await personalPlaybookRow(db, s, agentId);
  if ((previous?.revision ?? 0) !== input.expectedRevision) throw new CustomApiError('你的数字员工设置已在其他页面更新，请导出当前修改，再读取最新内容。', 409);
  // A reset keeps a revision tombstone so an older browser tab cannot overwrite it.
  return (await db.query('INSERT INTO "EmployeePlaybook" ("workspaceId","userId","agentId","playbook","placeholders","baseReleaseId","configuration") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb) ON CONFLICT ("workspaceId","userId","agentId") DO UPDATE SET "playbook"=EXCLUDED."playbook","placeholders"=EXCLUDED."placeholders","baseReleaseId"=EXCLUDED."baseReleaseId","configuration"=EXCLUDED."configuration","revision"="EmployeePlaybook"."revision"+1,"updatedAt"=NOW() RETURNING *',
    [s.workspaceId, s.userId, agentId, input.playbook ? JSON.stringify(input.playbook) : null, JSON.stringify(input.placeholders), input.baseReleaseId, JSON.stringify(input.configuration)]))[0]!;
}
