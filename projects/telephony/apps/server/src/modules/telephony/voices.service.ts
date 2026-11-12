/*
 * 中文导读：线路与语音外呼：voices.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import {CALL_VOICE_MODEL,assertFixedCallModel} from './voice-model-policy.js';
import {voiceSynthesis,synthesizeBoundVoice,effectiveSpeechSynthesis} from './voice-synthesis.js';
import {assertBuiltinVoiceEnabled} from './voice-management.js';
import {previewNarration,samePreviewText,finalAudioTranscript} from './voice-preview-text.js';
import { grants } from '../workspace/company-policy.js';
import {modelKey,credentialScope} from './model-credentials.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import WebSocket from 'ws';
import { crmDb } from '../crm/crm.db.js';
import { type Scope, type CrmDb, type Row, memberAccess } from '../crm/crm.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { realtimeAuthorized,presets } from './models.service.js';
import { builtinVoiceOptions,safeAuditionUrl } from './voice-options.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';

const voiceAccessSettings=(v:Row)=>({employeeVisible:v.employeeVisible,assignedUserIds:[...v.assignedUserIds].sort(),gender:v.gender});
export const cloneModels = [CALL_VOICE_MODEL] as const;
const maxSample = 2 * 1024 * 1024;
const newVoice = z.object({name:z.string().trim().min(1).max(60),gender:z.enum(['neutral','female','male']).default('neutral'),targetModel:z.enum(cloneModels),audio:z.string().max(2800000),consented:z.literal(true)}).strict();

// Inspect the actual WAV structure, rather than trusting a filename/MIME supplied by a browser.
export function inspectSample(sample: Buffer) {
 if (sample.length < 44 || sample.length > maxSample || sample.toString('ascii',0,4)!=='RIFF' || sample.toString('ascii',8,12)!=='WAVE') throw new BadRequestError('请上传2MB以内的 WAV 录音。');
 let format:Buffer|undefined, audio:Buffer|undefined;
 for(let offset=12;offset+8<=sample.length;){
  const size=sample.readUInt32LE(offset+4),end=offset+8+size;
  if(end>sample.length)throw new BadRequestError('录音文件不完整，请重新导出。');
  const tag=sample.toString('ascii',offset,offset+4);
  if(tag==='fmt ')format=sample.subarray(offset+8,end);
  if(tag==='data')audio=sample.subarray(offset+8,end);
  offset=end+(size%2);
 }
 if(!format||format.length<16||!audio||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt16LE(14)!==16||format.readUInt32LE(4)<24000||format.readUInt32LE(4)>48000||format.readUInt16LE(12)!==2)throw new BadRequestError('录音须为单声道、16位 PCM、24至48kHz的 WAV 格式。');
 const rate=format.readUInt32LE(4),seconds=audio.length/(rate*2);
 if(seconds<3||seconds>60||audio.length%2)throw new BadRequestError('录音需为3至60秒，推荐清晰朗读10至20秒。');
 if(format.readUInt32LE(8)!==rate*2)throw new BadRequestError('录音采样信息不正确。');
 return {seconds,rate};
}
async function managed(s:Scope){if(!grants((await memberAccess(crmDb,s)).permissions,'agentConfiguration','update'))throw new ForbiddenError('声音库由获授权的培训负责人维护。');}
async function owned(s:Scope,id:string,db:CrmDb=crmDb){const v=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,id]))[0];if(!v)throw new NotFoundError('音色不存在或不属于当前工作区。');return v;}
function builtinRows(workspaceId:string){
 return presets.filter(p=>p.kind==='realtime').flatMap(model=>builtinVoiceOptions(model.id).map(voice=>{
  const hash=createHash('sha256').update(workspaceId+'\0'+model.id+'\0'+voice.id).digest('hex');
  const id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-5'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
  return {id,name:voice.name,provider:'BUILTIN',gender:voice.gender,employeeVisible:true,assignedUserIds:[] as string[],targetModel:model.id,voice:voice.id,status:'READY',previewStatus:'NONE',error:'',hasPreview:false,createdAt:null,enabled:true,deletedAt:null};
 }));
}
export async function library(s:Scope){
 const access=await memberAccess(crmDb,s),canManage=grants(access.permissions,'agentConfiguration','update');
 await crmDb.query(`UPDATE "WorkspaceVoiceOpening" SET "status"='NEEDS_REVIEW',"error"='上次处理未返回结果，请核对；不会自动重复提交。',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "status" IN ('ANALYZING','TRANSCRIBING','ENROLLING') AND "updatedAt"<NOW()-INTERVAL '3 minutes'`,[s.workspaceId]);
 const list=await crmDb.query(`SELECT v."id",v."name",v."provider",v."gender",v."employeeVisible",v."assignedUserIds",v."targetModel",v."voice",v."status",v."previewStatus",v."error",v."createdAt",v."enabled",v."deletedAt",(v."preview" IS NOT NULL OR v."auditionUrl"<>'') AS "hasPreview",CASE WHEN o."id" IS NULL THEN NULL ELSE json_build_object('id',o."id",'status',o."status",'text',o."text",'durationSeconds',o."durationSeconds",'error',o."error",'ready',o."status"='READY' AND o."sourceHash"=v."sampleHash" AND v."status"='READY') END AS "opening" FROM "WorkspaceVoice" v LEFT JOIN "WorkspaceVoiceOpening" o ON o."workspaceId"=v."workspaceId" AND o."voiceId"=v."id" WHERE v."workspaceId"=$1 ORDER BY v."createdAt" DESC LIMIT 1200`,[s.workspaceId]);
 const managedBuiltins=new Map(list.filter(v=>v.provider==='BUILTIN').map(v=>[v.id,v]));
 const voices=[...list.filter(v=>v.provider!=='BUILTIN'),...builtinRows(s.workspaceId).map(v=>({...v,...managedBuiltins.get(v.id)}))];
 return {voiceManagementVersion:1,canManage,canManageAccess:canManage&&access.allData,models:cloneModels,voices:voices.filter(v=>!v.deletedAt).map(v=>({...v,accessRevision:configurationRevision(voiceAccessSettings(v))})),removedVoices:canManage?voices.filter(v=>v.deletedAt):[]};
}
async function manageableVoice(s:Scope,id:string,db:CrmDb){
 const row=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,id]))[0];
 if(row)return row;
 const builtin=builtinRows(s.workspaceId).find(v=>v.id===id);
 if(!builtin)throw new NotFoundError('音色不存在或不属于当前公司。');
 return (await db.query('INSERT INTO "WorkspaceVoice" ("id","workspaceId","createdBy","name","provider","gender","targetModel","voice","status") VALUES ($1,$2,$3,$4,\'BUILTIN\',$5,$6,$7,\'READY\') RETURNING *',[id,s.workspaceId,s.userId,builtin.name,builtin.gender,builtin.targetModel,builtin.voice]))[0]!;
}
export async function setVoiceEnabled(s:Scope,id:string,input:unknown){
 await managed(s);const {enabled}=z.object({enabled:z.boolean()}).strict().parse(input);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const row=await manageableVoice(s,id,db);
  if(row.deletedAt)throw new BadRequestError('该声音已删除，请先从已删除列表恢复。');
  if(row.status==='SUBMITTING'||row.previewStatus==='GENERATING')throw new BadRequestError('声音正在处理，请完成后再调整。');
  await db.query('UPDATE "WorkspaceVoice" SET "enabled"=$3,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id,enabled]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:enabled?'voice.enabled':'voice.disabled',resourceType:'voices',resourceId:id});
 return {saved:true};
}
export async function restoreVoice(s:Scope,id:string){
 await managed(s);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const row=await manageableVoice(s,id,db);
  if(!row.deletedAt)throw new BadRequestError('该声音未删除，无需恢复。');
  await db.query('UPDATE "WorkspaceVoice" SET "deletedAt"=NULL,"enabled"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.restored',resourceType:'voices',resourceId:id});
 return {restored:true};
}
export async function createVoice(s:Scope,input:unknown){
 await managed(s);const data=newVoice.parse(input);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))throw new BadRequestError('录音编码不正确。');
 const sample=Buffer.from(data.audio,'base64');inspectSample(sample);
 if(sample.toString('base64')!==data.audio)throw new BadRequestError('录音编码不完整。');
 return crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  if(Number((await db.query('SELECT count(*)::int AS count FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'HAOKEHU_SIP\' AND "deletedAt" IS NULL',[s.workspaceId]))[0]?.count)>=200)throw new BadRequestError('公司复刻声音已达200个，请先移除未使用的声音。');
  const id=randomUUID();
  await db.query('INSERT INTO "WorkspaceVoice" ("id","workspaceId","createdBy","name","targetModel","sample","sampleHash","consentedAt","gender") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8) RETURNING "id"',[id,s.workspaceId,s.userId,data.name,data.targetModel,sample,createHash('sha256').update(sample).digest('hex'),data.gender]);
  return {id,status:'DRAFT'};
 });
}
export async function enrollVoice(s:Scope,id:string,input:unknown){
 await managed(s);const data=z.object({confirmation:z.string().uuid(),consented:z.literal(true)}).strict().parse(input);
 if(data.confirmation!==id)throw new BadRequestError('请确认将这段授权录音提交阿里云进行声音复刻。');
 const v=await crmDb.transaction(async db=>{
  const row=await owned(s,id,db);if(row.enabled===false)throw new BadRequestError('请先启用该声音。');await realtimeAuthorized(s.workspaceId,row.targetModel,db);
  const updated=await db.query('UPDATE "WorkspaceVoice" SET "status"=\'SUBMITTING\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "status"=\'DRAFT\' AND "deletedAt" IS NULL RETURNING *',[s.workspaceId,id]);
  if(!updated.length)throw new BadRequestError('该录音已提交或结果待核对，系统不会重复提交。');
  return updated[0]!;
 });
 return submitVoiceEnrollment(s.workspaceId,v);
}
// Callers must authorize access and claim SUBMITTING durably before using this
// one-shot provider submission. A lost response must never create a second voice.
export async function submitVoiceEnrollment(workspaceId:string,v:Row){
 const id=v.id as string;
 let status='NEEDS_REVIEW',voice='',requestId='',error='复刻结果未确认，请联系系统管理员核对；系统不会自动重试。';
 try {
  const response=await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization',{method:'POST',headers:{Authorization:'Bearer '+await modelKey(workspaceId,'DASHSCOPE_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'qwen-voice-enrollment',parameters:{voice_clone_mode:'normal',skip_audio_process:false},input:{action:'create',target_model:v.targetModel,preferred_name:'tg_'+id.replaceAll('-','').slice(0,13),audio:{data:'data:audio/wav;base64,'+Buffer.from(v.sample).toString('base64')},language:'zh'}}),signal:AbortSignal.timeout(60000)});
  const result=await response.json() as {output?:{voice?:string;target_model?:string};request_id?:string};
  if(typeof result.request_id==='string'&&/^[\w-]{1,100}$/.test(result.request_id))requestId=result.request_id;
  if(response.ok&&result.output&&result.output.target_model===v.targetModel&&/^[A-Za-z0-9_.-]{1,160}$/.test(result.output.voice||'')){status='READY';voice=result.output.voice!;error='';}
  else if(response.status>=400&&response.status<500){status='FAILED';error='声音复刻被拒绝，请检查录音质量、模型权限和服务余额后重新创建。';}
 }catch{/* Keep an ambiguous submission quarantined; never retry a paid request. */}
 await crmDb.query('UPDATE "WorkspaceVoice" SET "status"=$3,"voice"=$4,"providerRequestId"=$5,"error"=$6,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "status"=\'SUBMITTING\' RETURNING "id"',[workspaceId,id,status,voice,requestId,error]);
 return {id,status,error};
}
export async function sourceSample(s:Scope,id:string){await managed(s);const v=await owned(s,id);if(!v.sample)throw new BadRequestError('该声音没有参考录音。');return Buffer.from(v.sample);}
export async function remotePreviewSource(s:Scope,id:string){await managed(s);const v=await owned(s,id),url=safeAuditionUrl(v.auditionUrl||'');if(v.provider!=='ALIYUN_ENGINE'||v.status!=='READY'||!url)throw new BadRequestError('该声音暂未提供试听。');return url;}
export async function saveVoiceAccess(s:Scope,id:string,input:unknown){
 const access=await memberAccess(crmDb,s);
 if(!grants(access.permissions,'agentConfiguration','update')||!access.allData)throw new ForbiddenError('音色使用范围由公司培训负责人维护。');
 const data=z.object({employeeVisible:z.boolean(),assignedUserIds:z.array(z.string().min(1).max(100)).max(1000),gender:z.enum(['neutral','female','male']),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(input);
 const users=[...new Set(data.assignedUserIds)];
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);const current=await owned(s,id,db);assertConfigurationRevision(data.expectedRevision,voiceAccessSettings(current));
  const valid=await db.query('SELECT m."userId" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."deletedAt" IS NULL AND u."banned" IS NOT TRUE AND m."userId"=ANY($2::text[])',[s.workspaceId,users]);
  if(valid.length!==users.length)throw new BadRequestError('有员工已停用或不属于当前公司，请重新选择。');
  await db.query('UPDATE "WorkspaceVoice" SET "employeeVisible"=$3,"assignedUserIds"=$4::text[],"gender"=$5,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id,data.employeeVisible,users,data.gender]);
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.audience.saved',resourceType:'voices',resourceId:id,metadata:{employeeVisible:data.employeeVisible,assignedCount:users.length}});
 return {saved:true};
}
export async function archiveVoice(s:Scope,id:string){
 await managed(s);
 return crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const v=await manageableVoice(s,id,db);
  if(v.deletedAt)throw new BadRequestError('该声音已删除。');
  if(v.status==='SUBMITTING'||v.previewStatus==='GENERATING')throw new BadRequestError('声音正在处理，请完成后再移除。');
  // Disabled voices already reject new use; retain references for history and restoration.
  if(v.enabled!==false){
   if((await db.query('SELECT p."userId" FROM "EmployeeVoicePreference" p JOIN "Member" m ON m."organizationId"=p."workspaceId" AND m."userId"=p."userId" WHERE p."workspaceId"=$1 AND p."choice"=$2 AND m."deletedAt" IS NULL AND m."enabled"=true LIMIT 1',[s.workspaceId,'library:'+id])).length)throw new BadRequestError('仍有员工选择此音色，请先替换个人音色，再移除。');
   if((await db.query('SELECT "agentId" FROM "SipAgentProfile" WHERE "workspaceId"=$1 AND "profile"->>\'voiceId\'=$2 LIMIT 1',[s.workspaceId,id])).length||(await db.query('SELECT "id" FROM "SipTask" WHERE "workspaceId"=$1 AND "snapshot"->>\'voiceId\'=$2 AND "deletedAt" IS NULL AND "status" IN (\'RUNNING\',\'PAUSED\',\'NEEDS_REVIEW\') LIMIT 1',[s.workspaceId,id])).length)throw new BadRequestError('请先替换使用此声音的数字员工，并结束相关任务，再移除。');
  }
  await db.query('UPDATE "WorkspaceVoice" SET "deletedAt"=NOW(),"enabled"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id]);return {archived:true};
 });
}
export async function resolvedVoice(workspaceId:string,profile:{voiceId?:string;realtimeModel?:string;voice?:string;language?:string},db:CrmDb=crmDb){
 if(profile.voiceId){
  const row=(await db.query('SELECT "voice","targetModel","status","provider","enabled" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[workspaceId,profile.voiceId]))[0];
  if(!row||row.status!=='READY'||row.enabled===false)throw new BadRequestError('所选声音未就绪、已禁用或删除，请重新选择。');
  if(row.provider==='ALIYUN_ENGINE')throw new BadRequestError('该音色属于阿里云通信引擎，请在阿里云线路中选择。');
  assertFixedCallModel(row.targetModel);
  if(profile.realtimeModel&&profile.realtimeModel!==row.targetModel)throw new BadRequestError('复刻声音必须使用创建时对应的语音模型。');
  return {model:row.targetModel as string,voice:row.voice as string};
 }
 if(profile.realtimeModel)assertFixedCallModel(profile.realtimeModel);
 const model=CALL_VOICE_MODEL;
 const preset=presets.find(p=>p.id===model&&p.kind==='realtime');
 if(!preset)throw new BadRequestError('当前语音模型不受支持。');
 const builtins=builtinVoiceOptions(model);
 const defaultVoice=builtins[0]?.id;
 if(!defaultVoice)throw new BadRequestError('当前模型尚未提供可用的系统音色。');
 const voice=profile.voice||defaultVoice;
 if(!builtins.some(v=>v.id===voice))throw new BadRequestError('请选择当前模型支持的音色或公司声音库中的已完成音色。');
 await assertBuiltinVoiceEnabled(workspaceId,model,voice,db);
 return {model,voice};
}
function wav(pcm:Buffer){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
// Based on Alibaba's Apache-2.0 Omni realtime SDK. Preview is generated once
// and kept private; replaying it never re-submits a model request.
export function synthesizePreview(key:string,model:string,voice:string,options:{text?:string;language?:string;expression?:string;speechSynthesis?:import('./voice-synthesis.js').SpeechSynthesisBinding;onUsage?:(usage:unknown)=>void;onTranscript?:(text:string)=>void}={}):Promise<Buffer>{
 const synthesis=voiceSynthesis(model,voice);
 if(options.speechSynthesis&&(!synthesis||options.speechSynthesis.sourceModel!==model||options.speechSynthesis.sourceVoice!==voice||options.speechSynthesis.voiceId!==synthesis.voiceId||options.speechSynthesis.model!==synthesis.model||options.speechSynthesis.voice!==synthesis.voice||options.speechSynthesis.credentialScope!==synthesis.credentialScope))return Promise.reject(new BadRequestError('试听声音与当前人物绑定不一致，请刷新后重试。'));
 if(synthesis)return synthesizeBoundVoice(key,options.speechSynthesis||synthesis,options.text||'您好，想和您简单沟通一下，现在方便吗？',options.onUsage);
 const preset=presets.find(p=>p.id===model&&p.kind==='realtime');
 if(!preset)return Promise.reject(new BadRequestError('当前语音模型不支持试听。'));
 if(/\{\{[^{}]+\}\}/u.test(options.text||''))return Promise.reject(new BadRequestError('试听文案还有未填写的变量，请先填写变量或替换试听文字。'));
 const narration=previewNarration(options.text,options.language,options.expression);
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(preset.base+'?model='+encodeURIComponent(model),{headers:{Authorization:'Bearer '+key},handshakeTimeout:10000,maxPayload:1024*1024});
  const chunks:Buffer[]=[];let size=0,settled=false,requested=false,transcript='',transcriptDelta='';
  const finish=(err?:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);ws.close();err?reject(err):resolve(wav(Buffer.concat(chunks)));};
  const timeout=setTimeout(()=>finish(new BadRequestError('试听生成超时，系统不会自动重试，请联系管理员核对。')),45000);
  ws.on('unexpected-response',(_req,response)=>{response.resume();finish(new BadRequestError(response.statusCode===401?'模型密钥无效，请在大模型配置中更新。':response.statusCode===403?'当前账号没有此模型的权限。':response.statusCode===429?'模型额度不足或请求受限，请稍后再试。':'试听服务连接失败，请核对模型配置。'));});
  ws.on('error',()=>finish(new BadRequestError('试听服务暂不可用，请联系管理员核对。')));
  ws.on('close',()=>{if(!settled)finish(new BadRequestError('试听连接已中断，请联系管理员核对。'));});
  ws.on('message',(raw:Buffer)=>{
   try{
    const e=JSON.parse(raw.toString()) as Row;
    if(e.type==='session.created'){
     const session:Row={modalities:['text','audio'],voice,turn_detection:null,instructions:narration.instructions};
     if(preset.key==='STEPFUN_API_KEY'){session.input_audio_format='pcm16';session.output_audio_format='pcm16';}
     else if(model.startsWith('qwen3.')){session.audio={input:{format:{type:'pcm',sample_rate:16000}},output:{format:{type:'pcm',sample_rate:24000},...(model.startsWith('qwen3.8-')?{voice}:{})}};if(model.startsWith('qwen3.8-'))delete session.voice;session.input_audio_transcription=null;}
     else {session.input_audio_format='pcm';session.output_audio_format='pcm';}
     ws.send(JSON.stringify({event_id:randomUUID(),type:'session.update',session}));
    }
    if(e.type==='session.updated'&&!requested){requested=true;ws.send(JSON.stringify({event_id:randomUUID(),type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:narration.input}]}}));ws.send(JSON.stringify({event_id:randomUUID(),type:'response.create',response:{modalities:['text','audio'],instructions:narration.instructions}}));}
    if(['response.audio.delta','response.output_audio.delta'].includes(e.type)&&typeof e.delta==='string'){const chunk=Buffer.from(e.delta,'base64');size+=chunk.length;if(size>maxSample)return finish(new BadRequestError('试听长度超出限制，请缩短试听文字。'));chunks.push(chunk);}
    if(['response.audio_transcript.delta','response.output_audio_transcript.delta'].includes(e.type)&&typeof e.delta==='string')transcriptDelta+=e.delta;
    if(['response.audio_transcript.done','response.output_audio_transcript.done'].includes(e.type)&&typeof e.transcript==='string')transcript=e.transcript;
    if(e.type==='error')finish(new BadRequestError('当前音色或模型未获服务授权，请联系管理员。'));
    if(e.type==='response.done'){
     options.onUsage?.(e.response?.usage);
     if(!size||size%2||['failed','cancelled','incomplete'].includes(e.response?.status))return finish(new BadRequestError('试听未完整生成音频，请缩短文字或核对模型授权。'));
     const spoken=transcript||transcriptDelta||finalAudioTranscript(e.response||{});
     if(!samePreviewText(narration.text,spoken))return finish(new BadRequestError(spoken?'本次试听没有按文案完整朗读，请点击重新生成试听。':'模型未返回可核对的朗读内容，请点击重新生成试听。'));
     options.onTranscript?.(spoken);finish();
    }
   }catch{finish(new BadRequestError('试听返回格式异常，请联系管理员核对。'));}
  });
 });
}
export async function previewVoice(s:Scope,id:string,input:unknown){
 await managed(s);const data=z.object({confirmation:z.string().uuid()}).strict().parse(input);if(data.confirmation!==id)throw new BadRequestError('请确认生成该音色的试听。');
 const v=await crmDb.transaction(async db=>{
  const row=await owned(s,id,db);
  if(row.status!=='READY'||row.enabled===false)throw new BadRequestError('请先完成声音复刻并启用。');
  if(row.preview)return row;
  await realtimeAuthorized(s.workspaceId,row.targetModel,db);
  const result=await db.query('UPDATE "WorkspaceVoice" SET "previewStatus"=\'GENERATING\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "previewStatus"=\'NONE\' AND "deletedAt" IS NULL RETURNING *',[s.workspaceId,id]);
  if(!result.length)throw new BadRequestError('试听正在生成或结果待核对，系统不会重复提交。');return result[0]!;
 });
 if(v.preview)return Buffer.from(v.preview);
 try{
  const {effectiveVoiceTuning}=await import('./voice-tuning.js');
  const tuning=await effectiveVoiceTuning(s.workspaceId,id);
  const speechSynthesis=effectiveSpeechSynthesis(v.targetModel,v.voice,tuning.settings,{voiceId:id,credentialScope:credentialScope(s.workspaceId)});
  const sample=await synthesizePreview(await modelKey(s.workspaceId,'DASHSCOPE_API_KEY'),v.targetModel,v.voice,{speechSynthesis});await crmDb.query('UPDATE "WorkspaceVoice" SET "preview"=$3,"previewStatus"=\'READY\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id,sample]);return sample;}
 catch(e){await crmDb.query('UPDATE "WorkspaceVoice" SET "previewStatus"=\'NEEDS_REVIEW\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id]);throw e;}
}
