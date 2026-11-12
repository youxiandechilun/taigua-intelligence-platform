/*
 * 中文导读：线路与语音外呼：engine-voices.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { randomUUID } from 'node:crypto';
import { crmDb } from '../crm/crm.db.js';
import { type Scope, memberAccess } from '../crm/crm.service.js';
import { grants } from '../workspace/company-policy.js';
import { connection } from '../aliyun/aliyun.service.js';
import { aiccsClient, aiccsModels as M } from '../aliyun/aiccs.client.js';
import { rpcRuntime } from '../aliyun/aliyun.client.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { safeAuditionUrl } from './voice-options.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';

// Read the cloud account's real catalog; a DashScope clone ID is never used as
// an AICCS voice code. Existing employee sharing choices survive every sync.
export async function syncEngineVoices(s:Scope){
 if(!grants((await memberAccess(crmDb,s)).permissions,'agentConfiguration','update'))throw new ForbiddenError('请由获授权的培训负责人同步声音库。');
 const {credentials}=await connection(s.workspaceId);
 if(!credentials.accessKeyId||!credentials.accessKeySecret)throw new BadRequestError('阿里云通信服务凭据尚未配置，请由超级管理员在线路设置中补充。');
 const settings=(await crmDb.query('SELECT "settings" FROM "AliyunEngineConnection" WHERE "workspaceId"=$1',[s.workspaceId]))[0]?.settings||{};
 let rows;
 try{
  const reply=await aiccsClient(settings.regionId||'cn-hangzhou',credentials).listAvailableTtsWithOptions(new M.ListAvailableTtsRequest({}),rpcRuntime());
  if(reply.body?.code!=='OK'||reply.body.success===false||!Array.isArray(reply.body.data))throw new Error('Cloud catalog unavailable');
  rows=reply.body.data;
 }catch{throw new BadRequestError('阿里云音色目录读取失败，请检查通信服务凭据是否具有 ListAvailableTts 查询权限。好客呼声音不受影响。');}
 const voices=rows.filter(v=>/^[A-Za-z0-9_.-]{1,160}$/.test(v.ttsVoiceCode||'')).slice(0,500);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  for(const v of voices){
   const prior=(await db.query('SELECT "id" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'ALIYUN_ENGINE\' AND "voice"=$2 LIMIT 1',[s.workspaceId,v.ttsVoiceCode]))[0];
   if(prior)await db.query('UPDATE "WorkspaceVoice" SET "name"=$3,"auditionUrl"=$4,"status"=\'READY\',"error"=\'\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,prior.id,(v.ttsVoiceName||v.ttsVoiceCode!).slice(0,60),safeAuditionUrl(v.ttsAuditionFileUrl||'')]);
   else await db.query('INSERT INTO "WorkspaceVoice" ("id","workspaceId","createdBy","name","targetModel","voice","provider","status","auditionUrl","mime") VALUES ($1,$2,$3,$4,\'aliyun-aiccs-tts\',$5,\'ALIYUN_ENGINE\',\'READY\',$6,\'audio/mpeg\') RETURNING "id"',[randomUUID(),s.workspaceId,s.userId,(v.ttsVoiceName||v.ttsVoiceCode!).slice(0,60),v.ttsVoiceCode,safeAuditionUrl(v.ttsAuditionFileUrl||'')]);
  }
  // Unavailable cloud voices stay visible to their owners, but cannot be used
  // by a new task. There is no silent substitution with another speaker.
  await db.query('UPDATE "WorkspaceVoice" SET "status"=\'UNAVAILABLE\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "provider"=\'ALIYUN_ENGINE\' AND "deletedAt" IS NULL AND NOT ("voice"=ANY($2::text[])) RETURNING "id"',[s.workspaceId,voices.map(v=>v.ttsVoiceCode)]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.cloud.synced',resourceType:'voices',metadata:{count:voices.length}});
 return {count:voices.length};
}
