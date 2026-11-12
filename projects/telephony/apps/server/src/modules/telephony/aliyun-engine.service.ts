/*
 * 中文导读：线路与语音外呼：aliyun-engine.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { assertRecordingLearningSnapshot } from '../recording-learning/learning.service.js';
import {callLimitSchema} from './call-limits.js';
import { taskRuntime } from '../agent/agent.release.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type CrmDb, type Scope, type Row } from '../crm/crm.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { connection } from '../aliyun/aliyun.service.js';
import { aiccsClient, aiccsModels as M } from '../aliyun/aiccs.client.js';
import { rpcRuntime } from '../aliyun/aliyun.client.js';
import { dialPolicySchema } from '../aliyun/aliyun.schema.js';
import { modelKey } from './model-credentials.js';
import { presets } from './models.service.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { platformConfiguration, platformEnabled } from '../platform/platform-client.js';

export const engineSchema=z.object({
  enabled:z.boolean().default(false),regionId:z.enum(['cn-hangzhou','cn-shanghai','cn-beijing','cn-shenzhen']).default('cn-hangzhou'),
  applicationCode:z.string().trim().max(120).default(''),callerNumber:z.string().trim().regex(/^[a-zA-Z0-9_-]{0,100}$/).default(''),
  resourcesConfirmed:z.boolean().default(false),concurrency:callLimitSchema,callsPerSecond:callLimitSchema,
  ttsVoiceCode:z.string().trim().regex(/^[a-zA-Z0-9_.-]{0,160}$/).default(''),
  dialPolicy:dialPolicySchema.default(()=>dialPolicySchema.parse({holidayRestricted:false})),
}).strict();
export async function engineSettings(workspaceId:string,db:CrmDb=crmDb){return engineSchema.parse((await db.query('SELECT "settings" FROM "AliyunEngineConnection" WHERE "workspaceId"=$1',[workspaceId]))[0]?.settings||{});}
export async function engineCatalog(s:Scope){
  const access=await memberAccess(crmDb,s),settings=await engineSettings(s.workspaceId),{credentials}=await connection(s.workspaceId);
  const missing=[!settings.applicationCode?'通信引擎应用':'',!settings.callerNumber?'主叫号码或服务实例':'',!settings.resourcesConfirmed?'云端资源与回执联调':'',!credentials.accessKeyId||!credentials.accessKeySecret?'阿里云服务凭据':'',!process.env.ALIYUN_ENGINE_GATEWAY_TOKEN?'共享模型网关授权':'',!process.env.ALIYUN_ENGINE_RECEIPT_TOKEN?'通话回执授权':'',!settings.enabled?'阿里云外呼开关':''].filter(Boolean);
  return {canConfigure:access.isSystemAdmin,ready:missing.length===0,missing:access.isSystemAdmin?missing:[],name:'阿里云通信引擎',...(access.isSystemAdmin?{settings,gatewayConfigured:!!process.env.ALIYUN_ENGINE_GATEWAY_TOKEN,receiptConfigured:!!process.env.ALIYUN_ENGINE_RECEIPT_TOKEN}:{})};
}
export async function saveEngineSettings(s:Scope,input:unknown){
  if(!(await memberAccess(crmDb,s)).isSystemAdmin)throw new ForbiddenError('阿里云线路由系统超级管理员配置。');
  const settings=engineSchema.parse(input);
  if(settings.enabled&&(!settings.applicationCode||!settings.callerNumber||!settings.resourcesConfirmed||!process.env.ALIYUN_ENGINE_GATEWAY_TOKEN||!process.env.ALIYUN_ENGINE_RECEIPT_TOKEN))throw new BadRequestError('请先完成云端应用、号码、共享网关和回执联调。');
  await crmDb.transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:aliyun-engine-'+s.workspaceId]);
    if((await db.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" WHERE a."workspaceId"=$1 AND t."snapshot"->>'provider'='ALIYUN_ENGINE' AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId])).length)throw new BadRequestError('请先等待阿里云通话结束，并核对未确认结果。');
    await db.query('INSERT INTO "AliyunEngineConnection" ("workspaceId","settings") VALUES ($1,$2::jsonb) ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=EXCLUDED."settings","updatedAt"=NOW() RETURNING "workspaceId"',[s.workspaceId,JSON.stringify(settings)]);
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'aliyun.engine.settings',resourceType:'lines',resourceId:s.workspaceId,metadata:{enabled:settings.enabled}});
  return engineCatalog(s);
}
export async function engineTaskLine(workspaceId:string,db:CrmDb=crmDb){
  const s=await engineSettings(workspaceId,db);
  return {name:'阿里云通信引擎',trunkKey:'aliyun-engine-'+workspaceId,callerNumber:s.callerNumber,applicationCode:s.applicationCode,regionId:s.regionId,ttsVoiceCode:s.ttsVoiceCode,concurrency:s.concurrency,callsPerSecond:s.callsPerSecond,liveEnabled:s.enabled,dialPolicy:s.dialPolicy};
}
export async function assertEngineReady(workspaceId:string,db:CrmDb=crmDb){
  const s=await engineSettings(workspaceId,db),{credentials}=await connection(workspaceId);
  if(!s.enabled||!s.resourcesConfirmed||!s.applicationCode||!s.callerNumber||!credentials.accessKeyId||!credentials.accessKeySecret||!process.env.ALIYUN_ENGINE_GATEWAY_TOKEN||!process.env.ALIYUN_ENGINE_RECEIPT_TOKEN)throw new BadRequestError('阿里云通信引擎尚未完成接入，好客呼任务可以继续独立使用。');
  return s;
}
export async function frozenTextConnection(workspaceId:string,modelId:string,db:CrmDb=crmDb){
  if(platformEnabled()){
    const {model}=await platformConfiguration();
    if(!model.enabled||!model.base_url||!model.api_key||!model.model)throw new BadRequestError('请在主页后台配置文字模型。');
    return {model:model.model,base:model.base_url.replace(/\/$/,''),key:model.api_key};
  }
  const preset=presets.find(p=>p.id===modelId&&p.kind==='text');
  const enabled=(await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]))[0]?.settings?.enabled||[];
  if(!preset||!enabled.includes(modelId))throw new BadRequestError('正式版本中的文字模型未授权，请由负责人选择模型并重新发布。');
  const key=await modelKey(workspaceId,preset.key);if(!key)throw new BadRequestError('正式版本的文字模型缺少密钥。');
  return {model:preset.id,base:preset.base,key};
}
export async function prepareEngineClaim(db:CrmDb,a:Row){
  const current=await engineTaskLine(a.workspaceId,db);
  await assertEngineReady(a.workspaceId,db);
  if(!isDeepStrictEqual(current,a.snapshot.line))throw new BadRequestError('阿里云线路设置已更新，请重新创建任务。');
  if(!a.snapshot.releaseId)throw new BadRequestError('任务缺少正式版本，请重新创建。');
  await frozenTextConnection(a.workspaceId,a.snapshot.textModelId,db);
  await assertRecordingLearningSnapshot(a.workspaceId,a.snapshot);
  const outId=randomBytes(8).toString('hex').slice(0,15);
  await db.query('INSERT INTO "AliyunEngineCall" ("attemptId","workspaceId","outId","releaseId") VALUES ($1,$2,$3,$4) RETURNING "attemptId"',[a.id,a.workspaceId,outId,a.snapshot.releaseId]);
  return {attemptId:a.id,workspaceId:a.workspaceId,outId,phoneNumber:a.recipients[a.recipientIndex].phoneNumber,line:current,snapshot:{...a.snapshot,...taskRuntime(a.snapshot,a.recipients[a.recipientIndex].variables||{})}};
}
export async function dispatchEngineCall(claim:Row){
  const {credentials}=await connection(claim.workspaceId),line=claim.line;
  // No automatic SDK retry: an unconfirmed submission must never dial twice.
  const ttsVoiceCode=claim.snapshot.employeeVoice?claim.snapshot.ttsVoiceCode:line.ttsVoiceCode;
  const ttsVolume=claim.snapshot.employeeVoice?claim.snapshot.ttsVolume:null;
  const reply=await aiccsClient(line.regionId,credentials).llmSmartCallWithOptions(new M.LlmSmartCallRequest({applicationCode:line.applicationCode,callerNumber:line.callerNumber,calledNumber:claim.phoneNumber,outId:claim.outId,sessionTimeout:Math.max(600,claim.snapshot.maxDurationSeconds),...(ttsVoiceCode?{ttsVoiceCode}:{}),...(typeof ttsVolume==='number'?{ttsVolume}:{}),startWordParam:{opening:claim.snapshot.opening}}),rpcRuntime());
  if(reply.body?.code!=='OK'||!reply.body.callId)throw new Error('Aliyun call delivery unconfirmed');
  await crmDb.transaction(async db=>{
    const mapped=(await db.query('SELECT "remoteId" FROM "AliyunEngineCall" WHERE "attemptId"=$1 FOR UPDATE',[claim.attemptId]))[0];
    if(mapped?.remoteId&&mapped.remoteId!==reply.body!.callId)throw new Error('Aliyun call identity mismatch');
    await db.query('UPDATE "AliyunEngineCall" SET "remoteId"=$2 WHERE "attemptId"=$1 RETURNING "attemptId"',[claim.attemptId,reply.body!.callId]);
    await db.query(`UPDATE "SipAttempt" SET "status"='DIALING',"leaseUntil"=NOW()+INTERVAL '65 minutes' WHERE "id"=$1 AND "status"='DISPATCHING' RETURNING "id"`,[claim.attemptId]);
  });
}
