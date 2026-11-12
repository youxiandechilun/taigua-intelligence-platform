/*
 * 中文导读：SIP 外呼任务的创建、预览、继续和控制；将页面操作转换为带工作区范围的业务操作。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import { freezeRecordingLearning, assertRecordingLearningSnapshot } from '../recording-learning/learning.service.js';
import { RECORDING_LEARNING_ENABLED } from '../recording-learning/learning-availability.js';
import { recognitionRules } from '../crm/intent-recognition.js';
import {applyDemoSnapshot,type DemoLaunch} from './demo-runtime.js';
import {taskDialStatus} from './task-dial-status.js';
import {taskContinuationIndices} from './task-continuation.js';
import {inDialWindow} from './dial-policy.js';
export {inDialWindow} from './dial-policy.js';
import {freezeCallVoiceConfiguration} from './call-voice-configuration.js';
import {readyVoiceOpening} from './voice-opening-store.js';
import {compilePlaybook} from '../agent/agent.playbook.js';
import {completeSystemSpeech} from '../agent/system-speech-defaults.js';
import { carrierWindowOpen, carrierRecipientIssues, carrierBatchSummary } from './carrier-policy.js';
import {freezeRecordings,assertPublishedOpening} from './script-recordings.js';
import {assertFixedCallModel} from './voice-model-policy.js';
import {z} from 'zod';
import {withinCallLimit} from './call-limits.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { assertAgentUse, releaseRuntime, taskRuntime } from '../agent/agent.release.js';
import { employeeRelease } from '../agent/personal-playbook.service.js';
import { withCurrentAgentNames } from '../agent/agent-display-name.js';
import { taskParallelism, parallelismUpdateSchema } from './task-parallelism.js';
import { assertTaskParallelism, taskParallelismLimit } from './outbound-parallelism.settings.js';
import {taskRecipientOutcomes,taskOutcomeCounts,taskResultStats,emptyTaskResultStats} from './task-outcomes.js';
import {taskRetryPolicy,taskRetryUpdateSchema,retryCandidates,queueTaskRetry} from './task-retry.js';
import { resolveEmployeeSound,assertFrozenEmployeeSound } from './personal-voice.service.js';
import { engineTaskLine, assertEngineReady } from './aliyun-engine.service.js';
import { taskLineSummary } from './task-line-summary.js';
import { requestedTask, storeTaskDraft } from './task-creation.js';
import {resolveDataOwner} from '../workspace/company-access.js';
import { canViewAllOutbound, visibleOutboundTask, visibleOutboundTasks } from './task-visibility.js';
import {visibleOutboundTaskPage,type TaskPageOptions} from './task-query.js';
import {detachTaskPauseBatch} from './task-bulk-state.js';
import { grants } from '../workspace/company-policy.js';
import {callbackConnection} from './callback.settings.js';
import {credentialScope} from './model-credentials.js';
import {catalog as modelCatalog} from './models.service.js';
export { ingestEvent } from './sip.events.js';
import { resolveRecipientLines, assertSharedLine, defaultLine, defaultLineConfiguration, provinces, isLineDispatchable, readLineHealth } from './routing.service.js';
import { resolvedVoice } from './voices.service.js';
import { realtimeAuthorized } from './models.service.js';
import { isDeepStrictEqual } from 'node:util';
import { sameTaskLine, sameTaskRoutes } from './task-line-compatibility.js';
import { redialLineIdSchema, selectedRedialLine, makeRedialLineOverride, resolveSipAttemptRoutes } from './redial-line.js';
import { switchQueuedResumeLine, type ResumeLine } from './resume-line.js';
import type { RouteChoice } from './routing.service.js';
import { softDeleteOutboundTask } from './task-deletion.js';
import { randomUUID } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { crmDb } from '../crm/crm.db.js';
import { type CrmDb, type Scope, type Row, memberAccess } from '../crm/crm.service.js';
import { assertCustomerRecipients } from '../crm/crm.recipients.js';
import { assertCrmDialable } from '../crm/crm.calls.js';
import { companyContext } from '../workspace/company-access.js';
import { knowledgeContext } from '../kb/workspace-knowledge.js';
import { lineSchema, sipProfileSchema, sipTaskSchema, type LineSettings } from './sip.schema.js';
import { holidayStatus } from './dial-policy.js';
import {notifyCallPriorityQueued} from './sip-demo-priority.js';

import { bridgeRequest } from './bridge-client.js';
export { bridgeRequest } from './bridge-client.js';
export async function bridgeReadiness(mode: "AI" | "MANUAL" = "AI",workspaceId?:string) {
  const fallback={ready:false,connected:false,executionEnabled:false,missing:['电话服务未启动'],voice:'',model:''};
  if (!process.env.SIP_BRIDGE_TOKEN) return {...fallback,missing:['电话服务配置']};
  try {
    const info = await (await bridgeRequest('/health'+(workspaceId?'?scope='+credentialScope(workspaceId):''))).json() as { switchReady?: boolean; externalReady?:boolean; executionEnabled?:boolean; modelConfigured?: boolean; voice?: string; model?: string };
    const connected=!!info.switchReady&&info.externalReady===true,executionEnabled=info.executionEnabled===true;
    return {connected,executionEnabled,ready:connected&&executionEnabled&&(mode==='MANUAL'||!!info.modelConfigured),missing:[!info.switchReady?'电话服务连接':'',info.switchReady&&!info.externalReady?'外线网络配置':'',!executionEnabled?'真实通话联调开关': '',mode==='AI'&&!info.modelConfigured?'实时语音模型密钥':''].filter(Boolean),voice:info.voice||'',model:info.model||''};
  } catch { return fallback; }
}
export async function settings(workspaceId: string, db: CrmDb = crmDb): Promise<LineSettings> {
  return defaultLine(workspaceId, db);
}
export function lineMissing(line: LineSettings) {
  return [!line.serverIp ? '线路服务器 IP' : '', line.callerMode!=='provider'&&!line.callerNumber ? '主叫号码' : '', !line.whitelistConfirmed ? '服务器白名单确认' : ''].filter(Boolean);
}
export async function configuration(s: Scope) {
  const [context,stored,bridge,models,seat]=await Promise.all([companyContext(s.workspaceId,s.userId),defaultLineConfiguration(s.workspaceId),bridgeReadiness('AI',s.workspaceId),modelCatalog(s),crmDb.query('SELECT "phone","available" FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 AND "deletedAt" IS NULL',[s.workspaceId,s.userId])]);
  const line=stored.line;
  const lineHealth=await readLineHealth(s.workspaceId,line);
  const now=new Date(),holiday=holidayStatus(line.dialPolicy,now);
  const shared=[stored.removed?'默认线路已移除，请先恢复后配置':'',...lineMissing(line),!bridge.connected?'电话服务连接':'',!bridge.executionEnabled?'真实通话联调开关':'',!line.liveEnabled?'线路通话开关':'',!holiday.calendarReady?holiday.message:''].filter(Boolean);
  const manualMissing=[...shared,!withinCallLimit(line.concurrency,0,2)?'线路并发额度（至少2路）':'',!withinCallLimit(line.callsPerSecond,0,2)?'每秒拨号额度（当前人工桥接需至少2路）':'',!seat[0]?.phone?'员工接听号码':'',!seat[0]?.available?'员工在岗状态':''].filter(Boolean);
  const callback=await callbackConnection(s.workspaceId);
  const callbackEmployee=callback?(await crmDb.query('SELECT e."ready",e."phone" FROM "CallbackEmployee" e WHERE e."workspaceId"=$1 AND e."userId"=$2',[s.workspaceId,s.userId]))[0]:null;
  const callbackMissing=callback?[!callback.settings.enabled?'人工回拨开关':'',!callback.connected?'回拨接口连接':'',!callbackEmployee?.ready||callbackEmployee.phone!==seat[0]?.phone?'员工接听号码同步':'',!seat[0]?.phone?'员工接听号码':'',!seat[0]?.available?'员工在岗状态':''].filter(Boolean):[];
  const aiMissing=[...shared,!models.models.some(m=>m.kind==='realtime'&&m.enabled)?'实时语音模型授权':'',!models.models.some(m=>m.kind==='realtime'&&m.enabled&&m.configured)?'实时语音模型密钥':''].filter(Boolean);
  return {
    ...(context.isSystemAdmin?line:{name:line.name,serviceProvider:line.serviceProvider,callerMode:line.callerMode,callerNumber:line.callerNumber,concurrency:line.concurrency,liveEnabled:line.liveEnabled,dialPolicy:line.dialPolicy}),
    revision:configurationRevision(line),canConfigure:context.isSystemAdmin,canManage:context.canManage,removed:stored.removed,engineConnected:bridge.connected,executionEnabled:bridge.executionEnabled,
    manualProvider:callback?'HAOKEHU_CALLBACK':'HAOKEHU_SIP',manualControls:!callback,manualServiceReady:callback?callback.connected:bridge.connected&&bridge.executionEnabled,manualReady:callback?callbackMissing.length===0:shared.length===0&&withinCallLimit(line.concurrency,0,2)&&withinCallLimit(line.callsPerSecond,0,2),
    dialWindowOpen:inDialWindow(line.dialPolicy,now)&&holiday.allowed,
    dialWindowMessage:!holiday.allowed?holiday.message:!inDialWindow(line.dialPolicy,now)?'当前不在允许的拨打时间或星期内':'',
    configured:lineMissing(line).length===0,serviceReady:bridge.ready,ready:aiMissing.length===0,
    missing:context.isSystemAdmin?aiMissing:[],manualMissing:context.isSystemAdmin||context.canManage?(callback?callbackMissing:manualMissing):[],aiMissing:context.isSystemAdmin||context.canManage?aiMissing:[],
    defaultVoice:bridge.voice,model:context.isSystemAdmin?bridge.model:'',lineHealth,
  };
}
export async function agentReadiness(s:Scope,agentId:string){
 const agent=await prisma.agent.findFirst({where:{organizationId:s.workspaceId,agentId,deletionRequestedAt:null},include:{configuration:true}});
 if(!agent)throw new NotFoundError('数字员工不存在。');
 const [models,connection,release]=await Promise.all([modelCatalog(s),configuration(s),employeeRelease(s,agentId)]);
 const playbook=release.snapshot;
 let voiceReady=true,model:string=playbook.profile.realtimeModel||'qwen-audio-3.1-realtime-plus';
 try{model=(await resolveEmployeeSound(s,agentId,playbook,'HAOKEHU_SIP')).model;}catch{voiceReady=false;}
 const selected=models.models.find(m=>m.id===model);
 const missing=[...connection.aiMissing.filter(v=>!v.startsWith('实时语音模型')), (!agent.isActive)?'数字员工启用状态':'',!playbook.opening?.trim()?'开场话术':'',!playbook.compiledPrompt?.trim()?'对话话术':'',!selected?.enabled?'所选语音模型授权':'',!selected?.configured?'所选语音模型密钥':'',!voiceReady?'可用通话音色':''].filter(Boolean);
 return {ready:missing.length===0,missing,model,defaultModel:process.env.SIP_REALTIME_MODEL||'qwen-audio-3.1-realtime-plus',voiceReady,hasOpening:!!playbook.opening?.trim(),hasPlaybook:!!playbook.compiledPrompt?.trim(),scriptSource:playbook.scriptSelection.source};
}
export async function saveLine(s: Scope, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('线路参数仅系统超级管理员可以修改。');
  const {provinces:selectedProvinces,expectedRevision,expectedScopeRevision,...line}=lineSchema.extend({expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),expectedScopeRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),provinces:z.array(z.enum(provinces)).max(31).transform(value=>[...new Set(value)]).optional()}).parse(input);
  if (!holidayStatus(line.dialPolicy,new Date()).calendarReady) throw new BadRequestError('当前年度节假日安排尚未设置，请先完善安排，或取消“避开法定节假日”，按时间与星期拨打。');
  if (line.liveEnabled && (lineMissing(line).length || !(await bridgeReadiness("MANUAL")).ready)) throw new BadRequestError('先完成线路参数、白名单和电话服务配置，再启用外呼。');
  await crmDb.transaction(async d => {
    await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-line-config']);
    const stored=await defaultLineConfiguration(s.workspaceId,d);
    if(stored.removed)throw new BadRequestError('默认线路已移除，请先恢复后再修改配置。');
    const prior = stored.line;
    assertConfigurationRevision(expectedRevision,prior);
    if(selectedProvinces){const current=(await d.query('SELECT "provinces" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1',[s.workspaceId]))[0];assertConfigurationRevision(expectedScopeRevision,[...(current?.provinces||['广东'])].sort());}
    const priorStored=(await d.query('SELECT "settings" FROM "SipConnection" WHERE "workspaceId"=$1',[s.workspaceId]))[0]?.settings;
    for(const key of [...new Set([prior.trunkKey,line.trunkKey])].sort())await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-trunk:'+key]);
    if (prior.trunkKey !== line.trunkKey && (await d.query(`SELECT "id" FROM "SipTask" WHERE "workspaceId"=$1 AND "status" IN ('RUNNING','PAUSED','NEEDS_REVIEW') LIMIT 1`, [s.workspaceId])).length) throw new BadRequestError('请先结束或核对现有任务，再变更线路共享标识。');
    await assertSharedLine(d,line,s.workspaceId);
    const priorHealth=priorStored&&typeof priorStored==='object'&&!Array.isArray(priorStored)?(priorStored as Row).health:null;
    await d.query('INSERT INTO "SipConnection" ("workspaceId","settings") VALUES ($1,$2::jsonb) ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=(EXCLUDED."settings"-\'health\')||CASE WHEN "SipConnection"."settings" ? \'health\' THEN jsonb_build_object(\'health\',"SipConnection"."settings"->\'health\') ELSE \'{}\'::jsonb END,"updatedAt"=NOW() RETURNING "workspaceId"', [s.workspaceId, JSON.stringify(priorHealth ? { ...line, health: priorHealth } : line)]);
    if(selectedProvinces)await d.query('INSERT INTO "SipDefaultLineScope"("workspaceId","provinces") VALUES ($1,$2::text[]) ON CONFLICT ("workspaceId") DO UPDATE SET "provinces"=EXCLUDED."provinces","updatedAt"=NOW() RETURNING "workspaceId"',[s.workspaceId,selectedProvinces]);
  });
  await prisma.auditLog.create({ data: { organizationId: s.workspaceId, userId: s.userId, action: 'SIP_LINE_UPDATED', resourceType: 'SipConnection', resourceId: s.workspaceId, metadata: { liveEnabled: line.liveEnabled } } });
  return configuration(s);
}
export async function agentProfile(s: Scope, agentId: string) {
  if (!await prisma.agent.findFirst({ where: { organizationId: s.workspaceId, agentId, deletionRequestedAt: null }, select: { agentId: true } })) throw new NotFoundError('数字员工不存在。');
  const row = (await crmDb.query('SELECT "profile","updatedAt" FROM "SipAgentProfile" WHERE "workspaceId"=$1 AND "agentId"=$2', [s.workspaceId, agentId]))[0];
  return { profile: sipProfileSchema.parse(row?.profile || {}), updatedAt: row?.updatedAt || null };
}
export async function saveProfile(s: Scope, agentId: string, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).permissions.agentConfiguration?.includes('update')) throw new ForbiddenError('数字员工设置由获授权的培训负责人修改。');
  await agentProfile(s, agentId);
  const profile = sipProfileSchema.parse(input);
  await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  await resolvedVoice(s.workspaceId,profile,db);
  await db.query('INSERT INTO "SipAgentProfile" ("workspaceId","agentId","profile") VALUES ($1,$2,$3::jsonb) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "profile"=EXCLUDED."profile","updatedAt"=NOW() RETURNING "agentId"', [s.workspaceId, agentId, JSON.stringify(profile)]);
  });
  return agentProfile(s, agentId);
}
async function taskOwned(s: Scope, id: string, db: CrmDb = crmDb, lock = false) {
  const access = await memberAccess(db, s);
  const row = await visibleOutboundTask(db, s, id, canViewAllOutbound(access), lock);
  if (!row) throw new NotFoundError('任务不存在或无权访问。');
  return row;
}
// Summary lists keep large recipient and attempt arrays in the single-task
// endpoint. Full responses remain available for older manual-call clients.
async function taskResponses(s: Scope, access: Awaited<ReturnType<typeof memberAccess>>, authorized: Row[], summary = false) {
  const all = canViewAllOutbound(access);
  const currentParallelismLimit = await taskParallelismLimit(s.workspaceId);
  const rows = await withCurrentAgentNames<Row>(crmDb, s.workspaceId, authorized.map(t=>({...t,agentId:t.agentId,createdBy:t.createdBy,agentName:t.agentName||t.snapshot?.agentName})), 'createdBy');
  const taskIds = rows.map(t => t.id);
  const [reservations, allAttempts] = taskIds.length ? await Promise.all([
    crmDb.query(`SELECT "snapshot"->'redialSource' AS source FROM "SipTask" WHERE "workspaceId"=$1 AND "snapshot"->'redialSource'->>'taskId'=ANY($2::text[])`, [s.workspaceId, taskIds]),
    crmDb.query('SELECT "taskId","id","recipientIndex","attemptNumber","status","result","trunkKey","nextAttemptAt","startedAt" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=ANY($2::text[]) ORDER BY "taskId","recipientIndex","attemptNumber"', [s.workspaceId, taskIds]),
  ]) : [[], []];
  const attemptsByTask = new Map<string, Row[]>();
  for (const {taskId, ...attempt} of allAttempts) {
    const attempts = attemptsByTask.get(taskId) || [];
    attempts.push(attempt); attemptsByTask.set(taskId, attempts);
  }
  const reservedByTask = new Map<string, Set<string>>();
  for (const row of reservations) {
    if (!row.source?.taskId) continue;
    const reserved = reservedByTask.get(row.source.taskId) || new Set<string>();
    for (const id of row.source.attemptIds || []) reserved.add(id);
    reservedByTask.set(row.source.taskId, reserved);
  }
  // Share identical read queries only for this response. Keys include all bound
  // values, so line access is still checked as each task's original creator.
  const dispatchReads = new Map<string, Promise<Row[]>>();
  const dispatchDb: CrmDb = {
    query(sql, values = []) {
      const key = JSON.stringify([sql, values]);
      let pending = dispatchReads.get(key);
      if (!pending) { pending = crmDb.query(sql, values); dispatchReads.set(key, pending); }
      return pending;
    },
    transaction: fn => crmDb.transaction(fn),
  };
  return Promise.all(rows.map(async t => {
    const {snapshot, recipients, ...visible} = t;
    const attempts = attemptsByTask.get(t.id) || [];
    const recipientResults = taskRecipientOutcomes(t, attempts, reservedByTask.get(t.id));
    const resultStats = taskResultStats(t, attempts);
    const visibleAttempts = summary ? [] : attempts.map(attempt => {
      const { dispatchedLine: _internalLine, lineOverride, ...result } = attempt.result || {};
      const {trunkKey: _internalTrunk, ...visibleAttempt} = attempt;
      return { ...visibleAttempt, result: {...result, ...(lineOverride ? {lineOverride: {lineId: lineOverride.lineId, province: lineOverride.province}} : {})} };
    });
    return { ...visible, id: t.id, recipients: summary ? [] : recipients, recipientCount: recipients.length, hasQueuedAttempts: attempts.some(a => a.status === 'QUEUED'), continuationEligibleCount: taskContinuationIndices(t, attempts).length, redialEligibleCount: recipientResults.filter(row => row.redialEligible && row.attemptId).length, ...(summary ? {summary: true} : {}), parallelism: taskParallelism(snapshot), effectiveParallelism: snapshot.mode === 'MANUAL' ? taskParallelism(snapshot) : Math.min(taskParallelism(snapshot), currentParallelismLimit), kind: snapshot.mode || 'AI', provider: snapshot.provider || 'HAOKEHU_SIP', manualControls: snapshot.provider !== 'HAOKEHU_CALLBACK', policy: snapshot.policy, ...taskLineSummary(snapshot), dispatch: await taskDialStatus(dispatchDb, t, attempts), releaseVersion: snapshot.releaseVersion || null, voiceName: snapshot.employeeVoice?.name || '', voiceVolume: snapshot.employeeVoice?.volume ?? null, canOperate: grants(access.permissions, 'outboundCalls', 'create') && (t.createdBy === s.userId || all), retryPolicy: taskRetryPolicy(snapshot), retrySupported: snapshot.mode !== 'MANUAL' && !snapshot.testCall && (snapshot.provider || 'HAOKEHU_SIP') === 'HAOKEHU_SIP', redialSupported: ['RUNNING', 'PAUSED', 'NEEDS_REVIEW', 'COMPLETED', 'FAILED'].includes(t.status) && snapshot.mode !== 'MANUAL' && !snapshot.testCall && (snapshot.provider || 'HAOKEHU_SIP') === 'HAOKEHU_SIP', recipientResults: summary ? [] : recipientResults, outcomes: taskOutcomeCounts(recipientResults), resultStats, redialSourceTaskId: snapshot.redialSource?.taskId || null, carrierSummary: snapshot.carrierCheck?.summary || null, attempts: visibleAttempts };
  }));
}
export async function tasks(s: Scope, requestedOwner = 'mine', summary = false, kind?: 'MANUAL') {
  const access = await memberAccess(crmDb, s);
  const ownerId = await resolveDataOwner(s.workspaceId, s.userId, requestedOwner);
  const authorized = await visibleOutboundTasks(crmDb, s, canViewAllOutbound(access), ownerId, kind);
  return taskResponses(s, access, authorized, summary);
}
export async function taskPage(s:Scope,requestedOwner:string,summary:boolean,kind:'AI'|'MANUAL'|undefined,options:TaskPageOptions){
  const access=await memberAccess(crmDb,s);
  const ownerId=await resolveDataOwner(s.workspaceId,s.userId,requestedOwner);
  if(options.status==='WAITING'){
    // Waiting is computed from the current carrier and schedule, not a stored
    // task status. Evaluate every authorized RUNNING candidate before paging.
    const runningOptions={...options,status:'RUNNING' as const,page:1,pageSize:100};
    const first=await visibleOutboundTaskPage(crmDb,s,canViewAllOutbound(access),ownerId,kind,runningOptions);
    const candidates=[...first.items];
    for(let page=2;(page-1)*100<first.total;page++)candidates.push(...(await visibleOutboundTaskPage(crmDb,s,canViewAllOutbound(access),ownerId,kind,{...runningOptions,page})).items);
    const unique=[...new Map(candidates.map(task=>[task.id,task])).values()];
    const waiting=(await taskResponses(s,access,unique,true)).filter(task=>!!task.dispatch);
    const actualPage=Math.min(options.page,Math.max(1,Math.ceil(waiting.length/options.pageSize)));
    const items=waiting.slice((actualPage-1)*options.pageSize,actualPage*options.pageSize);
    const outcomeTotals=taskOutcomeCounts([]),resultStatsTotals=emptyTaskResultStats();
    for(const task of waiting)for(const key of Object.keys(outcomeTotals) as (keyof typeof outcomeTotals)[])outcomeTotals[key]+=task.outcomes[key];
    for(const task of waiting)for(const key of Object.keys(resultStatsTotals) as (keyof typeof resultStatsTotals)[])resultStatsTotals[key]+=task.resultStats[key];
    return {items:summary?items:await taskResponses(s,access,unique.filter(task=>items.some(item=>item.id===task.id)),false),total:waiting.length,page:actualPage,pageSize:options.pageSize,outcomeTotals,resultStatsTotals};
  }
  const page=await visibleOutboundTaskPage(crmDb,s,canViewAllOutbound(access),ownerId,kind,options);
  return {...page,items:await taskResponses(s,access,page.items,summary)};
}
export async function taskDetails(s: Scope, id: string) {
  const task = await taskOwned(s, id);
  const [access, creator] = await Promise.all([
    memberAccess(crmDb, s),
    crmDb.query('SELECT "name" FROM "User" WHERE "id"=$1', [task.createdBy]),
  ]);
  return (await taskResponses(s, access, [{...task, createdByName: creator[0]?.name || '已停用账号'}]))[0];
}
export async function createTask(s: Scope, input: unknown, options: {testCall?: boolean;db?:CrmDb;redialSource?:Row;demo?:DemoLaunch} = {}) {
  if(options.demo&&!options.testCall)throw new BadRequestError('演示电话必须通过演示入口创建。');
  const db=options.db??crmDb;
  const data = sipTaskSchema.parse(input);
  if(data.retryPolicy?.retries&&data.provider!=='HAOKEHU_SIP')throw new BadRequestError('此线路暂不支持任务自动重拨。');
  const existing = await requestedTask(db, s, data);
  if (existing) return existing;
  if (new Set(data.recipients.map(r => r.phoneNumber)).size !== data.recipients.length) throw new BadRequestError('客户名单有重复号码，请先去重。');
  // All active employees may supply prospect numbers; linked CRM records still enforce their own access.
  await assertCustomerRecipients(db, s, data.recipients);
  await assertCrmDialable(db, s.workspaceId, data.recipients.map(r => r.phoneNumber));
  const release=await employeeRelease(s,data.agentId),content=release.snapshot as Row;
  const lineSelection=data.provider==='HAOKEHU_SIP'&&data.lineId?{lineId:data.lineId,province:data.province}:undefined;
  const routes=data.provider==='ALIYUN_ENGINE'?null:await resolveRecipientLines(s,data.recipients,db,lineSelection);
  const line=data.provider==='ALIYUN_ENGINE'?await engineTaskLine(s.workspaceId):routes![0]!.line;
  const carrierIssues = routes ? await carrierRecipientIssues(db, s, routes, data.recipients) : data.recipients.map(() => '');
  const carrierSummary = carrierBatchSummary(data.recipients, carrierIssues);
  if (options.testCall && carrierSummary.skippedCount)
    throw new BadRequestError(carrierIssues.find(Boolean) + '。');
  if (data.provider !== 'ALIYUN_ENGINE') {
    const unique = new Map((routes || []).map(route => [route.line.trunkKey, route.line]));
    for (const routeLine of unique.values()) if (!await isLineDispatchable(s.workspaceId, routeLine, db)) throw new BadRequestError('匹配到的线路正在健康冷却，请稍后重试或联系管理员。');
  }
  const anchor=options.demo?.configuration.voiceId||(data.provider==='HAOKEHU_SIP'?content.playbook.recordingReplies?.voiceId:undefined);
  const selectedVoice=await resolveEmployeeSound(s,data.agentId,content,data.provider,db,anchor?{choice:'library:'+anchor,volume:content.profile.audio.volume}:undefined);
  if(data.provider==='HAOKEHU_SIP')assertFixedCallModel(selectedVoice.model);
  const callPlaybook=structuredClone(content.playbook);
  const systemSpeech=options.demo?callPlaybook.systemSpeech:completeSystemSpeech(callPlaybook.systemSpeech);
  const opening=data.provider==='HAOKEHU_SIP'?await readyVoiceOpening(s,selectedVoice.voiceId):null;
  if(!options.demo&&data.provider==='HAOKEHU_SIP'&&!callPlaybook.recordingReplies?.openingSource&&!content.opening?.trim())throw new BadRequestError('统一话术缺少开场白文字，请联系管理员补充后再使用此声音。');
  const recordings=options.demo?[]:await freezeRecordings(s,data.agentId,callPlaybook);
  if(!options.demo)assertPublishedOpening(callPlaybook,recordings);
  const recordingVoices:Record<string,unknown>={};
  for(const id of new Set(recordings.map(c=>c.voiceId as string))){
    recordingVoices[id]=await resolveEmployeeSound(s,data.agentId,content,data.provider,db,{choice:'library:'+id,volume:content.profile.audio.volume});
  }
  if(recordings.length&&data.provider!=='HAOKEHU_SIP')throw new BadRequestError('录音话术请使用系统电话线路。');
  const voiceConfigurations:Record<string,Awaited<ReturnType<typeof freezeCallVoiceConfiguration>>>={};
  if(data.provider==='HAOKEHU_SIP'){
    for(const sound of [selectedVoice,...Object.values(recordingVoices)] as Row[]){
      const key=sound.voiceId||'';
      if(voiceConfigurations[key])continue;
      const reference=recordings.find(c=>c.key==='opening-recordings'&&c.voiceId===key)||(opening&&key===selectedVoice.voiceId?{...opening,voiceId:key}:undefined);
      voiceConfigurations[key]=await freezeCallVoiceConfiguration(s,sound,content.profile.audio,db,reference);
    }
    selectedVoice.volume=voiceConfigurations[selectedVoice.voiceId||'']!.volume;
    for(const sound of Object.values(recordingVoices) as Row[])sound.volume=voiceConfigurations[sound.voiceId||'']!.volume;
  }
  const voiceConfiguration=voiceConfigurations[selectedVoice.voiceId||''];
  const voiceExpression=voiceConfiguration?.voiceExpression||content.voiceExpression||'';
  const runtime=releaseRuntime({...content,communication:{...content.communication,...(voiceConfiguration?.gender?{gender:voiceConfiguration.gender}:{})},playbook:callPlaybook,opening:recordings.find(c=>c.key==='opening-recordings')?.text||content.opening,compiledPrompt:compilePlaybook(callPlaybook),voiceExpression,placeholders:{}});
  const recordingLearning=RECORDING_LEARNING_ENABLED?await freezeRecordingLearning(s.workspaceId,data.agentId):null;
  const snapshot={...runtime,systemSpeech,recordingLearning,learningAgentId:data.agentId,voiceExpression,voiceConfigurations,livestreamSchedule:callPlaybook.livestreamSchedule,livestreamPrice:callPlaybook.livestreamPrice,recordings,recordingVoices,...(data.retryPolicy?{retryPolicy:data.retryPolicy}:{}),parallelism:data.parallelism,agentName:content.agentName,scriptSelection:content.scriptSelection,placeholders:content.placeholders,provider:data.provider,lineSelection,releaseId:release.id,releaseVersion:release.version,textModelId:content.textModelId,audio:voiceConfiguration?.audio||content.profile.audio,voiceTuning:voiceConfiguration?.voiceTuning||null,flow:callPlaybook.conversationMode==='goal'?null:callPlaybook.publishedFlow||null,handoff:content.playbook.handoff,line,routes,realtimeModel:selectedVoice.model,voiceId:selectedVoice.voiceId,voice:selectedVoice.voice,employeeVoice:selectedVoice,ttsVoiceCode:selectedVoice.ttsVoiceCode,ttsVolume:data.provider==='ALIYUN_ENGINE'?selectedVoice.volume:null,policyOverride:content.communication?.dialPolicyOverride||null,policy:content.communication?.dialPolicyOverride||line.dialPolicy,language:content.profile.language,maxDurationSeconds:content.maxDurationSeconds,record:content.record,agentVersion:'release:'+release.version,...await recognitionRules(db,s.workspaceId)};
  if(options.demo)applyDemoSnapshot(snapshot,options.demo,voiceExpression);
  if(recordingLearning)snapshot.instructions+='\n\n'+recordingLearning.instructions;
  if(options.testCall){
    Object.assign(snapshot,{testCall:true,maxDurationSeconds:Math.min(180,Number(snapshot.maxDurationSeconds)||180),policy:{...snapshot.policy,retries:0}});
    if(!inDialWindow(snapshot.policy,new Date())||!holidayStatus(snapshot.policy,new Date()).allowed||data.provider==='HAOKEHU_SIP'&&!carrierWindowOpen(line as LineSettings))throw new BadRequestError("当前不在允许拨打时段，请在允许时段测试。");
  }
  for(const recipient of data.recipients)taskRuntime(snapshot,recipient.variables||{});
  return storeTaskDraft(db, s, data, { ...snapshot, carrierCheck: { checkedAt: new Date().toISOString(), summary: carrierSummary }, ...(options.redialSource ? { redialSource: options.redialSource } : {}) });
}
// Keep each dial as a new attempt under the original task. The parent lock,
// latest-outcome checks and durable request ledger make repeated submissions safe.
export async function redialTask(s: Scope, id: string, raw: unknown) {
  const data = z.object({requestId: z.string().uuid(), attemptIds: z.array(z.string().uuid()).min(1).max(2000), confirmed: z.literal(true), lineId: redialLineIdSchema}).strict().parse(raw);
  if (new Set(data.attemptIds).size !== data.attemptIds.length) throw new BadRequestError('重拨名单存在重复，请重新选择。');
  if (!grants((await memberAccess(crmDb, s)).permissions, 'outboundCalls', 'create')) throw new ForbiddenError('当前角色没有外呼任务操作权限。');
  const result = await crmDb.transaction(async db => {
    const source = await taskOwned(s, id, db, true), snapshot = source.snapshot;
    if (snapshot.mode === 'MANUAL' || snapshot.testCall || (snapshot.provider || 'HAOKEHU_SIP') !== 'HAOKEHU_SIP' || !['RUNNING', 'PAUSED', 'NEEDS_REVIEW', 'COMPLETED', 'FAILED'].includes(source.status)) throw new BadRequestError('此任务不支持在这里重拨。');
    const sourceAttemptIds = [...data.attemptIds].sort();
    const ledger = snapshot.manualRedials || {}, prior = ledger[data.requestId];
    if (prior) {
      if (prior.requestedBy !== s.userId || (prior.lineId || '') !== data.lineId || !isDeepStrictEqual(prior.sourceAttemptIds, sourceAttemptIds)) throw new BadRequestError('重拨请求已被使用，请刷新任务列表。');
      const summary = prior.summary || {totalCount: sourceAttemptIds.length, acceptedCount: sourceAttemptIds.length, skippedCount: 0, skipReasons: []};
      return {id, status: source.status as string, lineId: data.lineId, count: summary.acceptedCount as number, ...summary, duplicate: true, startError: '', note: prior.note || ''};
    }
    const attempts = await db.query('SELECT * FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 ORDER BY "recipientIndex","attemptNumber" FOR UPDATE', [s.workspaceId, id]);
    // Preserve reservations from redials created by the previous implementation.
    const children = await db.query(`SELECT "snapshot"->'redialSource' AS source FROM "SipTask" WHERE "workspaceId"=$1 AND "snapshot"->'redialSource'->>'taskId'=$2`, [s.workspaceId, id]);
    const reserved = new Set<string>(children.flatMap(row => row.source?.attemptIds || []));
    const eligible = taskRecipientOutcomes(source, attempts, reserved).filter(row => row.redialEligible && row.attemptId && sourceAttemptIds.includes(row.attemptId));
    if (eligible.length !== sourceAttemptIds.length) throw new BadRequestError('所选号码的结果已变化、已安排重拨或不适合重拨，请刷新后重新选择。');
    const selectedRecipients = eligible.map(row => source.recipients[row.recipientIndex]);
    await assertTaskRuntimeReady(s, source, selectedRecipients, db);
    const creator = {...s, userId: source.createdBy};
    const selected = data.lineId ? await selectedRedialLine(creator, data.lineId, db) : undefined;
    const override = selected ? makeRedialLineOverride(selected) : undefined;
    // Only the submitted selection is revalidated. Other queued/active attempts
    // retain their own trunk and are never moved onto this override.
    const routes = selected ? eligible.map(() => selected) : (await resolveSipAttemptRoutes(db, source, eligible.map(row => ({
      recipientIndex: row.recipientIndex,
      trunkKey: snapshot.routes?.[row.recipientIndex]?.line?.trunkKey || snapshot.line?.trunkKey,
      result: {},
    })))).map(resolved => {
      if (!resolved.route) throw resolved.error;
      return resolved.route;
    });
    await assertDispatchRoutesReady(s, routes, db, false);
    const issues = await carrierRecipientIssues(db, creator, routes, selectedRecipients);
    const summary = carrierBatchSummary(selectedRecipients, issues);
    const now = new Date(), attemptIds: string[] = [];
    for (let offset = 0; offset < eligible.length; offset++) {
      const row = eligible[offset]!, route = routes[offset]!, issue = issues[offset]!;
      const attemptId = randomUUID(), attemptNumber = Math.max(0,...attempts.filter(a => a.recipientIndex === row.recipientIndex || a.recipientIndex === row.recipientIndex-source.recipients.length).map(a => Number(a.attemptNumber))) + 1;
      const attemptResult = {manualRedial: true, manualRedialRequestId: data.requestId, sourceAttemptId: row.attemptId, ...(override ? {lineOverride: override} : {}), ...(issue ? {reason: issue, carrierSkipped: true} : {})};
      await db.query(`INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","attemptNumber","trunkKey","nextAttemptAt","status","finishedAt","result") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8='FAILED' THEN NOW() ELSE NULL END,$9::jsonb) RETURNING "id"`, [attemptId, s.workspaceId, id, row.recipientIndex, attemptNumber, route.line.trunkKey, now, issue ? 'FAILED' : 'QUEUED', JSON.stringify(attemptResult)]);
      attemptIds.push(attemptId);
    }
    const note = summary.skippedCount ? `已安排${summary.acceptedCount}个号码重拨，另${summary.skippedCount}个号码不符合所选线路规则，已保留跳过原因。` : '';
    const nextLedger = {...ledger, [data.requestId]: {sourceAttemptIds, attemptIds, lineId: data.lineId, requestedBy: s.userId, createdAt: now.toISOString(), summary, note}};
    const status = summary.acceptedCount ? 'RUNNING' : source.status as string;
    const endTime = summary.acceptedCount && new Date(source.endTime).getTime() <= now.getTime() ? new Date(now.getTime() + 86400000) : source.endTime;
    await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{manualRedials}',$3::jsonb),"endTime"=$4,"status"=$5,"error"=CASE WHEN $6>0 THEN '' ELSE "error" END,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [s.workspaceId, id, JSON.stringify(nextLedger), endTime, status, summary.acceptedCount]);
    await detachTaskPauseBatch(db,s.workspaceId,id);
    return {id, status, lineId: data.lineId, count: summary.acceptedCount, ...summary, duplicate: false, startError: '', note};
  });
  if(!result.duplicate&&result.count>0&&result.status==='RUNNING')notifyCallPriorityQueued();
  if (!result.duplicate) await recordAuditEvent({organizationId: s.workspaceId, userId: s.userId, action: 'outbound.task.redial', resourceType: 'SipTask', resourceId: id, metadata: {count: result.count, skippedCount: result.skippedCount, status: result.status, lineId: data.lineId, sameTask: true, requestId: data.requestId}});
  return result;
}
export async function deleteDraft(s: Scope, id: string) {
 return crmDb.transaction(async d => {const t=await taskOwned(s,id,d,true);if(t.status!=='DRAFT')throw new BadRequestError('仅未启动的草稿可以删除，通话记录需要保留。');await d.query('UPDATE "SipTask" SET "deletedAt"=NOW(),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id]);return {deleted:true};});
}
export async function deleteTask(s: Scope, id: string) {
 if (!grants((await memberAccess(crmDb,s)).permissions,'outboundCalls','create')) throw new ForbiddenError('当前角色没有外呼任务操作权限。');
 const result=await crmDb.transaction(async d=>{
  const task=await taskOwned(s,id,d,true);
  if(task.snapshot.mode==='MANUAL')throw new BadRequestError('人工通话请在人工通话面板操作。');
  return softDeleteOutboundTask(d,s.workspaceId,id);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'outbound.task.deleted',resourceType:'SipTask',resourceId:id,metadata:result});
 return result;
}
export async function updateTaskParallelism(s: Scope, id: string, raw: unknown) {
  const data = parallelismUpdateSchema.parse(raw);
  if (!grants((await memberAccess(crmDb,s)).permissions,'outboundCalls','create')) throw new ForbiddenError('当前角色没有外呼任务操作权限。');
  const result = await crmDb.transaction(async db => {
    const task = await taskOwned(s,id,db,true);
    if (task.snapshot.mode === 'MANUAL' || !['DRAFT','RUNNING','PAUSED'].includes(task.status)) throw new BadRequestError('此任务当前不能调整外呼倍数。');
    await assertTaskParallelism(s.workspaceId, data.parallelism, db);
    if (taskParallelism(task.snapshot) !== data.expectedParallelism) throw new BadRequestError('外呼倍数已在其他页面更新，请刷新后再调整。');
    await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{parallelism}',$3::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [s.workspaceId,id,JSON.stringify(data.parallelism)]);
    return { parallelism:data.parallelism };
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'outbound.parallelism.updated',resourceType:'SipTask',resourceId:id,metadata:result});
  return result;
}
export async function updateTaskRetry(s:Scope,id:string,raw:unknown){
 const data=taskRetryUpdateSchema.parse(raw);
 if(!grants((await memberAccess(crmDb,s)).permissions,'outboundCalls','create'))throw new ForbiddenError('当前角色没有外呼任务操作权限。');
 const result=await crmDb.transaction(async db=>{
  const task=await taskOwned(s,id,db,true);
  if(task.snapshot.mode==='MANUAL'||task.snapshot.testCall||(task.snapshot.provider||'HAOKEHU_SIP')!=='HAOKEHU_SIP'||!['DRAFT','RUNNING','PAUSED','NEEDS_REVIEW','COMPLETED'].includes(task.status))throw new BadRequestError('此任务当前不能设置自动重拨。');
  if(new Date(task.endTime).getTime()<=Date.now())throw new BadRequestError('任务有效期已结束，请新建任务。');
  if(!isDeepStrictEqual(taskRetryPolicy(task.snapshot),data.expectedPolicy))throw new BadRequestError('重拨设置已在其他页面更新，请刷新后再调整。');
  task.snapshot={...task.snapshot,retryPolicy:data.policy};
  await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{retryPolicy}',$3::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,id,JSON.stringify(data.policy)]);
  // Only cancel scheduled retries that have never been submitted to a carrier.
  const cancelled=await db.query(`UPDATE "SipAttempt" SET "status"='CANCELLED',"finishedAt"=NOW(),"result"='{"reason":"RETRY_POLICY_DISABLED","retryPolicyCancelled":true}'::jsonb WHERE "workspaceId"=$1 AND "taskId"=$2 AND "status"='QUEUED' AND "startedAt" IS NULL AND "attemptNumber">1 AND "attemptNumber">$3 AND COALESCE("result"->>'manualRedial','false')<>'true' RETURNING "id"`,[s.workspaceId,id,data.policy.retries+1]);
  let scheduled=0;
  if(data.includePrevious&&data.policy.retries>0){
   const attempts=await db.query('SELECT * FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2',[s.workspaceId,id]);
   for(const attempt of retryCandidates(attempts))if(await queueTaskRetry(db,task,attempt,new Date(),true))scheduled++;
  }
  if(scheduled&&task.status==='COMPLETED'){
   await db.query(`UPDATE "SipTask" SET "status"='PAUSED',"error"='',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,id]);
  }
  return {policy:data.policy,scheduled,cancelled:cancelled.length,requiresContinue:scheduled>0&&task.status!=='RUNNING'};
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'outbound.retry.updated',resourceType:'SipTask',resourceId:id,metadata:result});return result;
}
async function assertTaskRuntimeReady(s: Scope, t: Row, pending: import('../crm/crm.recipients.js').LinkedRecipient[], db: CrmDb) {
    await assertRecordingLearningSnapshot(s.workspaceId,t.snapshot);
  if (!t.snapshot.releaseId) throw new BadRequestError('这是升级前的任务，请使用正式版本重新创建。');
  const aliyun = t.snapshot.provider === 'ALIYUN_ENGINE';
  if (aliyun) await assertEngineReady(s.workspaceId, db);
  else if (!(await bridgeReadiness('MANUAL', s.workspaceId)).ready) throw new BadRequestError('好客呼电话服务暂不可用，请稍后再启动。');
  await assertAgentUse({...s, userId: t.createdBy}, t.agentId, db);
  await assertFrozenEmployeeSound({...s, userId: t.createdBy}, t.snapshot, db);
  if (!aliyun) await realtimeAuthorized(s.workspaceId, t.snapshot.realtimeModel || 'qwen-audio-3.1-realtime-plus', db);
  if (!aliyun) await resolvedVoice(s.workspaceId, {voiceId: t.snapshot.voiceId, realtimeModel: t.snapshot.realtimeModel, voice: t.snapshot.voice, language: t.snapshot.language}, db);
  await assertCustomerRecipients(db, {...s, userId: t.createdBy}, pending);
  await assertCrmDialable(db, s.workspaceId, pending.map(r => r.phoneNumber));
  if (!(await db.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "isActive"=true AND "deletionRequestedAt" IS NULL', [s.workspaceId, t.agentId])).length) throw new BadRequestError('数字员工已经停用。');
}
async function assertDispatchRoutesReady(s: Scope, routes: RouteChoice[], db: CrmDb, aliyun: boolean) {
  if (!aliyun) {
    const unique = new Map(routes.map(route => [route.line.trunkKey, route.line]));
    for (const line of unique.values()) if (!await isLineDispatchable(s.workspaceId, line, db)) throw new BadRequestError('匹配到的线路正在健康冷却，请稍后重试或联系管理员。');
  }
  if (routes.some(route => !route.line.liveEnabled || (!aliyun && lineMissing(route.line).length))) throw new BadRequestError('有客户对应的线路尚未完成接入，请先配置或调整地区。');
}
async function assertTaskDispatchReady(s: Scope, t: Row, pending: import('../crm/crm.recipients.js').LinkedRecipient[], db: CrmDb, queuedAttempts?: Row[]) {
  await assertTaskRuntimeReady(s, t, pending, db);
  const aliyun = t.snapshot.provider === 'ALIYUN_ENGINE';
  // Completed recipients keep their historical route. Resume checks only the
  // untouched attempts, including each independently confirmed redial line.
  if (!aliyun && queuedAttempts?.length) {
    const routes: RouteChoice[] = [];
    const allowPartial=queuedAttempts.some(attempt=>attempt.result?.lineOverride!==undefined);
    let lastError: unknown;
    const ready = new Map<string, Promise<void>>();
    for (const resolved of await resolveSipAttemptRoutes(db, t, queuedAttempts)) {
      if (!resolved.route) { if(!allowPartial)throw resolved.error;lastError = resolved.error; continue; }
      const route = resolved.route;
      try {
        const key = JSON.stringify([route.line.trunkKey, route.line.liveEnabled, lineMissing(route.line)]);
        let check = ready.get(key);
        if (!check) { check = assertDispatchRoutesReady(s, [route], db, false); ready.set(key, check); }
        await check;
        routes[resolved.attempt.recipientIndex] = route;
      } catch (error) { if(!allowPartial)throw error;lastError = error; }
    }
    if (!routes.some(Boolean)) throw lastError || new BadRequestError('排队号码暂无可用线路，请重新选择。');
    return routes;
  }
  // A task bound to regional routes must not require an available default.
  // Legacy tasks without routes still use defaultLine's removal guard.
  const line = aliyun ? await engineTaskLine(s.workspaceId, db) : t.snapshot.routes ? undefined : await settings(s.workspaceId, db);
  const routes: RouteChoice[] = t.snapshot.routes ? await resolveRecipientLines({...s, userId: t.createdBy}, t.recipients, db, t.snapshot.lineSelection) : t.recipients.map(() => ({line:line!, lineId: '', province: ''}));
  await assertDispatchRoutesReady(s, routes, db, aliyun);
  if (t.snapshot.routes ? !sameTaskRoutes(t.snapshot.routes, routes) : !(aliyun ? isDeepStrictEqual(t.snapshot.line, line) : sameTaskLine(t.snapshot.line, line))) throw new BadRequestError('线路设置已变化，请重新创建草稿并核对主叫号码。');
  return routes;
}
export async function continueExpiredTask(s:Scope,id:string,raw:unknown) {
  const data=z.object({requestId:z.string().uuid(),confirmed:z.literal(true),startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true})}).strict().parse(raw);
  const startTime=new Date(data.startTime),endTime=new Date(data.endTime),now=new Date();
  if(!grants((await memberAccess(crmDb,s)).permissions,'outboundCalls','create'))throw new ForbiddenError('当前角色没有外呼任务操作权限。');
  const result=await crmDb.transaction(async db=>{
    const task=await taskOwned(s,id,db,true);
    const prior=task.snapshot.expiryContinuations?.[data.requestId];
    if(prior){
      if(prior.requestedBy!==s.userId||prior.startTime!==startTime.toISOString()||prior.endTime!==endTime.toISOString())throw new BadRequestError('继续任务请求已使用，请重新打开任务。');
      return {...prior.summary,id,status:task.status,count:prior.summary.acceptedCount,duplicate:true};
    }
    if(endTime.getTime()<=Math.max(now.getTime(),startTime.getTime()))throw new BadRequestError('结束时间必须晚于开始时间和当前时间。');
    if(startTime.getTime()<now.getTime()-300000)throw new BadRequestError('开始时间已过，请重新选择。');
    if(endTime.getTime()-Math.max(startTime.getTime(),now.getTime())>31*86400000)throw new BadRequestError('本次拨打期限最多设置31天。');
    const attempts=await db.query('SELECT * FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 ORDER BY "recipientIndex","attemptNumber" FOR UPDATE',[s.workspaceId,id]);
    const indices=taskContinuationIndices(task,attempts);
    if(!indices.length)throw new BadRequestError('没有因到期而停止的未拨打号码，请刷新任务列表。');
    const eligible=new Set(indices),recoverable=attempts.filter(a=>eligible.has(a.recipientIndex));
    const pending=indices.map(index=>task.recipients[index]);
    const routes=await assertTaskDispatchReady(s,task,pending,db,recoverable);
    if(indices.some(index=>!routes[index]))throw new BadRequestError('部分未拨号码的线路当前不可用，请核对线路后继续。');
    const issues=await carrierRecipientIssues(db,{...s,userId:task.createdBy},indices.map(index=>routes[index]!),pending);
    const summary=carrierBatchSummary(pending,issues);
    const byIndex=new Map(recoverable.map(a=>[a.recipientIndex,a]));
    const rows=indices.map((index,offset)=>{
      const attempt=byIndex.get(index),issue=issues[offset];
      const {reason:_expiredReason,taskExpired:_expired,...preserved}=attempt?.result||{};
      return {id:attempt?.id||randomUUID(),existing:!!attempt,recipientIndex:index,trunkKey:routes[index]!.line.trunkKey,status:issue?'FAILED':'QUEUED',result:{...preserved,expiryContinuationRequestId:data.requestId,previousExpiredAt:task.endTime,...(issue?{reason:issue,carrierSkipped:true}:{})}};
    });
    const existing=rows.filter(row=>row.existing),fresh=rows.filter(row=>!row.existing);
    if(existing.length){
      const updated=await db.query(`UPDATE "SipAttempt" a SET "status"=r.status,"finishedAt"=CASE WHEN r.status='FAILED' THEN NOW() ELSE NULL END,"nextAttemptAt"=$4,"leaseUntil"=NULL,"trunkKey"=r."trunkKey","result"=r.result
        FROM jsonb_to_recordset($3::jsonb) AS r(id text,"trunkKey" text,status text,result jsonb)
        WHERE a."workspaceId"=$1 AND a."taskId"=$2 AND a."id"=r.id AND a."startedAt" IS NULL AND a."status" IN('QUEUED','CANCELLED') RETURNING a."id"`,[s.workspaceId,id,JSON.stringify(existing),startTime]);
      if(updated.length!==existing.length)throw new BadRequestError('未拨号码状态已变化，请刷新后重新继续。');
    }
    if(fresh.length)await db.query(`INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","trunkKey","status","nextAttemptAt","finishedAt","result")
      SELECT r.id,$1,$2,r."recipientIndex",r."trunkKey",r.status,$4,CASE WHEN r.status='FAILED' THEN NOW() ELSE NULL END,r.result
      FROM jsonb_to_recordset($3::jsonb) AS r(id text,"recipientIndex" int,"trunkKey" text,status text,result jsonb) RETURNING "id"`,[s.workspaceId,id,JSON.stringify(fresh),startTime]);
    const active=attempts.some(a=>['DISPATCHING','DIALING','CONNECTED'].includes(a.status));
    const status=summary.acceptedCount||active?'RUNNING':'COMPLETED';
    const continuations={...(task.snapshot.expiryContinuations||{}),[data.requestId]:{requestedBy:s.userId,createdAt:now.toISOString(),startTime:startTime.toISOString(),endTime:endTime.toISOString(),previousEndTime:task.endTime,summary}};
    await db.query(`UPDATE "SipTask" SET "startTime"=$3,"endTime"=$4,"status"=$5,"error"='',"snapshot"=jsonb_set(jsonb_set("snapshot",'{expiryContinuations}',$6::jsonb),'{carrierCheck}',$7::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,id,startTime,endTime,status,JSON.stringify(continuations),JSON.stringify({checkedAt:now.toISOString(),summary})]);
    await detachTaskPauseBatch(db,s.workspaceId,id);
    return {...summary,id,status,count:summary.acceptedCount,duplicate:false};
  });
  if(!result.duplicate&&result.count>0&&result.status==='RUNNING')notifyCallPriorityQueued();
  if(!result.duplicate)await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'outbound.task.continue-expired',resourceType:'SipTask',resourceId:id,metadata:{count:result.count,skippedCount:result.skippedCount,startTime:data.startTime,endTime:data.endTime,sameTask:true,requestId:data.requestId}});
  return result;
}

export async function taskAction(s: Scope, id: string, action: 'start' | 'pause', confirmation?: string, options:{db?:CrmDb;bulk?:boolean;lineId?:string}={}) {
  const base=options.db||crmDb;
  if (!grants((await memberAccess(base,s)).permissions,'outboundCalls','create')) throw new ForbiddenError('当前角色没有外呼任务操作权限。');
  if (options.lineId && action !== 'start') throw new BadRequestError('只有继续任务时可以切换线路。');
  if (action === 'start') {
    if (confirmation !== id) throw new BadRequestError('请核对名单后确认启动。');
  }
  const result=await base.transaction(async db => {
    const t = await taskOwned(s, id, db, true);
    if(t.snapshot.mode==='MANUAL')throw new BadRequestError('人工通话请在人工通话面板操作。');
    if (action === 'pause') {
      if(t.status==='PAUSED'){
        await detachTaskPauseBatch(db,s.workspaceId,id);
        return {status:'PAUSED',note:'任务已暂停，保留这次单独暂停操作。'};
      }
      if (t.status !== 'RUNNING') throw new BadRequestError('当前任务不在执行中。');
      await db.query('UPDATE "SipTask" SET "status"=\'PAUSED\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"', [s.workspaceId, id]);
      await detachTaskPauseBatch(db,s.workspaceId,id);
      return { status: 'PAUSED', note: '已暂停追加拨号，正在通话的客户正常结束。' };
    }
    if (!['DRAFT','PAUSED','NEEDS_REVIEW'].includes(t.status)) throw new BadRequestError('当前任务不能继续。');
    if (options.lineId && (!['PAUSED','NEEDS_REVIEW'].includes(t.status) || (t.snapshot.provider || 'HAOKEHU_SIP') !== 'HAOKEHU_SIP' || t.snapshot.testCall || t.snapshot.demoCall))
      throw new BadRequestError('当前任务不支持在继续时切换线路。');
    // Resume only untouched attempts. An uncertain submission keeps its ID and
    // status so a late receipt can still settle it; it is never submitted again.
    const attempts=await db.query('SELECT "id","recipientIndex","status","startedAt","result","trunkKey" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2',[s.workspaceId,id]);
    let pendingIndices: number[] = t.recipients.flatMap((_recipient: Row, index: number) => ((t.status === 'DRAFT' && attempts.length === 0) || attempts.some(a => a.recipientIndex === index && a.status === 'QUEUED')) ? [index] : []);
    const pending = pendingIndices.map(index => t.recipients[index]);
    if(!pending.length)throw new BadRequestError('没有剩余未拨打号码。');
    if (new Date(t.endTime).getTime() <= Date.now()) throw new BadRequestError('任务结束时间已过，请创建新的草稿。');
    let switchedLine: ResumeLine | undefined;
    let routes: RouteChoice[];
    if (options.lineId) {
      const lineId = redialLineIdSchema.parse(options.lineId);
      const selected = await selectedRedialLine({...s,userId:t.createdBy},lineId,db);
      await assertTaskRuntimeReady(s,t,pending,db);
      await assertDispatchRoutesReady(s,[selected],db,false);
      routes = [];
      for (const index of pendingIndices) routes[index] = selected;
      switchedLine = {override:makeRedialLineOverride(selected),trunkKey:selected.line.trunkKey};
    } else routes=await assertTaskDispatchReady(s,t,pending,db,attempts.filter(attempt=>attempt.status==='QUEUED'));
    pendingIndices = pendingIndices.filter(index => !!routes[index]);
    const dispatchPending = pendingIndices.map(index => t.recipients[index]);
    const issues = (t.snapshot.provider || 'HAOKEHU_SIP') === 'HAOKEHU_SIP' ? await carrierRecipientIssues(db, { ...s, userId: t.createdBy }, pendingIndices.map(index => routes[index]!), dispatchPending) : dispatchPending.map(() => ''); const summary = carrierBatchSummary(dispatchPending, issues);
    if (switchedLine && summary.skippedCount) throw new BadRequestError('所选线路有 '+summary.skippedCount+' 个待拨号码不符合线路规则：'+summary.skipReasons.map(item=>item.reason+'（'+item.count+'个）').join('；')+'。请更换线路后继续。');
    if (switchedLine) await switchQueuedResumeLine(db,s,id,attempts,switchedLine);
    const rows = pendingIndices.map((index, offset) => ({ id: randomUUID(), recipientIndex: index, trunkKey: routes[index]!.line.trunkKey, status: issues[offset] ? 'FAILED' : 'QUEUED', result: issues[offset] ? { reason: issues[offset], carrierSkipped: true } : switchedLine ? {lineOverride:switchedLine.override,resumeLineSwitch:true} : {} }));
    await db.query(`INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","trunkKey","status","finishedAt","result")
            SELECT r.id,$1,$2,r."recipientIndex",r."trunkKey",r.status,CASE WHEN r.status='FAILED' THEN NOW() ELSE NULL END,r.result
            FROM jsonb_to_recordset($3::jsonb) AS r(id text,"recipientIndex" int,"trunkKey" text,status text,result jsonb)
            ON CONFLICT ("taskId","recipientIndex","attemptNumber") DO NOTHING RETURNING "id"`, [s.workspaceId, id, JSON.stringify(rows)]);
    const blocked = rows.filter(row => row.status === 'FAILED');
    if (blocked.length)
      await db.query(`UPDATE "SipAttempt" a SET "status"='FAILED',"finishedAt"=NOW(),"result"=COALESCE(a."result",'{}'::jsonb)||r.result
                FROM jsonb_to_recordset($3::jsonb) AS r("recipientIndex" int,result jsonb)
                WHERE a."workspaceId"=$1 AND a."taskId"=$2 AND a."recipientIndex"=r."recipientIndex" AND a."status"='QUEUED' RETURNING a."id"`, [s.workspaceId, id, JSON.stringify(blocked)]);
    const remaining = Number((await db.query(`SELECT count(*)::int AS count FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 AND "status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED')`, [s.workspaceId, id]))[0]?.count || 0);
    const status = remaining ? 'RUNNING' : 'COMPLETED';
    await db.query(`UPDATE "SipTask" SET "status"=$3,"snapshot"=CASE WHEN $5::jsonb IS NULL THEN jsonb_set("snapshot",'{carrierCheck}',$4::jsonb) ELSE jsonb_set(jsonb_set("snapshot",'{carrierCheck}',$4::jsonb),'{resumeLine}',$5::jsonb) END,"error"='',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [s.workspaceId, id, status, JSON.stringify({ checkedAt: new Date().toISOString(), summary }), switchedLine ? JSON.stringify(switchedLine) : null]);
    if(!options.bulk)await detachTaskPauseBatch(db,s.workspaceId,id);
    return { status, ...summary, note: summary.skippedCount ? `已跳过${summary.skippedCount}个不符合线路规则的号码，${summary.acceptedCount}个号码可继续拨打。` : '' };
  });
  // The common start path covers ordinary campaigns, model tests and demos.
  // An outer transaction uses the bounded cache refresh after its own commit.
  if(!options.db&&action==='start'&&result.status==='RUNNING')notifyCallPriorityQueued();
  if(!options.db&&options.lineId)await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'outbound.task.resume-line',resourceType:'SipTask',resourceId:id,metadata:{lineId:options.lineId,count:'acceptedCount' in result ? result.acceptedCount : 0}});
  return result;
}
// This preview neither writes customer data nor contacts the voice/supplier API.
export async function preview(s: Scope, id: string) {
  const t = await taskOwned(s,id);
  return { taskName:t.name, customers:t.recipients.length, opening:taskRuntime(t.snapshot).opening, language:t.snapshot.language, policy:t.snapshot.policy, routing:(t.snapshot.routes || []).map((r:Row,i:number)=>({recipientIndex:i,province:r.province||'未识别',lineName:r.line.name})), stages:['确认名单','等待拨打时段','客户接通','数字员工对话','保存通话与录音','客户时间线与自动整理'], simulated:true };
}
