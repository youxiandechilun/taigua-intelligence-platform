/*
 * 中文导读：声音库的调教设置、试听生成与有效配置读取。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type Scope,type CrmDb,type Row} from '../crm/crm.service.js';
import {grants} from '../workspace/company-policy.js';
import {voiceDeliverySchema,workspaceVoicePolicy,voiceExpressionInstructions,voiceAudioSettings} from './voice-delivery-policy.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {readyVoiceOpening} from './voice-opening-store.js';
import {synthesizePreview} from './voices.service.js';
import {realtimeAuthorized} from './models.service.js';
import {modelKey,credentialScope} from './model-credentials.js';
import {keyFingerprint,storeModelUsage,tokenUsage} from './model-telemetry.js';
import {voicePreviewVersion} from './voice-preview-text.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import {voiceReferenceExpression} from './voice-reference-expression.js';
import {voiceSynthesisSignature,voiceSynthesis,effectiveSpeechSynthesis} from './voice-synthesis.js';
import {synthesisDeliveryVersion} from './voice-synthesis-delivery.js';

async function managed(s:Scope){if(!grants((await memberAccess(crmDb,s)).permissions,'agentConfiguration','update'))throw new ForbiddenError('声音调试由获授权的声音库负责人维护。');}
export async function effectiveVoiceTuning(workspaceId:string,voiceId:string,db:CrmDb=crmDb){
 const row=voiceId?(await db.query('SELECT "settings","volume","updatedAt" FROM "WorkspaceVoiceTuning" WHERE "workspaceId"=$1 AND "voiceId"=$2',[workspaceId,voiceId]))[0]:undefined;
 const policy=row?voiceDeliverySchema.parse(row.settings):await workspaceVoicePolicy(workspaceId,db);
 const audio=voiceAudioSettings(policy);
 return {settings:policy,audio,volume:row?.volume??100,updatedAt:row?.updatedAt||null,source:row?'person':'system'};
}
export async function tuningDetail(s:Scope,id:string){
 await managed(s);
 if(!(await crmDb.query('SELECT "id" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "provider"=\'HAOKEHU_SIP\'',[s.workspaceId,id])).length)throw new NotFoundError('真人声音不存在。');
 return {...await effectiveVoiceTuning(s.workspaceId,id),canConfigure:true};
}
export async function saveVoiceTuning(s:Scope,id:string,input:unknown){
 await managed(s);const data=z.object({settings:voiceDeliverySchema,volume:z.number().int().min(50).max(150),expectedUpdatedAt:z.iso.datetime().nullable()}).strict().parse(input);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  if(!(await db.query('SELECT "id" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "provider"=\'HAOKEHU_SIP\'',[s.workspaceId,id])).length)throw new NotFoundError('真人声音不存在。');
  const prior=(await db.query('SELECT "updatedAt" FROM "WorkspaceVoiceTuning" WHERE "workspaceId"=$1 AND "voiceId"=$2',[s.workspaceId,id]))[0];
  if((prior?new Date(prior.updatedAt).toISOString():null)!==data.expectedUpdatedAt)throw new BadRequestError('这个人的声音设置已被其他页面更新，请刷新后再调试。');
  await db.query('INSERT INTO "WorkspaceVoiceTuning" ("workspaceId","voiceId","settings","volume","updatedBy") VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT ("workspaceId","voiceId") DO UPDATE SET "settings"=EXCLUDED."settings","volume"=EXCLUDED."volume","updatedBy"=EXCLUDED."updatedBy","updatedAt"=NOW()',[s.workspaceId,id,JSON.stringify(data.settings),data.volume,s.userId]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.person-tuning.saved',resourceType:'voices',resourceId:id});return tuningDetail(s,id);
}
function auditionResult(row:Row,cached:boolean){return {id:row.id,requestId:row.requestId,status:row.status,text:row.text,cached,error:row.error,audio:row.status==='READY'&&row.audio?Buffer.from(row.audio).toString('base64'):null};}
async function auditionContext(s:Scope,id:string,draftSettings?:z.infer<typeof voiceDeliverySchema>){
 const opening=await readyVoiceOpening(s,id);
 const [tuning,voices,key]=await Promise.all([effectiveVoiceTuning(s.workspaceId,id),crmDb.query('SELECT "voice","targetModel" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,id]),modelKey(s.workspaceId,'DASHSCOPE_API_KEY')]);
 const voice=voices[0]!;
 const settings=draftSettings??tuning.settings;
 const expression=voiceExpressionInstructions(settings)+voiceReferenceExpression({text:opening.text,durationSeconds:opening.durationSeconds,analysis:opening.analysis});
 const speechSynthesis=effectiveSpeechSynthesis(voice.targetModel,voice.voice,settings,{voiceId:id,credentialScope:credentialScope(s.workspaceId)});
 // Keep cache lookup and generation on the same expression and source identity.
 // Listening, background and playback-volume edits do not change model audio.
 const signature=(text:string)=>keyFingerprint(JSON.stringify([voicePreviewVersion,synthesisDeliveryVersion,speechSynthesis,voice.voice,voice.targetModel,...voiceSynthesisSignature(voice.targetModel,voice.voice),opening.sourceHash,expression,text,keyFingerprint(key)]));
 return {voice,key,expression,speechSynthesis,signature};
}
export async function currentVoicePreview(s:Scope,id:string){
 // Ordinary users may play their available voice, without management permission
 // or any paid generation. Never fall back to an earlier expression sample.
 const context=await auditionContext(s,id);
 const candidates=await crmDb.query('SELECT "id","text","signature" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "status"=\'READY\' AND "audio" IS NOT NULL ORDER BY "createdAt" DESC',[s.workspaceId,id]);
 const current=candidates.find(row=>row.signature===context.signature(row.text));
 if(!current)throw new BadRequestError('当前声音设置还没有试听，请在声音库的“声音调试与试听”中生成并保存一次。');
 const row=(await crmDb.query('SELECT "audio" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "id"=$3 AND "signature"=$4 AND "status"=\'READY\'',[s.workspaceId,id,current.id,current.signature]))[0];
 if(!row?.audio)throw new NotFoundError('这条试听暂不可用，请刷新声音库后重试。');
 return Buffer.from(row.audio);
}
export async function voiceAuditions(s:Scope,id:string){
 await managed(s);await tuningDetail(s,id);
 return crmDb.query('SELECT "id","requestId","status","text","error","createdAt","updatedAt" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "voiceId"=$2 ORDER BY "createdAt" DESC LIMIT 50',[s.workspaceId,id]);
}
export async function voiceAuditionAudio(s:Scope,id:string,auditionId:string){
 await managed(s);
 const row=(await crmDb.query('SELECT "audio" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "id"=$3 AND "status"=\'READY\'',[s.workspaceId,id,auditionId]))[0];if(!row?.audio)throw new NotFoundError('这条试听尚未生成完成。');return Buffer.from(row.audio);
}
export async function createVoiceAudition(s:Scope,id:string,input:unknown){
 await managed(s);const data=z.object({text:z.string().trim().min(1).max(300),requestId:z.string().uuid(),confirmed:z.literal(true),settings:voiceDeliverySchema.optional(),retryOf:z.string().uuid().optional(),retryConfirmed:z.literal(true).optional()}).strict().refine(v=>!v.retryOf||v.retryConfirmed===true,'请先核对上次请求，再确认重新生成。').parse(input);
 const {voice:v,key,expression,speechSynthesis,signature:signatureForText}=await auditionContext(s,id,data.settings);
 await realtimeAuthorized(s.workspaceId,v.targetModel);
 const signature=signatureForText(data.text);
 const claimed=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-audition:'+s.workspaceId]);
  const request=(await db.query('SELECT * FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "requestId"=$2',[s.workspaceId,data.requestId]))[0];
  if(request){if(request.voiceId!==id||request.signature!==signature)throw new BadRequestError('这个试听请求已使用，请重新打开调试窗口。');return {row:request,generate:false};}
  let prior=(await db.query('SELECT * FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "signature"=$3',[s.workspaceId,id,signature]))[0];
  if(prior){
   if(prior.status==='GENERATING'&&Date.now()-new Date(prior.updatedAt).getTime()>120000)prior=(await db.query('UPDATE "WorkspaceVoiceAudition" SET "status"=\'NEEDS_REVIEW\',"error"=\'上次生成未返回结果，不会重复提交，请先核对。\',"updatedAt"=NOW() WHERE "id"=$1 RETURNING *',[prior.id]))[0]!;
   if(data.retryOf&&data.retryOf!==prior.id)throw new BadRequestError('上次试听的文案或声音参数已变更，请按当前参数生成新的试听。');
   if(data.retryOf&&prior.status==='NEEDS_REVIEW'){
  if((await db.query('SELECT "id" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "status"=\'GENERATING\' AND "updatedAt">NOW()-INTERVAL \'2 minutes\'',[s.workspaceId])).length>=6)throw new BadRequestError('声音调试正在生成，请稍后再试。');
    const row=(await db.query('UPDATE "WorkspaceVoiceAudition" SET "status"=\'GENERATING\',"requestId"=$2,"error"=\'\',"audio"=NULL,"updatedAt"=NOW() WHERE "id"=$1 AND "status"=\'NEEDS_REVIEW\' RETURNING *',[prior.id,data.requestId]))[0]!;
    return {row,generate:true};
   }
   return {row:prior,generate:false};
  }
  if(data.retryOf)throw new BadRequestError('上次试听的文案或声音参数已变更，请按当前参数生成新的试听。');
  if((await db.query('SELECT "id" FROM "WorkspaceVoiceAudition" WHERE "workspaceId"=$1 AND "status"=\'GENERATING\' AND "updatedAt">NOW()-INTERVAL \'2 minutes\'',[s.workspaceId])).length>=6)throw new BadRequestError('声音调试正在生成，请稍后再试。');
  const row=(await db.query('INSERT INTO "WorkspaceVoiceAudition" ("id","workspaceId","voiceId","signature","requestId","status","text","createdBy") VALUES ($1,$2,$3,$4,$5,\'GENERATING\',$6,$7) RETURNING *',[randomUUID(),s.workspaceId,id,signature,data.requestId,data.text,s.userId]))[0]!;return {row,generate:true};
 });
 if(!claimed.generate)return auditionResult(claimed.row,true);
 let usage:unknown;try{
  const audio=await synthesizePreview(key,v.targetModel,v.voice,{text:data.text,language:'zh-CN',expression,speechSynthesis,onUsage:value=>{usage=value;}});
  const row=(await crmDb.query('UPDATE "WorkspaceVoiceAudition" SET "status"=\'READY\',"audio"=$2,"usage"=$3::jsonb,"updatedAt"=NOW() WHERE "id"=$1 AND "status"=\'GENERATING\' RETURNING *',[claimed.row.id,audio,JSON.stringify(usage??null)]))[0]!;return auditionResult(row,false);
 }catch(e){const row=(await crmDb.query('UPDATE "WorkspaceVoiceAudition" SET "status"=\'NEEDS_REVIEW\',"error"=$2,"usage"=$3::jsonb,"updatedAt"=NOW() WHERE "id"=$1 RETURNING *',[claimed.row.id,e instanceof BadRequestError?e.message:'本次试听结果未确认，不会自动重复生成。',JSON.stringify(usage??null)]))[0]!;return auditionResult(row,false);}
 finally{const tokens=tokenUsage(usage);await storeModelUsage(s.workspaceId,'qwen',voiceSynthesis(v.targetModel,v.voice)?.model||v.targetModel,'VOICE_PREVIEW','voice-center:'+claimed.row.requestId,{...tokens,requests:1,missingUsage:tokens.totalTokens===null?1:0}).catch(()=>{});}
}
