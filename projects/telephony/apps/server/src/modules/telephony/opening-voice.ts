/*
 * 中文导读：线路与语音外呼：opening-voice.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import prisma from '../../config/prisma.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type Scope,type Row} from '../crm/crm.service.js';
import {canTrain,publishedRelease} from '../agent/agent.release.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import {inspectSample,submitVoiceEnrollment} from './voices.service.js';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import {voiceAccessible} from './voice-options.js';
import {realtimeAuthorized} from './models.service.js';
import {rememberVoiceReference} from './voice-reference-versions.js';

const input=z.object({scope:z.enum(['personal','template']),name:z.string().trim().min(1).max(60),sourceVoiceId:z.string().uuid().optional(),replaceExisting:z.boolean().default(false),audio:z.string().max(2800000),consented:z.literal(true)}).strict().refine(v=>!v.replaceExisting||!!v.sourceVoiceId,'请选择要更新的声音人物。');

// The original opening becomes the enrollment sample. The new entry is
// restricted to this user until a permitted update promotes it to the person.
export async function cloneOpeningVoice(s:Scope,agentId:string,raw:unknown){
 const data=input.parse(raw),access=await memberAccess(crmDb,s);
 if(data.replaceExisting&&(!canTrain(access.permissions)||!access.allData))throw new ForbiddenError('更新公司声音人物需要声音库管理权限；可以取消勾选并保存为自己的新声音。');
 if(data.scope==='personal')await publishedRelease(s,agentId);
 else {
  if(!canTrain(access.permissions))throw new ForbiddenError('没有培训录音编辑权限。');
  if(!await prisma.agent.findFirst({where:{agentId,organizationId:s.workspaceId,deletionRequestedAt:null},select:{agentId:true}}))throw new NotFoundError('数字员工不存在。');
 }
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))throw new BadRequestError('录音编码不正确。');
 const sample=Buffer.from(data.audio,'base64');
 if(sample.toString('base64')!==data.audio)throw new BadRequestError('录音编码不完整。');
 const {seconds}=inspectSample(sample);
 if(seconds>45)throw new BadRequestError('请使用45秒以内的开场原始录音。');
 const hash=createHash('sha256').update(sample).digest('hex');
 await realtimeAuthorized(s.workspaceId,CALL_VOICE_MODEL);
 const claimed=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  let gender='neutral',source:Row|undefined;
  if(data.sourceVoiceId){
   source=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,data.sourceVoiceId]))[0];
   if(!source||source.provider!=='HAOKEHU_SIP'||source.targetModel!==CALL_VOICE_MODEL||source.status!=='READY'||source.enabled===false||!voiceAccessible(source,s.userId))throw new BadRequestError('原声音人物已不可用，请重新选择。');
   if(data.replaceExisting&&source.previewStatus==='GENERATING')throw new BadRequestError('该人物正在生成试听，请完成后再更新声音。');
   gender=source.gender||gender;
   if(data.replaceExisting&&source.sampleHash===hash)return {row:source,source,submit:false,created:false};
  }
  const existing=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "createdBy"=$2 AND "sampleHash"=$3 AND "targetModel"=$4 AND "provider"=\'HAOKEHU_SIP\' AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1',[s.workspaceId,s.userId,hash,CALL_VOICE_MODEL]))[0];
  if(existing){
   if(existing.enabled===false||!voiceAccessible(existing,s.userId))throw new BadRequestError('这条录音已有复刻声音但已停用或无权使用，请联系负责人。');
   if(existing.status==='SUBMITTING'&&Date.now()-new Date(existing.updatedAt).getTime()>120000){
    existing.status='NEEDS_REVIEW';existing.error='上次复刻未返回结果，请联系管理员核对；不会自动重复提交。';
    await db.query('UPDATE "WorkspaceVoice" SET "status"=\'NEEDS_REVIEW\',"error"=$3,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "status"=\'SUBMITTING\'',[s.workspaceId,existing.id,existing.error]);
   }
   if(existing.status!=='DRAFT')return {row:existing,source,submit:false,created:false};
   const row=(await db.query('UPDATE "WorkspaceVoice" SET "status"=\'SUBMITTING\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "status"=\'DRAFT\' RETURNING *',[s.workspaceId,existing.id]))[0]!;
   return {row,source,submit:true,created:false};
  }
  if(Number((await db.query('SELECT count(*)::int AS count FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'HAOKEHU_SIP\' AND "deletedAt" IS NULL',[s.workspaceId]))[0]?.count)>=200)throw new BadRequestError('公司复刻声音已达200个，请先移除未使用的声音。');
  const row=(await db.query('INSERT INTO "WorkspaceVoice" ("id","workspaceId","createdBy","name","targetModel","sample","sampleHash","consentedAt","gender","status","employeeVisible","assignedUserIds") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,\'SUBMITTING\',true,$9::text[]) RETURNING *',[randomUUID(),s.workspaceId,s.userId,data.name,CALL_VOICE_MODEL,sample,hash,gender,[s.userId]]))[0]!;
  return {row,source,submit:true,created:true};
 });
 const result=claimed.submit?await submitVoiceEnrollment(s.workspaceId,claimed.row):{id:claimed.row.id,status:claimed.row.status,error:claimed.row.error||''};
 if(claimed.submit)await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.opening.enrolled',resourceType:'voices',resourceId:result.id,metadata:{agentId,sourceVoiceId:data.sourceVoiceId||null,sampleHash:hash,status:result.status}});
 if(data.replaceExisting&&result.status==='READY'&&claimed.source&&result.id!==claimed.source.id){
  const source=claimed.source;
  await crmDb.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
   const current=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,source.id]))[0];
   const ready=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,result.id]))[0];
   if(!current||current.voice!==source.voice||current.sampleHash!==source.sampleHash||current.enabled===false||current.status!=='READY'||current.previewStatus==='GENERATING'||current.targetModel!==CALL_VOICE_MODEL)throw new BadRequestError('复刻已完成，但原人物设置已变化。请到声音库核对新版本，系统不会重复复刻。');
   if(!ready||ready.status!=='READY'||ready.sampleHash!==hash||ready.createdBy!==s.userId||ready.enabled===false)throw new BadRequestError('复刻版本已变化，请重新核对声音库。');
   await rememberVoiceReference(db,s.workspaceId,current.id,current);
   await rememberVoiceReference(db,s.workspaceId,current.id,ready);
   await db.query('UPDATE "WorkspaceVoice" SET "voice"=$3,"sample"=$4,"sampleHash"=$5,"providerRequestId"=$6,"consentedAt"=$7,"preview"=NULL,"previewStatus"=\'NONE\',"error"=\'\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,current.id,ready.voice,ready.sample,ready.sampleHash,ready.providerRequestId,ready.consentedAt]);
   // Only hide this request's newly-created private staging entry. A reused
   // library entry may be in other drafts and is never removed here.
   if(claimed.created)await db.query('UPDATE "WorkspaceVoice" SET "deletedAt"=NOW(),"enabled"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,ready.id]);
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.opening.promoted',resourceType:'voices',resourceId:source.id,metadata:{agentId,sampleHash:hash}});
  return {...result,id:source.id,name:source.name as string,cached:!claimed.submit,promoted:true};
 }
 return {...result,name:claimed.row.name as string,cached:!claimed.submit};
}
