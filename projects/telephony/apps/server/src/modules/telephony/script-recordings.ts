/*
 * 中文导读：话术录音资产的权限、格式、保存与派发快照；音频必须与当前话术及声音人物一致。
 * textHash 标识规范化文字，sha256 标识音频内容；两者与 voiceId 共同约束资产复用。
 * 冻结配置用于让本通电话保持一致；声音或话术改动后，新任务应重新读取当前发布配置。
 */
import {freezeVoiceOpening,attemptVoiceOpening} from './voice-opening-store.js';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import {voiceAccessible} from './voice-options.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { type CrmDb, type Scope, type Row, memberAccess } from '../crm/crm.service.js';
import prisma from '../../config/prisma.js';
import { canTrain, publishedRelease } from '../agent/agent.release.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import {playbookOpening,type ConversationPlaybook} from '../agent/agent.playbook.js';
import {requireScriptManager} from '../agent/script-access.js';
export const recordingScope=z.enum(['personal','template']);
const upload=z.object({scope:recordingScope,voiceId:z.string().uuid(),fileName:z.string().trim().min(1).max(200),text:z.string().trim().max(6000),audio:z.string().max(2100000)}).strict();
export const recordingText=(text:string)=>text.normalize('NFC').replace(/\r\n/g,'\n').trim();
export const recordingTextHash=(text:string)=>createHash('sha256').update(recordingText(text)).digest('hex');
/* 中文注释：使用录音开场时，确认录音绑定文字与已发布开场一致；不一致则要求重新核对。 */

export function assertPublishedOpening(p:ConversationPlaybook,recordings:Row[]){
 if(p.recordingReplies?.openingSource!=='library')return;
 const frozen=recordings.find(clip=>clip.key==='opening-recordings');
 const text=recordingText(playbookOpening(p));
 if(!text||!frozen||recordingText(String(frozen.text||''))!==text)
  throw new BadRequestError('开场录音的文字与已发布话术不一致。请联系管理员试听核对、修正并重新发布。');
}
/* 中文注释：检查 WAV 头、采样率、声道、位深及长度，返回经确认的音频秒数。 */

export function inspectRecording(audio:Buffer){
 if(audio.length<3244||audio.length>1440044||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,16)!=='WAVEfmt '||audio.readUInt32LE(4)!==audio.length-8||audio.readUInt32LE(16)!==16||audio.readUInt16LE(20)!==1||audio.readUInt16LE(22)!==1||audio.readUInt32LE(24)!==16000||audio.readUInt32LE(28)!==32000||audio.readUInt16LE(32)!==2||audio.readUInt16LE(34)!==16||audio.toString('ascii',36,40)!=='data'||audio.readUInt32LE(40)!==audio.length-44||(audio.length-44)%2)throw new BadRequestError('录音须为 0.1 至 45 秒、16kHz 单声道 PCM WAV。');
 return (audio.length-44)/32000;
}
async function access(s:Scope,agentId:string,kind:'personal'|'template'){
 await memberAccess(crmDb,s);
 if(kind==='personal'){await publishedRelease(s,agentId);return;}
 if(!canTrain((await memberAccess(crmDb,s)).permissions))throw new ForbiddenError('没有培训录音编辑权限。');
 if(!await prisma.agent.findFirst({where:{agentId,organizationId:s.workspaceId,deletionRequestedAt:null},select:{agentId:true}}))throw new NotFoundError('数字员工不存在。');
}
/* 中文注释：校验话术管理权限和人物声音；按工作区及所有者串行去重保存录音资产。 */

export async function uploadRecording(s:Scope,agentId:string,raw:unknown){
 const data=upload.parse(raw);await access(s,agentId,data.scope);
 await requireScriptManager(s);
 if(data.scope==='personal')throw new ForbiddenError('话术录音请在统一话术中维护。');
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio))throw new BadRequestError('录音编码不正确。');
 const voice=(await crmDb.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,data.voiceId]))[0];
 if(!voice||voice.status!=='READY'||voice.enabled===false||voice.targetModel!==CALL_VOICE_MODEL||!voiceAccessible(voice,s.userId))throw new BadRequestError('请先选择与录音人物一致的已完成真人复刻声音。');
 const audio=Buffer.from(data.audio,'base64'),durationSeconds=inspectRecording(audio);
 const textHash=recordingTextHash(data.text),sha256=createHash('sha256').update(audio).digest('hex');
 return crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['script-recordings:'+s.workspaceId+':'+s.userId]);
  const existing=(await db.query('SELECT "id","textHash","durationSeconds" FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "ownerId"=$2 AND "agentId"=$3 AND "scope"=$4 AND "textHash"=$5 AND "sha256"=$6 AND "voiceId"=$7 AND "deletedAt" IS NULL',[s.workspaceId,s.userId,agentId,data.scope,textHash,sha256,data.voiceId]))[0];
  if(existing)return existing;
  const usage=(await db.query('SELECT COALESCE(SUM(octet_length("audio")),0)::bigint AS "bytes" FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "ownerId"=$2',[s.workspaceId,s.userId]))[0];
  if(Number(usage?.bytes||0)+audio.length>250*1024*1024)throw new BadRequestError('录音空间已满，请联系管理员整理录音。');
  return (await db.query('INSERT INTO "ScriptRecordingAsset" ("id","workspaceId","ownerId","agentId","scope","fileName","text","textHash","sha256","audio","durationSeconds","voiceId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT ("workspaceId","ownerId","agentId","scope","voiceId","textHash","sha256") DO UPDATE SET "deletedAt"=NULL RETURNING "id","textHash","durationSeconds"',[randomUUID(),s.workspaceId,s.userId,agentId,data.scope,data.fileName,recordingText(data.text),textHash,sha256,audio,durationSeconds,data.voiceId]))[0];
 });
}
/* 中文注释：从统一话术中提取开场、流程、问答和异议对应的可录音文本。 */

export function recordingLines(p:ConversationPlaybook){
 const graph=p.scriptMode==='canvas'?p.canvas:p.publishedFlow;
 return [{key:'opening-recordings',text:graph?graph.nodes.find(n=>n.id===graph.entry)?.text??'':p.opening,trigger:'开场白'},
 ...(p.conversationMode==='goal'?[]:graph?graph.nodes.filter(n=>n.id!==graph.entry).map(n=>({key:'step:'+n.id,text:n.text,trigger:n.title})):p.flow.map(n=>({key:'step:'+n.id,text:n.instruction,trigger:n.title}))),
 ...p.faq.map(n=>({key:'faq:'+n.id,text:n.answer,trigger:n.question})),...p.objections.map(n=>({key:'objection:'+n.id,text:n.response,trigger:n.trigger}))];
}
/* 中文注释：为本次派发核对并冻结可用录音，防止使用与人物或话术内容不符的旧资产。 */

export async function freezeRecordings(s:Scope,agentId:string,p:ConversationPlaybook,db:CrmDb=crmDb){
 const manifest=p.recordingReplies;
 if(!manifest)return [];
 const lines=new Map(recordingLines(p).map(line=>[line.key,line]));
 const frozen:Row[]=[];
 if(manifest.openingSource==='generated'){
  const entry=manifest.entries['opening-recordings'];
  const text=lines.get('opening-recordings')?.text||'';
  if(!manifest.voiceId||!entry||entry.mode!=='recording-first'||entry.openingPlayback!=='fixed'||entry.clips.length!==1||entry.selectedOpeningId!==entry.clips[0]?.assetId||entry.clips[0]?.voiceId!==manifest.voiceId||!text.trim()||text.length>300)throw new BadRequestError('文字开场白尚未生成或声音已改变，请重新生成后保存。');
 }
 if(manifest.openingSource==='library'){if(!manifest.voiceId)throw new BadRequestError('请选择声音库中的开场声音。');frozen.push(await freezeVoiceOpening(s,manifest.voiceId,db));}
 for(const [key,entry] of Object.entries(manifest.entries)){
  if(key==='opening-recordings'&&manifest.openingSource==='library')continue;
  if(entry.mode==='ai')continue;
  const line=lines.get(key);
  if(!line)continue;
  const direct=entry.direct&&/^(faq|objection):/.test(key);
  if(direct&&manifest.voiceId)frozen.push({key,voiceId:manifest.voiceId,text:line.text,trigger:line.trigger,direct:true,phrases:entry.phrases||[]});
  if(!entry.clips.length)continue;
  if(key!=='opening-recordings'&&entry.clips.length>1)throw new BadRequestError('每条回答只能关联一条录音。');
  const clips=key==='opening-recordings'&&entry.openingPlayback==='fixed'?entry.clips.filter(c=>c.assetId===entry.selectedOpeningId):entry.clips;
  if(!clips.length)throw new BadRequestError('指定的开场录音已失效，请重新选择。');
  for(const clip of clips){
   const voiceId=clip.voiceId||manifest.voiceId;
   // Another person's retained recording is never validated or replayed for
   // the newly selected person. The source asset remains available to restore.
   if((manifest.openingSource==='library'||entry.direct)&&voiceId!==manifest.voiceId)continue;
   if(entry.direct&&(!/^(faq|objection):/.test(key)||clip.textHash!==recordingTextHash(line.text)||/\{\{/.test(line.text)))continue;
   // Dynamic names cannot be substituted inside a recorded sentence.
   if((!(key==='opening-recordings'&&!line.text.trim())&&clip.textHash!==recordingTextHash(line.text))||/\{\{/.test(line.text))throw new BadRequestError('话术已修改或含变量，请重新核对对应录音后保存。');
   const asset=(await db.query('SELECT "id","text","textHash","sha256","durationSeconds","voiceId" FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3 AND ("scope"=\'template\' OR ("scope"=\'personal\' AND "ownerId"=$4)) AND "deletedAt" IS NULL',[s.workspaceId,agentId,clip.assetId,s.userId]))[0];
   if(!voiceId||!asset||asset.voiceId!==voiceId||asset.textHash!==clip.textHash)throw new BadRequestError('话术录音不存在或不属于当前账号。');
   const voice=(await db.query('SELECT * FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,voiceId]))[0];
   if(!voice||voice.provider!=='HAOKEHU_SIP'||voice.status!=='READY'||voice.enabled===false||voice.targetModel!==CALL_VOICE_MODEL||!voiceAccessible(voice,s.userId))throw new BadRequestError('录音人物在声音库中不可用，请重新关联本人声音。');
   if(direct){const placeholder=frozen.findIndex(v=>v.key===key&&!v.assetId);if(placeholder>=0)frozen.splice(placeholder,1);}
   frozen.push({key,voiceId:asset.voiceId,assetId:asset.id,text:line.text.trim()?line.text:asset.text||'',textHash:clip.textHash,trigger:line.trigger,...(entry.direct?{direct:true,phrases:entry.phrases||[]}:{}),sha256:asset.sha256,durationSeconds:asset.durationSeconds});
  }
 }
 return frozen;
}
/* 中文注释：读取当前账号获准访问的话术音频。 */

export async function recordingAudio(s:Scope,agentId:string,assetId:string){
 const asset=(await crmDb.query('SELECT * FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3 AND ("scope"=\'template\' OR "ownerId"=$4) AND "deletedAt" IS NULL',[s.workspaceId,agentId,assetId,s.userId]))[0];
 if(!asset)throw new NotFoundError('录音不存在。');
 await access(s,agentId,asset.scope);
 return Buffer.from(asset.audio);
}
/* 中文注释：按本通尝试及其冻结配置读取音频，供语音桥内部播放。 */

export async function attemptRecording(attemptId:string,assetId:string){
 const row=(await crmDb.query('SELECT t."snapshot",a."audio",a."sha256" FROM "SipAttempt" r JOIN "SipTask" t ON t."id"=r."taskId" AND t."workspaceId"=r."workspaceId" JOIN "ScriptRecordingAsset" a ON a."workspaceId"=t."workspaceId" AND a."agentId"=t."agentId" AND a."id"=$2 WHERE r."id"=$1 AND r."status" IN (\'DISPATCHING\',\'DIALING\',\'CONNECTED\')',[attemptId,assetId]))[0];
 if(!row)return attemptVoiceOpening(attemptId,assetId);
 if(!Array.isArray(row.snapshot.recordings)||!row.snapshot.recordings.some((clip:Row)=>clip.assetId===assetId&&clip.sha256===row.sha256))throw new ForbiddenError('当前通话未关联这条录音。');
 return Buffer.from(row.audio);
}
