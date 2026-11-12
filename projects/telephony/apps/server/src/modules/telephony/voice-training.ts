/*
 * 中文导读：线路与语音外呼：voice-training.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import {type Scope} from '../crm/crm.service.js';
import {tuningDetail,effectiveVoiceTuning} from './voice-tuning.js';
import {readyVoiceOpening} from './voice-opening-store.js';
import {inspectLearningWav} from '../agent/agent.learning.js';
import {analyzeOpening,telephoneOpening,audioHash} from './voice-opening-audio.js';
import {transcribeOpening} from './voice-opening-transcription.js';
import {voiceDeliverySchema} from './voice-delivery-policy.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';

const select='"id","name","prompt","transcript","analysis","status","error","durationSeconds","createdAt","updatedAt","appliedAt"';
export async function trainingList(s:Scope,id:string){
 await tuningDetail(s,id);
 await crmDb.query(`UPDATE "WorkspaceVoiceTraining" SET "status"='NEEDS_REVIEW',"error"='处理结果未确认，请先核对；没有自动重复调用。',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "status"='PROCESSING' AND "updatedAt"<NOW()-INTERVAL '3 minutes'`,[s.workspaceId,id]);
 return crmDb.query(`SELECT ${select} FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2 ORDER BY "createdAt" DESC LIMIT 60`,[s.workspaceId,id]);
}
export async function trainingAudio(s:Scope,id:string,sample:string){await tuningDetail(s,id);const row=(await crmDb.query('SELECT "audio" FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "id"=$3',[s.workspaceId,id,sample]))[0];if(!row)throw new BadRequestError('训练样本不存在。');return Buffer.from(row.audio);}
const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)]||0;
export function trainingDirection(samples:Array<{transcript:string;durationSeconds:number;analysis:Record<string,unknown>}>){
 const pace=median(samples.map(r=>r.transcript.replace(/[\p{P}\s]/gu,'').length/r.durationSeconds).filter(n=>n>=1.5&&n<=8));
 const pause=median(samples.map(r=>Number(r.analysis.medianPauseMs)).filter(n=>n>=160&&n<=1500));
 return {pace,pause,direction:'【真人对练参考】'+(pace?'本人多轮有效样本的中位节奏约'+pace.toFixed(1)+'字/秒，仅作相对语速参考。':'')+(pause?'意群停顿约'+pause+'毫秒，保持词组连贯。':'')+'用放松的日常口语，回应当前问题后停下；沿用当前人物声线，不朗读训练题目或测量值。'};
}
export async function uploadTraining(s:Scope,id:string,input:unknown){
 const data=z.object({requestId:z.string().uuid(),name:z.string().trim().min(1).max(160),prompt:z.string().max(500).default(''),audio:z.string().max(2800000),consented:z.literal(true),sameSpeaker:z.literal(true),expectedUpdatedAt:z.iso.datetime().nullable()}).strict().parse(input);
 const tuning=await tuningDetail(s,id),opening=await readyVoiceOpening(s,id);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))throw new BadRequestError('录音编码不正确。');
 const buffer=Buffer.from(data.audio,'base64'),info=inspectLearningWav(buffer);if(info.seconds>60)throw new BadRequestError('每轮训练录音请控制在2至60秒。');
 const audio=telephoneOpening(buffer,info.rate),analysis=analyzeOpening(audio),hash=audioHash(audio);
 if(analysis.clippingRatio>0.01||analysis.speechSeconds<2)throw new BadRequestError('样本人声不足或失真过多，请重新录制。');
 const claim=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const repeat=(await db.query('SELECT "id","voiceId","sourceHash","status" FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND ("requestId"=$2 OR ("voiceId"=$3 AND "sourceHash"=$4))',[s.workspaceId,data.requestId,id,hash]))[0];
  if(repeat){if(repeat.voiceId!==id||repeat.sourceHash!==hash)throw new BadRequestError('此请求已使用。');return {id:repeat.id as string,cached:true};}
  const fresh=await effectiveVoiceTuning(s.workspaceId,id,db),reference=await readyVoiceOpening(s,id,db);
  if((fresh.updatedAt?new Date(fresh.updatedAt).toISOString():null)!==data.expectedUpdatedAt||reference.sourceHash!==opening.sourceHash)throw new BadRequestError('声音设置已更新，请刷新后再提交训练。');
  if((await db.query(`SELECT "id" FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "status"='PROCESSING'`,[s.workspaceId])).length)throw new BadRequestError('公司有声音样本正在处理，请稍后再试。');
  const count=(await db.query('SELECT COUNT(*)::int n FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2',[s.workspaceId,id]))[0]?.n;if(Number(count)>=60)throw new BadRequestError('这个人的训练样本已达到60条，请先由管理员整理。');
  const sample=randomUUID();await db.query(`INSERT INTO "WorkspaceVoiceTraining" ("id","workspaceId","voiceId","createdBy","requestId","sourceHash","openingHash","name","prompt","audio","durationSeconds","analysis","beforeTuning") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,[sample,s.workspaceId,id,s.userId,data.requestId,hash,opening.sourceHash,data.name,data.prompt,audio,info.seconds,JSON.stringify(analysis),JSON.stringify({settings:tuning.settings,volume:tuning.volume,updatedAt:tuning.updatedAt})]);return {id:sample,cached:false};
 });
 if(!claim.cached)void processTraining(s,id,claim.id,data.expectedUpdatedAt).catch(()=>{});
 return claim;
}
async function processTraining(s:Scope,id:string,sample:string,expected:string|null){
 try{
  const row=(await crmDb.query('SELECT * FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "id"=$3 AND "status"=\'PROCESSING\'',[s.workspaceId,id,sample]))[0];if(!row)return;
  const transcript=await transcribeOpening(s.workspaceId,Buffer.from(row.audio));
  if(transcript.replace(/[\p{P}\s]/gu,'').length<6)throw new BadRequestError('可识别人声太少，未更新声音参数。');
  await crmDb.query('UPDATE "WorkspaceVoiceTraining" SET "transcript"=$2,"updatedAt"=NOW() WHERE "id"=$1',[sample,transcript]);
  await crmDb.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
   const state=(await db.query('SELECT status FROM "WorkspaceVoiceTraining" WHERE id=$1 FOR UPDATE',[sample]))[0];
   if(state?.status!=='PROCESSING')throw new BadRequestError('这次处理已结束或待核对，未修改设置。');
   const current=await effectiveVoiceTuning(s.workspaceId,id,db),opening=await readyVoiceOpening(s,id,db);
   if((current.updatedAt?new Date(current.updatedAt).toISOString():null)!==expected||opening.sourceHash!==row.openingHash)throw new BadRequestError('声音或设置已在其他页面修改。样本已保存，本轮未覆盖设置。');
   const samples=await db.query(`SELECT "transcript","durationSeconds","analysis" FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "openingHash"=$3 AND ("status"='APPLIED' OR "id"=$4) ORDER BY "createdAt" DESC LIMIT 12`,[s.workspaceId,id,row.openingHash,sample]);
   const style=trainingDirection(samples as any),direction=current.settings.customDirection.replace(/\n?【真人对练参考】[\s\S]*$/u,'').slice(0,350);
   const next=voiceDeliverySchema.parse({...current.settings,customDirection:(direction+'\n'+style.direction).trim()});
   await db.query(`INSERT INTO "WorkspaceVoiceTuning" ("workspaceId","voiceId","settings","volume","updatedBy") VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT ("workspaceId","voiceId") DO UPDATE SET "settings"=EXCLUDED."settings","volume"=EXCLUDED."volume","updatedBy"=EXCLUDED."updatedBy","updatedAt"=NOW()`,[s.workspaceId,id,JSON.stringify(next),current.volume,s.userId]);
   const after=await effectiveVoiceTuning(s.workspaceId,id,db);
   await db.query(`UPDATE "WorkspaceVoiceTraining" SET "status"='APPLIED',"analysis"="analysis"||$2::jsonb,"afterTuning"=$3::jsonb,"appliedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`,[sample,JSON.stringify({learnedPace:style.pace,learnedPauseMs:style.pause,samples:samples.length,method:'acoustic-style-reference-v1'}),JSON.stringify({settings:after.settings,volume:after.volume,updatedAt:after.updatedAt})]);
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.training.applied',resourceType:'voices',resourceId:id,metadata:{sampleId:sample}});
 }catch(e){await crmDb.query(`UPDATE "WorkspaceVoiceTraining" SET "status"='NEEDS_REVIEW',"error"=$2,"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PROCESSING'`,[sample,e instanceof BadRequestError?e.message:'样本识别未完成，已保留录音；请核对模型服务记录。']).catch(()=>{});}
}
export async function rollbackTraining(s:Scope,id:string,sample:string,input:unknown){
 await tuningDetail(s,id);const data=z.object({expectedUpdatedAt:z.iso.datetime(),confirmed:z.literal(true)}).strict().parse(input);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const row=(await db.query('SELECT * FROM "WorkspaceVoiceTraining" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "id"=$3 AND "status"=\'APPLIED\'',[s.workspaceId,id,sample]))[0],current=await effectiveVoiceTuning(s.workspaceId,id,db);
  if(!row?.afterTuning||new Date(current.updatedAt).toISOString()!==data.expectedUpdatedAt||!isDeepStrictEqual(current.settings,voiceDeliverySchema.parse(row.afterTuning.settings)))throw new BadRequestError('后续设置已经变化，不能覆盖；请先核对当前设置。');
  const settings=voiceDeliverySchema.parse(row.beforeTuning.settings);
  await db.query('UPDATE "WorkspaceVoiceTuning" SET "settings"=$3::jsonb,"volume"=$4,"updatedBy"=$5,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "voiceId"=$2',[s.workspaceId,id,JSON.stringify(settings),row.beforeTuning.volume,s.userId]);
  await db.query('UPDATE "WorkspaceVoiceTraining" SET "status"=\'ROLLED_BACK\',"updatedAt"=NOW() WHERE "id"=$1',[sample]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.training.rolled-back',resourceType:'voices',resourceId:id,metadata:{sampleId:sample}});return {restored:true};
}
