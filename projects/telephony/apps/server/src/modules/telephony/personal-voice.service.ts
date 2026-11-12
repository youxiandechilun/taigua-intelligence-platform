/*
 * 中文导读：线路与语音外呼：personal-voice.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {readFileSync} from 'node:fs';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess,type CrmDb, type Row, type Scope } from '../crm/crm.service.js';
import {grants} from '../workspace/company-policy.js';
import { publishedRelease, releaseRuntime } from '../agent/agent.release.js';
import { employeeRelease } from '../agent/personal-playbook.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { presets, realtimeAuthorized } from './models.service.js';
import { modelKey } from './model-credentials.js';
import { resolvedVoice } from './voices.service.js';
import { knownVoiceReference } from './voice-reference-versions.js';
import { generateVoicePreview } from './employee-voice-preview.js';
import { defaultPreviewText } from './voice-preview-text.js';
import { builtinVoiceOptions, voiceAccessible, safeAuditionUrl, type CallVoiceOption, type CallVoiceProvider } from './voice-options.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';

const providerSchema=z.enum(['HAOKEHU_SIP','ALIYUN_ENGINE']);
const preferenceSchema=z.object({provider:providerSchema,choice:z.string().max(300),volume:z.number().int().min(50).max(150).nullable(),useAsDefault:z.boolean().default(false),expectedUpdatedAt:z.iso.datetime().nullable(),expectedDefaultUpdatedAt:z.iso.datetime().nullable()}).strict().refine(v=>!v.useAsDefault||!!v.choice,'请先选择要设为默认的音色。').refine(v=>v.provider!=='ALIYUN_ENGINE'||v.volume===null||v.volume<=100,'阿里云音量范围为50%至100%。');
const previewSchema=z.object({provider:providerSchema,choice:z.string().max(300),volume:z.number().int().min(50).max(150).nullable(),requestId:z.string().uuid(),retryOf:z.string().uuid().optional(),confirmed:z.literal(true)}).strict().refine(v=>v.provider!=='ALIYUN_ENGINE'||v.volume===null||v.volume<=100,'阿里云音量范围为50%至100%。');
export type EmployeeSound={version:1;ownerId:string;provider:CallVoiceProvider;source:'agent'|'default'|'company';choice:string;name:string;gender:CallVoiceOption['gender'];model:string;voice:string;voiceId:string;volume:number|null;ttsVoiceCode:string};
const gender=(value:unknown):CallVoiceOption['gender']=>value==='female'||value==='male'?value:'neutral';

// A scoped catalogue controls new choices only; historical task validation still
// reads the full authorised voice library through chosenVoice.
const catalogSchema=z.array(z.object({workspaceId:z.string().min(1),agentId:z.string().min(1),voiceIds:z.array(z.string().uuid()).max(200)}).strict()).max(1000);
function catalogOptions(s:Scope,agentId:string,provider:CallVoiceProvider,options:CallVoiceOption[]){
 if(provider!=='HAOKEHU_SIP')return options;
 let rows:unknown;
 try{
  const text=readFileSync('/opt/taigua-sales/voice/catalog.json','utf8');
  if(text.length>256*1024)throw Error('oversized');
  rows=JSON.parse(text);
 }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return options;throw new BadRequestError('声音选择配置读取失败，请联系管理员。');}
 const parsed=catalogSchema.safeParse(rows);
 if(!parsed.success)throw new BadRequestError('声音选择配置格式异常，请联系管理员。');
 const row=parsed.data.find(r=>r.workspaceId===s.workspaceId&&r.agentId===agentId);
 if(!row)return options;
 const selected=new Set(row.voiceIds);
 return options.filter(option=>selected.has(option.voiceId));
}
async function voiceOptions(s:Scope,provider:CallVoiceProvider,db:CrmDb):Promise<CallVoiceOption[]>{
 const [voices,config]=await Promise.all([
  db.query('SELECT "id","name","voice","targetModel","gender","status","enabled","employeeVisible","assignedUserIds","auditionUrl" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=$2 AND "deletedAt" IS NULL ORDER BY "createdAt","id"',[s.workspaceId,provider]),
  db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[s.workspaceId]),
 ]);
 const openings=provider==='HAOKEHU_SIP'?await db.query(`SELECT o."voiceId" FROM "WorkspaceVoiceOpening" o JOIN "WorkspaceVoice" v ON v."id"=o."voiceId" AND v."workspaceId"=o."workspaceId" WHERE o."workspaceId"=$1 AND o."status"='READY' AND o."sourceHash"=v."sampleHash"`,[s.workspaceId]):[];
 const readyOpenings=new Set(openings.map(v=>v.voiceId));
 const allowed=voices.filter(v=>voiceAccessible(v,s.userId));
 if(provider==='ALIYUN_ENGINE')return allowed.map(v=>({key:'library:'+v.id,name:v.name,model:'aliyun-aiccs-tts',voice:v.voice,voiceId:v.id,gender:gender(v.gender),kind:'cloud',available:v.status==='READY'&&v.enabled!==false,reason:v.enabled===false?'音色已禁用，请重新选择。':v.status==='READY'?'':'音色已不可用，请联系负责人同步声音库。',hasPreview:!!safeAuditionUrl(v.auditionUrl||'')}));
 const enabled:string[]=config[0]?.settings?.enabled||[];
 const selected=presets.filter(p=>p.kind==='realtime'&&p.id===CALL_VOICE_MODEL&&enabled.includes(p.id));
 const keys=new Map(await Promise.all([...new Set(selected.map(p=>p.key))].map(async key=>[key,!!await modelKey(s.workspaceId,key)] as const)));
 const modelReady=(model:string)=>{const p=selected.find(p=>p.id===model);return !!p&&keys.get(p.key)===true;};
 return [...allowed.filter(v=>readyOpenings.has(v.id)).map(v=>({key:'library:'+v.id,name:v.name,model:v.targetModel,voice:v.voice,voiceId:v.id,gender:gender(v.gender),kind:'clone' as const,available:v.enabled!==false&&v.status==='READY'&&modelReady(v.targetModel),reason:v.enabled===false?'音色已禁用，请重新选择。':v.status!=='READY'?'声音复刻尚未完成。':modelReady(v.targetModel)?'':'对应语音模型未授权或未配置。',hasPreview:true}))];
}
async function chosenVoice(s:Scope,choice:string,provider:CallVoiceProvider,db:CrmDb){
 const selected=(await voiceOptions(s,provider,db)).find(v=>v.key===choice);
 if(!selected||!selected.available)throw new BadRequestError(selected?.reason||'你的通话音色已停用或不在授权范围内，请重新选择。');
 return selected;
}
async function preferences(s:Scope,agentId:string,provider:CallVoiceProvider,db:CrmDb){
 const rows=await db.query('SELECT "scopeKey","choice","volume","updatedAt" FROM "EmployeeVoicePreference" WHERE "workspaceId"=$1 AND "userId"=$2 AND "provider"=$3 AND "scopeKey" IN ($4,\'default\')',[s.workspaceId,s.userId,provider,agentId]);
 return {agent:rows.find(r=>r.scopeKey===agentId),account:rows.find(r=>r.scopeKey==='default')};
}
// Only the caller's own account is consulted. Neither a launch operator nor a
// shared training profile can overwrite another employee's choice.
export async function resolveEmployeeSound(s:Scope,agentId:string,content:Row,provider:CallVoiceProvider,db:CrmDb=crmDb,override?:{choice:string;volume:number|null}):Promise<EmployeeSound>{
 const anchor=provider==='HAOKEHU_SIP'?content.playbook?.recordingReplies?.voiceId:undefined;
 const saved=await preferences(s,agentId,provider,db),agent=override||(anchor?{choice:'library:'+anchor,volume:content.profile.audio.volume}:saved.agent);
 const choice=agent?.choice||saved.account?.choice||'company';
 const source:EmployeeSound['source']=agent?.choice?'agent':saved.account?.choice?'default':'company';
 const volume=provider==='HAOKEHU_SIP'?content.profile.audio.volume:100;
 if(choice!=='company'){
  const selected=await chosenVoice(s,choice,provider,db);
  return {version:1,ownerId:s.userId,provider,source,choice,name:selected.name,gender:selected.gender,model:selected.model,voice:selected.voice,voiceId:selected.voiceId,volume,ttsVoiceCode:provider==='ALIYUN_ENGINE'?selected.voice:''};
 }
 if(provider==='HAOKEHU_SIP'){
  if(!content.profile.voiceId)throw new BadRequestError('请在话术中选择带本人开场录音的声音。');
  const selected=await chosenVoice(s,'library:'+content.profile.voiceId,provider,db);
  return {version:1,ownerId:s.userId,provider,source:'company',choice:'library:'+selected.voiceId,name:selected.name,gender:selected.gender,model:selected.model,voice:selected.voice,voiceId:selected.voiceId,volume,ttsVoiceCode:''};
 }
 const settings=(await db.query('SELECT "settings" FROM "AliyunEngineConnection" WHERE "workspaceId"=$1',[s.workspaceId]))[0]?.settings||{};
 const code=settings.ttsVoiceCode||'';
 const row=code?(await db.query('SELECT "name","gender","enabled","deletedAt" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'ALIYUN_ENGINE\' AND "voice"=$2',[s.workspaceId,code]))[0]:null;
 if(row&&(row.enabled===false||row.deletedAt))throw new BadRequestError('阿里云默认音色已禁用或删除，请重新选择。');
 return {version:1,ownerId:s.userId,provider,source:'company',choice:'company',model:'aliyun-aiccs-tts',voice:code,voiceId:'',name:row?.name||'阿里云应用默认音色',gender:gender(row?.gender),volume,ttsVoiceCode:code};
}
// Recheck permissions against the frozen choice, never the employee's latest
// preference. Queued calls keep their original voice when settings are edited.
export async function assertFrozenEmployeeSound(s:Scope,snapshot:Row,db:CrmDb=crmDb){
 const sound=snapshot.employeeVoice as EmployeeSound|undefined;
 if(!sound)return; // Existing tasks retain their pre-upgrade snapshot.
 if(sound.version!==1||sound.ownerId!==s.userId||sound.provider!==snapshot.provider)throw new ForbiddenError('任务音色与员工归属不一致，请重新创建。');
 if(sound.choice!=='company'){
  const current=await chosenVoice(s,sound.choice,sound.provider,db);
  if(current.model!==sound.model||current.voiceId!==sound.voiceId||(current.voice!==sound.voice&&!await knownVoiceReference(s.workspaceId,sound.voiceId,sound.model,sound.voice,db)))throw new BadRequestError('任务音色已发生变化，请重新创建。');
 }
 if(sound.provider==='HAOKEHU_SIP'){await realtimeAuthorized(s.workspaceId,sound.model,db);await resolvedVoice(s.workspaceId,{voiceId:sound.voiceId,realtimeModel:sound.model,voice:sound.voice},db);}
 else if(sound.choice==='company'){const rows=await db.query('SELECT \"enabled\",\"deletedAt\" FROM \"WorkspaceVoice\" WHERE \"workspaceId\"=$1 AND \"provider\"=\'ALIYUN_ENGINE\' AND \"voice\"=$2',[s.workspaceId,sound.ttsVoiceCode]);if(rows.some(row=>row.enabled===false||row.deletedAt))throw new BadRequestError('任务音色已禁用或删除。');}
}
export async function personalVoiceCatalog(s:Scope,agentId:string){
 const release=await employeeRelease(s,agentId),content=release.snapshot as Row;
 const providers=await Promise.all((['HAOKEHU_SIP','ALIYUN_ENGINE'] as const).map(async provider=>{
  const [saved,options]=await Promise.all([preferences(s,agentId,provider,crmDb),voiceOptions(s,provider,crmDb)]);
  let effective:EmployeeSound|null=null,companyDefault:EmployeeSound|null=null,error='';
  try{effective=await resolveEmployeeSound(s,agentId,content,provider);}catch(e){error=e instanceof BadRequestError?e.message:'通话音色读取失败，请稍后重试。';}
  try{companyDefault=await resolveEmployeeSound(s,agentId,content,provider,crmDb,{choice:'company',volume:provider==='HAOKEHU_SIP'?content.profile.audio.volume:100});}catch{/* A personal choice can remain usable if the company default needs repair. */}
  return {provider,choice:saved.agent?.choice||'',volume:saved.agent?.volume??null,updatedAt:saved.agent?.updatedAt||null,accountDefault:saved.account?{choice:saved.account.choice,volume:saved.account.volume,updatedAt:saved.account.updatedAt}:null,effective,companyDefault,error,options:catalogOptions(s,agentId,provider,options)};
 }));
 const access=await memberAccess(crmDb,s);
 return {voiceManagementVersion:1,canUpdateLibrary:grants(access.permissions,'agentConfiguration','update')&&access.allData,agentId,releaseVersion:release.version,providers};
}
export async function savePersonalVoice(s:Scope,agentId:string,input:unknown){
 const data=preferenceSchema.parse(input);
 await crmDb.transaction(async db=>{
  const release=await employeeRelease(s,agentId,db);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['employee-voice:'+s.workspaceId+':'+s.userId]);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
  const saved=await preferences(s,agentId,data.provider,db);
  const canConfigureVolume=(await memberAccess(db,s)).isSystemAdmin;
  if(!canConfigureVolume&&data.volume!==null&&data.volume!==(saved.agent?.volume??null))throw new ForbiddenError('声音参数由超级管理员在声音库统一设置。');
  const revision=saved.agent?.updatedAt?new Date(saved.agent.updatedAt).toISOString():null;
  const defaultRevision=saved.account?.updatedAt?new Date(saved.account.updatedAt).toISOString():null;
  if(revision!==data.expectedUpdatedAt||defaultRevision!==data.expectedDefaultUpdatedAt)throw new BadRequestError('你在其他页面更新了声音设置，请重新加载后保存。');
  const anchor=data.provider==='HAOKEHU_SIP'?(release.snapshot as Row).playbook?.recordingReplies?.voiceId:undefined;
  if(anchor&&data.choice&&data.choice!=='library:'+anchor)throw new BadRequestError('此员工已绑定开场录音人物，请在话术设计中更换录音人物，让开场和 AI 回答保持同一声音。');
  await resolveEmployeeSound(s,agentId,release.snapshot as Row,data.provider,db,data);
  for(const scopeKey of data.useAsDefault?[agentId,'default']:[agentId]){
   const volume=canConfigureVolume?data.volume:(scopeKey==='default'?saved.account?.volume:saved.agent?.volume)??null;
   if(!data.choice&&volume===null)await db.query('DELETE FROM "EmployeeVoicePreference" WHERE "workspaceId"=$1 AND "userId"=$2 AND "scopeKey"=$3 AND "provider"=$4 RETURNING "userId"',[s.workspaceId,s.userId,scopeKey,data.provider]);
   else await db.query('INSERT INTO "EmployeeVoicePreference" ("workspaceId","userId","scopeKey","agentId","provider","choice","volume") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("workspaceId","userId","scopeKey","provider") DO UPDATE SET "choice"=EXCLUDED."choice","volume"=EXCLUDED."volume","updatedAt"=NOW() RETURNING "userId"',[s.workspaceId,s.userId,scopeKey,scopeKey==='default'?null:agentId,data.provider,data.choice||null,volume]);
  }
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'voice.personal.saved',resourceType:'agent',resourceId:agentId,metadata:{provider:data.provider,useAsDefault:data.useAsDefault}});
 return personalVoiceCatalog(s,agentId);
}
export async function personalVoicePreview(s:Scope,agentId:string,input:unknown){
 const data=previewSchema.parse(input),release=await employeeRelease(s,agentId),content=release.snapshot as Row;
 const sound=await resolveEmployeeSound(s,agentId,content,data.provider,crmDb,data);
 if(data.provider==='ALIYUN_ENGINE'){
  const v=(await crmDb.query('SELECT "id","auditionUrl","employeeVisible","assignedUserIds" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "provider"=\'ALIYUN_ENGINE\' AND "voice"=$2 AND "status"=\'READY\' AND "deletedAt" IS NULL',[s.workspaceId,sound.ttsVoiceCode]))[0];
  if(!v||!voiceAccessible(v,s.userId)||!safeAuditionUrl(v.auditionUrl))throw new BadRequestError('该音色暂未提供试听，请选择带试听的声音。');
  return {kind:'sample' as const,voiceId:v.id,volume:sound.volume??100};
 }
 const profile={...content.profile,voiceId:sound.voiceId,realtimeModel:sound.model,voice:sound.voice};
 const text=(releaseRuntime(content).opening.trim()||defaultPreviewText).slice(0,300);
 return {kind:'model' as const,volume:sound.volume??100,...await generateVoicePreview(s,agentId,{profile,text,requestId:data.requestId,retryOf:data.retryOf,confirmed:true})};
}
export async function personalVoiceSample(s:Scope,agentId:string,voiceId:string){
 await publishedRelease(s,agentId);
 const row=(await crmDb.query('SELECT "auditionUrl","employeeVisible","assignedUserIds","provider","status","enabled" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,voiceId]))[0];
 if(!row||row.provider!=='ALIYUN_ENGINE'||row.status!=='READY'||row.enabled===false||!voiceAccessible(row,s.userId))throw new NotFoundError('试听声音不存在或未授权。');
 const url=safeAuditionUrl(row.auditionUrl);if(!url)throw new BadRequestError('该音色暂未提供试听。');return url;
}

export async function personalScriptPreview(s:Scope,agentId:string,raw:unknown){
 const data=z.object({text:z.string().trim().min(1).max(300),voiceId:z.string().uuid().optional(),requestId:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(raw);
 const content=(await employeeRelease(s,agentId)).snapshot as Row;
 const sound=await resolveEmployeeSound(s,agentId,content,'HAOKEHU_SIP',crmDb,data.voiceId?{choice:'library:'+data.voiceId,volume:content.profile.audio.volume}:undefined);
 return generateVoicePreview(s,agentId,{text:data.text,requestId:data.requestId,confirmed:true,profile:{...content.profile,voiceId:sound.voiceId,realtimeModel:sound.model,voice:sound.voice}});
}
