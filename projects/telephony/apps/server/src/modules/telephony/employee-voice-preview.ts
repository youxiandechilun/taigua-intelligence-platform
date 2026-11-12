/*
 * 中文导读：线路与语音外呼：employee-voice-preview.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {effectiveVoiceTuning} from './voice-tuning.js';
import {voiceExpressionInstructions} from './voice-delivery-policy.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type Scope,type Row} from '../crm/crm.service.js';
import {grants} from '../workspace/company-policy.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {sipProfileSchema} from './sip.schema.js';
import {presets,realtimeAuthorized} from './models.service.js';
import {modelKey,credentialScope} from './model-credentials.js';
import {keyFingerprint,storeModelUsage,tokenUsage} from './model-telemetry.js';
import {modelPlatforms} from './model-platforms.js';
import {resolvedVoice,synthesizePreview} from './voices.service.js';
import {voicePreviewVersion} from './voice-preview-text.js';
import {readyVoiceOpening} from './voice-opening-store.js';
import {voiceReferenceExpression} from './voice-reference-expression.js';
import {voiceSynthesisSignature,voiceSynthesis,effectiveSpeechSynthesis} from './voice-synthesis.js';
import {synthesisDeliveryVersion} from './voice-synthesis-delivery.js';

const schema=z.object({profile:sipProfileSchema,text:z.string().trim().min(1,'请填写试听文字。').max(300,'试听文字最多300字。'),requestId:z.string().uuid(),retryOf:z.string().uuid().optional(),confirmed:z.literal(true)}).strict();
function result(row:Row,cached:boolean){
 return {status:row.status as 'GENERATING'|'READY'|'NEEDS_REVIEW',requestId:row.requestId as string,model:row.model as string,voice:row.voice as string,cached,error:row.error as string,audio:row.status==='READY'&&row.audio?Buffer.from(row.audio).toString('base64'):null};
}

// Generation is explicit. Identical concurrent submissions and transport retries
// share one durable result; uncertain failures require a separate manual retry.
export async function employeeVoicePreview(s:Scope,agentId:string,input:unknown){
 if(!grants((await memberAccess(crmDb,s)).permissions,'agentConfiguration','update'))throw new ForbiddenError('请由获授权的培训负责人试听声音。');
 const data=schema.parse(input);
 if(!(await crmDb.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "deletionRequestedAt" IS NULL',[s.workspaceId,agentId])).length)throw new NotFoundError('数字员工不存在或不属于当前工作区。');
 return generateVoicePreview(s,agentId,data);
}
// Callers authorize either training access or use of the published assistant.
// Personal callers supply only a server-resolved, authorized voice profile.
export async function generateVoicePreview(s:Scope,agentId:string,data:z.infer<typeof schema>){
 const {model,voice}=await resolvedVoice(s.workspaceId,data.profile);
 await realtimeAuthorized(s.workspaceId,model);
 const preset=presets.find(p=>p.kind==='realtime'&&p.id===model)!;
 const key=await modelKey(s.workspaceId,preset.key);
 if(!key)throw new BadRequestError('请先配置所选平台的模型密钥。');
 const opening=data.profile.voiceId?await readyVoiceOpening(s,data.profile.voiceId):null;
 const tuning=await effectiveVoiceTuning(s.workspaceId,data.profile.voiceId||'');
 const expression=voiceExpressionInstructions(tuning.settings)+(opening?voiceReferenceExpression({text:opening.text,durationSeconds:opening.durationSeconds,analysis:opening.analysis}):'');
 const speechSynthesis=effectiveSpeechSynthesis(model,voice,tuning.settings,{voiceId:data.profile.voiceId,credentialScope:credentialScope(s.workspaceId)});
 const signature=keyFingerprint(JSON.stringify([voicePreviewVersion,synthesisDeliveryVersion,speechSynthesis,opening?.sourceHash,expression,s.userId,model,voice,...voiceSynthesisSignature(model,voice),data.profile.language,data.text,keyFingerprint(key)]));
 const selected=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['employee-voice-preview:'+s.workspaceId]);
  let row=(await db.query('SELECT * FROM "AgentVoicePreview" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "signature"=$3',[s.workspaceId,agentId,signature]))[0];
  if(row?.status==='READY')return {row,generate:false};
  if(row?.status==='GENERATING'){
   if(Date.now()-new Date(row.updatedAt).getTime()<120000)return {row,generate:false};
   row=(await db.query('UPDATE "AgentVoicePreview" SET "status"=\'NEEDS_REVIEW\',"error"=\'上次试听未返回结果，系统没有自动重复生成。\',"updatedAt"=NOW() WHERE "id"=$1 RETURNING *',[row.id]))[0]!;
  }
  if(row&&(data.retryOf!==row.requestId||data.requestId===row.requestId))return {row,generate:false};
  const active=await db.query('SELECT "requestedBy" FROM "AgentVoicePreview" WHERE "workspaceId"=$1 AND "status"=\'GENERATING\' AND "updatedAt">NOW()-INTERVAL \'2 minutes\'',[s.workspaceId]);
  if(active.some(r=>r.requestedBy===s.userId))throw new BadRequestError('你的声音试听正在生成，请稍后再试。');
  if(active.length>=6)throw new BadRequestError('试听服务当前较忙，请稍后再试。');
  if(row)row=(await db.query('UPDATE "AgentVoicePreview" SET "requestId"=$2,"status"=\'GENERATING\',"error"=\'\',"usage"=NULL,"updatedAt"=NOW() WHERE "id"=$1 RETURNING *',[row.id,data.requestId]))[0]!;
  else row=(await db.query('INSERT INTO "AgentVoicePreview" ("id","workspaceId","agentId","signature","requestId","model","voice","status","requestedBy") VALUES ($1,$2,$3,$4,$5,$6,$7,\'GENERATING\',$8) RETURNING *',[randomUUID(),s.workspaceId,agentId,signature,data.requestId,model,voice,s.userId]))[0]!;
  return {row,generate:true};
 });
 if(!selected.generate)return result(selected.row,true);
 let usage:unknown,transcript='';
 try{
  const audio=await synthesizePreview(key,model,voice,{text:data.text,language:data.profile.language,expression,speechSynthesis,onUsage:value=>{usage=value;},onTranscript:value=>{transcript=value;}});
  const rows=await crmDb.query('UPDATE "AgentVoicePreview" SET "status"=\'READY\',"audio"=$3,"usage"=$4::jsonb,"error"=\'\',"updatedAt"=NOW() WHERE "id"=$1 AND "requestId"=$2 RETURNING *',[selected.row.id,data.requestId,audio,JSON.stringify({...((usage&&typeof usage==='object')?usage:{}),previewTextVersion:voicePreviewVersion,previewText:data.text,previewTranscript:transcript})]);
  if(!rows[0])throw new BadRequestError('试听结果已更新，请重新查看。');
  // Keep paid, text-checked clips durable; replay must not trigger synthesis.
  return result(rows[0],false);
 }catch(e){
  const error=e instanceof BadRequestError?e.message:'试听服务暂不可用，请稍后查看结果。';
  const rows=await crmDb.query('UPDATE "AgentVoicePreview" SET "status"=\'NEEDS_REVIEW\',"error"=$3,"usage"=$4::jsonb,"updatedAt"=NOW() WHERE "id"=$1 AND "requestId"=$2 AND "status"=\'GENERATING\' RETURNING *',[selected.row.id,data.requestId,error,JSON.stringify(usage??null)]);
  if(!rows[0])throw e;
  return result(rows[0],false);
 }finally{
  const tokens=tokenUsage(usage),platform=modelPlatforms.find(p=>p.key===preset.key);
  if(platform)await storeModelUsage(s.workspaceId,platform.id,voiceSynthesis(model,voice)?.model||model,'VOICE_PREVIEW','employee-preview:'+data.requestId,{...tokens,requests:1,missingUsage:tokens.totalTokens===null?1:0}).catch(()=>{});
 }
}
