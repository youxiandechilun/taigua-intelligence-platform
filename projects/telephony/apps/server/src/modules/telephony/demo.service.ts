/*
 * 中文导读：线路与语音外呼：demo.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { createHash } from 'node:crypto';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type CrmDb, type Row, type Scope } from '../crm/crm.service.js';
import { employeeRelease } from '../agent/personal-playbook.service.js';
import { assertAgentUse } from '../agent/agent.release.js';
import { grants } from '../workspace/company-policy.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { generateVoicePreview } from './employee-voice-preview.js';
import { resolveEmployeeSound } from './personal-voice.service.js';
import { createTask, taskAction } from './sip.service.js';
import { liveTranscriptStore } from '../../realtime/live-transcript.runtime.js';
import { notifyDemoQueued } from './sip-demo-priority.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import CustomApiError from '../../common/errors/customApiError.js';
import { demoCallSchema, demoLanguageSchema, demoScriptSchema, demoPreviewSchema, demoSaveSchema, emptyDemoScript, inferDemoLanguage, normalizeDemoConfiguration, readyDemoLanguages, type DemoConfiguration, type DemoLanguage, type DemoLanguageConfiguration } from './demo.schema.js';
import {canManageScripts, requireScriptManager} from '../agent/script-access.js';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeDemoWhere = `t."workspaceId"=$1 AND t."createdBy"=$2 AND t."snapshot"->>'demoCall'='true' AND t."deletedAt" IS NULL AND (t."status" IN ('DRAFT','RUNNING','PAUSED','NEEDS_REVIEW') OR EXISTS(SELECT 1 FROM "SipAttempt" a WHERE a."workspaceId"=t."workspaceId" AND a."taskId"=t."id" AND a."status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')))`;
async function rowFor(s: Scope, agentId: string, db: CrmDb = crmDb) {
  return (await db.query('SELECT "configuration","revision","updatedAt" FROM "AgentDemoConfiguration" WHERE "workspaceId"=$1 AND "agentId"=$2', [s.workspaceId, agentId]))[0];
}
async function savedConfiguration(s: Scope, agentId: string, revision: number, db: CrmDb = crmDb) {
  await assertAgentUse(s, agentId, db);
  const row = await rowFor(s, agentId, db);
  if (!row || row.revision !== revision) throw new CustomApiError('演示话术已更新，请保存或重新读取后操作。', 409);
  return normalizeDemoConfiguration(row.configuration);
}
function selectedScript(configuration: DemoConfiguration, language: DemoLanguage): DemoLanguageConfiguration {
  const parsed = demoScriptSchema.safeParse(configuration.languages[language]);
  if (!parsed.success) throw new BadRequestError(language === 'en' ? '英文演示尚未完整配置，请先填写并保存英文开场白和问答。' : '中文演示尚未完整配置，请先填写并保存中文开场白和问答。');
  return parsed.data;
}
function frozenLanguage(snapshot: Row, script: DemoLanguageConfiguration): DemoLanguage {
  const stored = demoLanguageSchema.safeParse(snapshot.demoLanguage);
  return stored.success ? stored.data : inferDemoLanguage(script);
}
function canonicalRequest(snapshot: Row) {
  const script = demoScriptSchema.safeParse(snapshot.demoConfiguration);
  if (!script.success || !snapshot.demoRequest || typeof snapshot.demoRequest !== 'object') return null;
  const parsed = demoCallSchema.safeParse({ ...snapshot.demoRequest, language: snapshot.demoRequest.language || frozenLanguage(snapshot, script.data) });
  return parsed.success ? parsed.data : null;
}
function requireExplicitLanguage(raw: unknown) {
  if (raw && typeof raw === 'object' && !('language' in raw)) throw new BadRequestError('演示语言设置已更新，请刷新页面后重新选择中文或英语。');
}
async function soundFor(s: Scope, agentId: string, configuration: DemoLanguageConfiguration, language: DemoLanguage, db: CrmDb = crmDb) {
  const content = (await employeeRelease(s, agentId, db)).snapshot as Row;
  content.profile = { ...content.profile, language };
  const sound = await resolveEmployeeSound(s, agentId, content, 'HAOKEHU_SIP', db, configuration.voiceId ? { choice: 'library:' + configuration.voiceId, volume: content.profile.audio.volume } : undefined);
  return { content, sound };
}
export async function demoConfiguration(s: Scope, agentId: string) {
  const [release, row, access, pending] = await Promise.all([employeeRelease(s, agentId), rowFor(s, agentId), memberAccess(crmDb, s),crmDb.query(`SELECT t."snapshot" FROM "SipTask" t WHERE ${activeDemoWhere} ORDER BY t."createdAt" DESC LIMIT 1`,[s.workspaceId,s.userId])]);
  const content = release.snapshot as Row;
  const configuration: DemoConfiguration = row ? normalizeDemoConfiguration(row.configuration) : { version: 2, languages: { 'zh-CN': emptyDemoScript(), en: emptyDemoScript() } };
  return { agentId, agentName: content.agentName, revision: row?.revision ?? 0, updatedAt: row?.updatedAt || null,
    configuration, readyLanguages: readyDemoLanguages(configuration),
    canEdit: grants(access.permissions, 'agentConfiguration', 'update') && await canManageScripts(s),pendingCall:pending[0] ? canonicalRequest(pending[0].snapshot) : null };
}
export async function saveDemoConfiguration(s: Scope, agentId: string, raw: unknown) {
  const data = demoSaveSchema.parse(raw);
  await crmDb.transaction(async db => {
    await requireScriptManager(s, db);
    if (!grants((await memberAccess(db,s)).permissions, 'agentConfiguration', 'update')) throw new ForbiddenError('演示话术由获授权的培训负责人修改。');
    const writeGate = (await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired', ['agent-demo-config-write']))[0];
    if (!writeGate?.acquired) throw new CustomApiError('系统正在更新，请稍后保存，当前输入已保留。', 409);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['agent-demo:' + s.workspaceId + ':' + agentId]);
    for (const language of readyDemoLanguages(data.configuration)) await soundFor(s, agentId, selectedScript(data.configuration, language), language, db);
    const prior = await rowFor(s, agentId, db);
    if ((prior?.revision ?? 0) !== data.expectedRevision) throw new CustomApiError('演示话术已在其他页面更新，请重新读取后保存。', 409);
    await db.query('INSERT INTO "AgentDemoConfiguration" ("workspaceId","agentId","configuration","updatedBy") VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "configuration"=EXCLUDED."configuration","revision"="AgentDemoConfiguration"."revision"+1,"updatedBy"=EXCLUDED."updatedBy","updatedAt"=NOW() RETURNING "revision"', [s.workspaceId, agentId, JSON.stringify(data.configuration), s.userId]);
  });
  await recordAuditEvent({ organizationId:s.workspaceId, userId:s.userId, action:'agent.demo.saved', resourceType:'agent', resourceId:agentId });
  return demoConfiguration(s, agentId);
}
export async function previewDemo(s: Scope, agentId: string, raw: unknown) {
  requireExplicitLanguage(raw);
  const data = demoPreviewSchema.parse(raw), configuration = selectedScript(await savedConfiguration(s,agentId,data.expectedRevision), data.language);
  const text = data.key === 'opening' ? configuration.opening : data.key === 'fallback' ? configuration.fallback : data.key.startsWith('qa:') ? configuration.qa.find(row => row.id === data.key.slice(3))?.answer : undefined;
  if (!text) throw new BadRequestError('请选择已保存的演示话术试听。');
  const { content, sound } = await soundFor(s,agentId,configuration,data.language);
  return generateVoicePreview(s,agentId,{ profile:{ ...content.profile,voiceId:sound.voiceId,realtimeModel:sound.model,voice:sound.voice }, text,requestId:data.requestId,retryOf:data.retryOf,confirmed:true });
}
export async function startDemoCall(s: Scope, raw: unknown) {
  requireExplicitLanguage(raw);
  const data = demoCallSchema.parse(raw), requestFingerprint = fingerprint(data);
  const draft = await crmDb.transaction(async db => {
    if (!grants((await memberAccess(db,s)).permissions,'outboundCalls','create')) throw new ForbiddenError('当前账号不能拨打演示电话。');
    await assertAgentUse(s, data.agentId, db);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['agent-demo-launch:' + s.workspaceId + ':' + s.userId]);
    const existing = (await db.query('SELECT "id","workspaceId","createdBy","snapshot","deletedAt" FROM "SipTask" WHERE "id"=$1',[data.requestId]))[0];
    if (existing) {
      const canonical = existing.snapshot?.demoCall === true ? canonicalRequest(existing.snapshot) : null;
      if (existing.workspaceId!==s.workspaceId || existing.createdBy!==s.userId || existing.deletedAt || existing.snapshot?.demoCall!==true || (existing.snapshot.demoRequestFingerprint!==requestFingerprint && (!canonical || fingerprint(canonical)!==requestFingerprint))) throw new BadRequestError('这个演示请求已使用，请重新打开拨打窗口。');
      return { id:existing.id as string };
    }
    if (Math.abs(Date.now()-Date.parse(data.requestedAt))>5*60000) throw new BadRequestError('演示请求已过期，请重新打开拨打窗口。');
    // An expired, never-submitted draft cannot place a call. Retain its audit
    // row but release the user's demo slot even if its browser was closed.
    await db.query(`UPDATE "SipTask" t SET "deletedAt"=NOW(),"updatedAt"=NOW() WHERE t."workspaceId"=$1 AND t."createdBy"=$2 AND t."snapshot"->>'demoCall'='true' AND t."deletedAt" IS NULL AND t."status"='DRAFT' AND t."endTime"<=NOW() AND NOT EXISTS(SELECT 1 FROM "SipAttempt" a WHERE a."workspaceId"=t."workspaceId" AND a."taskId"=t."id") RETURNING t."id"`,[s.workspaceId,s.userId]);
    const active = await db.query(`SELECT t."id" FROM "SipTask" t WHERE ${activeDemoWhere} LIMIT 1`,[s.workspaceId,s.userId]);
    if (active.length) throw new BadRequestError('你还有未结束或待核对的演示电话，请先查看已有演示状态。');
    const configuration = selectedScript(await savedConfiguration(s,data.agentId,data.expectedRevision,db), data.language);
    return createTask(s,{
      requestId:data.requestId,agentId:data.agentId,name:'数字员工演示',parallelism:1,provider:'HAOKEHU_SIP',
      ...(data.lineId?{lineId:data.lineId}:{}),...(data.province?{province:data.province}:{}),
      recipients:[{phoneNumber:data.phoneNumber,name:'演示接听人',variables:{}}],startTime:data.requestedAt,endTime:new Date(Date.parse(data.requestedAt)+5*60000).toISOString(),
    },{db,testCall:true,demo:{configuration,language:data.language,revision:data.expectedRevision,requestFingerprint,request:data}});
  });
  const current = await demoCallStatus(s,draft.id);
  if (current.taskStatus==='DRAFT') {
    try { await taskAction(s,draft.id,'start',draft.id); }
    catch (error) { if ((await demoCallStatus(s,draft.id)).taskStatus==='DRAFT') throw error; }
  }
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'agent.demo-call.requested',resourceType:'SipTask',resourceId:draft.id,metadata:{agentId:data.agentId,revision:data.expectedRevision}});
  const status = await demoCallStatus(s,draft.id);
  if (status.taskStatus === 'RUNNING') notifyDemoQueued();
  return status;
}

function normalized(value:string) { return value.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,''); }
// The UI identifies this as a transcript match, never the model's internal state.
function matchAnswer(configuration:DemoLanguageConfiguration,transcript:Array<{speaker:string;text:string}>) {
  const answer = [...transcript].reverse().find(row=>['assistant','agent'].includes(row.speaker));
  if(!answer)return null;
  const text=normalized(answer.text);
  if(!text || text===normalized(configuration.opening) || text===normalized(configuration.fallback))return null;
  return configuration.qa.find(row=>normalized(row.answer)===text)?.id || null;
}
export async function demoCallStatus(s: Scope, id: string) {
  await memberAccess(crmDb,s);
  const row = (await crmDb.query('SELECT "id","agentId","status","snapshot","error" FROM "SipTask" WHERE "workspaceId"=$1 AND "createdBy"=$2 AND "id"=$3 AND "deletedAt" IS NULL',[s.workspaceId,s.userId,id]))[0];
  if(!row || row.snapshot?.demoCall!==true)throw new NotFoundError('演示记录不存在或不属于当前账号。');
  const configuration = demoScriptSchema.parse(row.snapshot.demoConfiguration);
  const attempt = (await crmDb.query('SELECT "id","status","result" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 ORDER BY "attemptNumber" DESC LIMIT 1',[s.workspaceId,id]))[0];
  const callId = attempt?.id as string|undefined;
  const [stored, live, call] = callId ? await Promise.all([
    crmDb.query('SELECT "speaker","messageText","timestamp" FROM "CallTranscript" WHERE "callLogId"=$1 ORDER BY "timestamp","callTransId" LIMIT 1000',[callId]),
    liveTranscriptStore.readTranscriptHistory(s.workspaceId,callId).catch(()=>[]),
    crmDb.query('SELECT "audioRecordingPath","endTime","metadata" FROM "CallLog" WHERE "organizationId"=$1 AND "callId"=$2 AND "userId"=$3 AND "deleted"=false',[s.workspaceId,callId,s.userId]),
  ]) : [[],[],[]];
  const transcript = stored.length ? stored.map(t=>({speaker:t.speaker as string,text:t.messageText as string,timestamp:new Date(t.timestamp).toISOString()})) : live.slice(-1000).map(t=>({speaker:t.speaker,text:t.text,timestamp:t.timestamp}));
  const recordingAvailable = !!call[0]?.audioRecordingPath && !call[0]?.metadata?.recordingExpiredAt && (!call[0]?.endTime || new Date(call[0].endTime).getTime()>=Date.now()-72*3600*1000);
  return {id:row.id as string,agentId:row.agentId as string,taskStatus:row.status as string,status:(attempt?.status||row.status) as string,attemptId:callId||null,callId:callId||null,
    error:(row.error||attempt?.result?.reason||'') as string,diagnostics:attempt?.result?.diagnostics||null,durationSeconds:Number(attempt?.result?.durationSeconds)||0,agentName:row.snapshot.agentName as string,voiceName:(row.snapshot.employeeVoice?.name||'') as string,maxDurationSeconds:Number(row.snapshot.maxDurationSeconds)||180,
    demoCall:true as const,language:frozenLanguage(row.snapshot,configuration),revision:row.snapshot.demoRevision as number,configuration,transcript,matchedQuestionId:matchAnswer(configuration,transcript),progressSource:'transcript-match' as const,
    recordingAvailable,recordingUrl:recordingAvailable?'/api/v1/telephony/recordings/'+callId:null};
}
