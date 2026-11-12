/*
 * 中文导读：线路与语音外呼：voice-opening.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type Scope,type Row} from '../crm/crm.service.js';
import {grants} from '../workspace/company-policy.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import CustomApiError from '../../common/errors/customApiError.js';
import {inspectSample,submitVoiceEnrollment} from './voices.service.js';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import {realtimeAuthorized} from './models.service.js';
import {telephoneOpening,analyzeOpening,audioHash} from './voice-opening-audio.js';
import {transcribeOpening} from './voice-opening-transcription.js';
import {voiceAccessible} from './voice-options.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import {requireScriptManager} from '../agent/script-access.js';

const textRevisionSql = `md5(jsonb_build_array(o."id",o."text",to_char(o."updatedAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US'),o."analysis"->>'transcriptionSource')::text)`;
async function manage(s:Scope){if(!grants((await memberAccess(crmDb,s)).permissions,'agentConfiguration','update'))throw new ForbiddenError('声音库由获授权的负责人维护。');}
const upload=z.object({name:z.string().trim().min(1).max(60),fileName:z.string().trim().min(1).max(200),gender:z.enum(['neutral','female','male']).default('neutral'),audio:z.string().max(2800000),consented:z.literal(true)}).strict();
export async function createOpeningVoice(s:Scope,input:unknown){
 await manage(s);await requireScriptManager(s);const data=upload.parse(input);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))throw new BadRequestError('录音编码不正确。');
 const sample=Buffer.from(data.audio,'base64');if(sample.toString('base64')!==data.audio)throw new BadRequestError('录音编码不完整。');
 const {seconds,rate}=inspectSample(sample);if(seconds>43)throw new BadRequestError('开场原录音请控制在3至43秒。');
 const audio=telephoneOpening(sample,rate),analysis=analyzeOpening(audio),hash=audioHash(sample);
 await realtimeAuthorized(s.workspaceId,CALL_VOICE_MODEL);
 const claimed=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const existing=(await db.query('SELECT v."id",v."name",o."status" FROM "WorkspaceVoice" v JOIN "WorkspaceVoiceOpening" o ON o."workspaceId"=v."workspaceId" AND o."voiceId"=v."id" WHERE v."workspaceId"=$1 AND v."sampleHash"=$2 AND v."deletedAt" IS NULL ORDER BY v."createdAt" LIMIT 1',[s.workspaceId,hash]))[0];
  if(existing)return {id:existing.id as string,status:existing.status as string,cached:true};
  if(Number((await db.query('SELECT COUNT(*)::int AS count FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL AND "provider"=\'HAOKEHU_SIP\'',[s.workspaceId]))[0]?.count)>=200)throw new BadRequestError('声音库已满，请先整理未使用的声音。');
  const id=randomUUID();
  await db.query('INSERT INTO "WorkspaceVoice" ("id","workspaceId","createdBy","name","targetModel","sample","sampleHash","consentedAt","gender") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)',[id,s.workspaceId,s.userId,data.name,CALL_VOICE_MODEL,sample,hash,data.gender]);
  await db.query('INSERT INTO "WorkspaceVoiceOpening" ("id","workspaceId","voiceId","createdBy","fileName","sourceHash","sha256","audio","durationSeconds","analysis") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[randomUUID(),s.workspaceId,id,s.userId,data.fileName,hash,audioHash(audio),audio,seconds,JSON.stringify(analysis)]);
  return {id,status:'ANALYZING',cached:false};
 });
 if(!claimed.cached)void processOpening(s,claimed.id).catch(()=>{});
 return claimed;
}
// A durable transition claims each paid stage once. A restart or a lost reply
// leaves a reviewable record, never a background automatic resubmission.
export async function processOpening(s:Scope,id:string){
 const opening=(await crmDb.query('UPDATE "WorkspaceVoiceOpening" SET "status"=\'TRANSCRIBING\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "status"=\'ANALYZING\' RETURNING *',[s.workspaceId,id]))[0];if(!opening)return;
 try{
  const text=await transcribeOpening(s.workspaceId,Buffer.from(opening.audio));
  const updated=await crmDb.query(`UPDATE "WorkspaceVoiceOpening" SET
    "text"=CASE WHEN "analysis"->>'transcriptionSource'='manual' THEN "text" ELSE $3 END,
    "analysis"=COALESCE("analysis",'{}'::jsonb)||$4::jsonb||CASE WHEN "analysis"->>'transcriptionSource'='manual' THEN jsonb_build_object('transcriptionSource','manual') ELSE '{}'::jsonb END,
    "status"='ENROLLING',"updatedAt"=NOW()
    WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "status"='TRANSCRIBING' RETURNING "id"`,[s.workspaceId,id,text,JSON.stringify({referenceText:text,charactersPerSecond:Math.round(text.replace(/[\p{P}\s]/gu,'').length/Math.max(1,opening.analysis.speechSeconds)*100)/100,transcriptionSource:'model'})]);
  if(updated.length)await completeOpeningEnrollment(s,id);
 }catch{
  await crmDb.query('UPDATE "WorkspaceVoiceOpening" SET "status"=\'NEEDS_REVIEW\',"error"=\'识别或复刻未完成，请核对开场文字和处理状态，不会自动重复收费。\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "status" IN (\'TRANSCRIBING\',\'ENROLLING\')',[s.workspaceId,id]);
 }
}
export async function completeOpeningEnrollment(s:Scope,id:string){
 const v=(await crmDb.query('UPDATE "WorkspaceVoice" v SET "status"=\'SUBMITTING\',"updatedAt"=NOW() FROM "WorkspaceVoiceOpening" o WHERE v."workspaceId"=$1 AND v."id"=$2 AND v."deletedAt" IS NULL AND v."status"=\'DRAFT\' AND o."voiceId"=v."id" AND o."workspaceId"=v."workspaceId" AND o."status"=\'ENROLLING\' AND o."text"<>\'\' RETURNING v.*',[s.workspaceId,id]))[0];
 if(!v)return;
 const result=await submitVoiceEnrollment(s.workspaceId,v);
 await crmDb.query('UPDATE "WorkspaceVoiceOpening" SET "status"=$3,"error"=$4,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "voiceId"=$2',[s.workspaceId,id,result.status==='READY'?'READY':'NEEDS_REVIEW',result.error]);
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.opening-package.created',resourceType:'voices',resourceId:id,metadata:{status:result.status,sourceHash:v.sampleHash}});
}
export async function openingDetail(s:Scope,id:string){
 const access=await memberAccess(crmDb,s);
 const row=(await crmDb.query(`SELECT o."id",o."fileName",o."sourceHash",o."sha256",o."durationSeconds",o."text",o."analysis",o."status",o."error",o."updatedAt",${textRevisionSql} AS "revision",v."employeeVisible",v."assignedUserIds" FROM "WorkspaceVoice" v JOIN "WorkspaceVoiceOpening" o ON o."voiceId"=v."id" AND o."workspaceId"=v."workspaceId" WHERE v."workspaceId"=$1 AND v."id"=$2 AND v."deletedAt" IS NULL`,[s.workspaceId,id]))[0];
 if(!row||(!grants(access.permissions,'agentConfiguration','update')&&!voiceAccessible(row,s.userId)))throw new NotFoundError('开场录音不存在或无权使用。');
 const {employeeVisible,assignedUserIds,...detail}=row;return {...detail,ready:row.status==='READY'};
}
export async function correctOpening(s:Scope,id:string,input:unknown){
 await manage(s);
 await requireScriptManager(s);
 const data=z.object({text:z.string().trim().min(1).max(4000),expectedUpdatedAt:z.iso.datetime(),expectedRevision:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict().parse(input);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const prior=(await db.query(`SELECT o.*,${textRevisionSql} AS revision FROM "WorkspaceVoiceOpening" o JOIN "WorkspaceVoice" v
    ON v."workspaceId"=o."workspaceId" AND v."id"=o."voiceId" WHERE o."workspaceId"=$1 AND o."voiceId"=$2 AND v."deletedAt" IS NULL FOR UPDATE OF o`,[s.workspaceId,id]))[0];
  if(!prior)throw new NotFoundError('开场录音不存在。');
  const matches=data.expectedRevision?data.expectedRevision===prior.revision:new Date(prior.updatedAt).toISOString()===data.expectedUpdatedAt;
  if(!matches)throw new CustomApiError('开场文字已被其他页面更新，当前输入已保留，请读取最新文字后合并。',409);
  if(prior.text===data.text)return;
  // A display correction never changes audio, enrollment state, or measured delivery.
  const reference=typeof prior.analysis?.referenceText==='string'?prior.analysis.referenceText:prior.text;
  await db.query(`UPDATE "WorkspaceVoiceOpening" SET "text"=$3,"analysis"=COALESCE("analysis",'{}'::jsonb)||$4::jsonb,
    "updatedAt"=GREATEST(NOW(),date_trunc('milliseconds',"updatedAt")+INTERVAL '1 millisecond')
    WHERE "workspaceId"=$1 AND "voiceId"=$2 RETURNING "id"`,[s.workspaceId,id,data.text,JSON.stringify({transcriptionSource:'manual',...(reference?{referenceText:reference}:{})})]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.opening-text.saved',resourceType:'voices',resourceId:id});
 return openingDetail(s,id);
}
