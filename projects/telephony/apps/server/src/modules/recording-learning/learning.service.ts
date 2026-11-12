/*
 * 中文导读：录音学习：learning.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat,copyFile,mkdir} from 'node:fs/promises';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {modelKey} from '../telephony/model-credentials.js';
import {modelFetch,observeTextUsage} from '../telephony/model-telemetry.js';
import {crmDb} from '../crm/crm.db.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import type {Row} from '../crm/crm.service.js';

const moduleRoot=path.resolve(process.cwd(),'recording-learning');
const dataRoot=path.resolve(process.cwd(),'data/recording-learning');
const scopeHash=(workspaceId:string)=>createHash('sha256').update(workspaceId).digest('hex');
const scopedDir=(workspaceId:string)=>path.join(dataRoot,scopeHash(workspaceId));
export const learningModule=()=>import(pathToFileURL(path.join(moduleRoot,'server.mjs')).href);
type App={handler:(req:IncomingMessage,res:ServerResponse)=>Promise<void>;server:Server;close:()=>Promise<void>;getStore:()=>Row;save:()=>Promise<void>};
const apps=new Map<string,Promise<App>>();
export function workspaceLearning(workspaceId:string):Promise<App>{
 let app=apps.get(workspaceId);if(app)return app;
 app=(async()=>{
  const mod=await learningModule();
  const qwen=await import(pathToFileURL(path.join(moduleRoot,'qwen.mjs')).href);
  const transport=async(url:string,init:RequestInit)=>{
   const body=JSON.parse(String(init.body));
   if(url.endsWith('/chat/completions')){const row=(await crmDb.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]))[0];if(!(row?.settings?.enabled||[]).includes(body.model))throw new BadRequestError('当前工作区尚未授权此文字模型，请联系管理员在模型设置中启用。');}
   if(url==='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')return modelFetch(workspaceId,{base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:body.model,key:await modelKey(workspaceId,'DASHSCOPE_API_KEY')},'RECORDING_SAMPLE_LEARNING',init);
   if(url!=='https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')throw new Error('不支持此模型地址。');
   const response=await fetch(url,{...init,redirect:'error'});
   try{const value=await response.clone().json() as Row;await observeTextUsage(workspaceId,{id:body.model,key:'DASHSCOPE_API_KEY'},{...value,id:value.request_id||randomUUID()},'RECORDING_SAMPLE_ASR');}catch{console.warn('[recording-learning] ASR usage observation delayed');}
   return response;
  };
  const provider=Object.fromEntries(['transcribe','chat','classify','synthesize'].map(name=>[name,(config:Row,...args:unknown[])=>qwen[name]({...config,transport},...args)]));
  return mod.createApp({dataDir:scopedDir(workspaceId),provider,online:{key:()=>modelKey(workspaceId,'DASHSCOPE_API_KEY'),realtime:true,observeRealtime:(config:Row,event:Row)=>observeTextUsage(workspaceId,{id:config.realtimeModel,key:'DASHSCOPE_API_KEY'},{id:event.response?.id||event.event_id,usage:event.response?.usage},'RECORDING_SAMPLE_VOICE_TRIAL')}}) as Promise<App>;
 })();apps.set(workspaceId,app);app.catch(()=>apps.delete(workspaceId));return app;
}
export async function readLearningStore(workspaceId:string){
 try{return JSON.parse(await readFile(path.join(scopedDir(workspaceId),'store.json'),'utf8')) as Row;}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new BadRequestError('录音学习资料无法读取，请联系管理员检查存储。');}
}
export async function freezeRecordingLearning(workspaceId:string,agentId:string){
 const db=await readLearningStore(workspaceId);if(!db)return null;
 try{return (await learningModule()).packageRuntime(db,agentId) as {id:string;version:number;digest:string;instructions:string}|null;}
 catch(error){throw new BadRequestError((error as Error).message);}
}
export async function assertRecordingLearningSnapshot(workspaceId:string,snapshot:Row){
 if(snapshot.demoCall===true)return;
 const frozen=snapshot.recordingLearning;if(!frozen)return;
 const current=await freezeRecordingLearning(workspaceId,snapshot.agentId||snapshot.learningAgentId||'');
 if(!current||current.id!==frozen.id||current.digest!==frozen.digest)throw new BadRequestError('任务绑定的录音学习版本已撤回、更新或失效，请重新创建外呼任务。');
}
export async function learningAgents(workspaceId:string){
 return crmDb.query('SELECT "agentId" AS id,"name","isActive" AS enabled FROM "Agent" WHERE "organizationId"=$1 AND "deletionRequestedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 200',[workspaceId]);
}
export async function publishLearning(workspaceId:string,userId:string,body:Row){
 const agents=await learningAgents(workspaceId);if(!agents.some(a=>a.id===body.agentId))throw new BadRequestError('数字员工不存在或不属于当前工作区。');
 const app=await workspaceLearning(workspaceId),db=app.getStore();
 const pack=(await learningModule()).publishPackage(db,{...body,userId});await app.save();
 await recordAuditEvent({organizationId:workspaceId,userId,action:'recording_learning.published',resourceType:'Agent',resourceId:body.agentId,metadata:{packageId:pack.id,version:pack.version}});
 return pack;
}
export async function unbindLearning(workspaceId:string,userId:string,agentId:string){
 if(!(await learningAgents(workspaceId)).some(a=>a.id===agentId))throw new BadRequestError('数字员工不存在。');
 const app=await workspaceLearning(workspaceId);delete app.getStore().bindings[agentId];await app.save();
 await recordAuditEvent({organizationId:workspaceId,userId,action:'recording_learning.withdrawn',resourceType:'Agent',resourceId:agentId,metadata:{}});return {ok:true};
}
export async function pilotAvailable(){try{await stat(path.join(moduleRoot,'pilot/store.json'));return true;}catch{return false;}}
export async function importPilot(workspaceId:string,userId:string){
 const app=await workspaceLearning(workspaceId),db=app.getStore();
 if(db.recordings.length||db.pilotImportedAt)throw new BadRequestError('当前工作区已有录音，未覆盖。');
 const source=path.join(moduleRoot,'pilot'),seed=JSON.parse(await readFile(path.join(source,'store.json'),'utf8')) as Row;
 // Import only known first-party pilot content. Never accept arbitrary paths or executable config.
 for(const r of seed.recordings){
  if(!/^[a-f0-9-]+\.(wav|mp3|m4a)$/.test(r.audioFile||''))throw new BadRequestError('试用录音文件信息无效。');
  await copyFile(path.join(source,'audio',r.audioFile),path.join(scopedDir(workspaceId),'audio',r.audioFile));
 }
 db.recordings=seed.recordings;db.voiceProfiles=seed.voiceProfiles||[];
 db.config.business=seed.config.business||'';db.config.privateTerms=seed.config.privateTerms||'';
 db.prompt=seed.prompt||null;db.pilotImportedAt=new Date().toISOString();await app.save();
 await recordAuditEvent({organizationId:workspaceId,userId,action:'recording_learning.pilot_imported',resourceType:'RecordingLearning',resourceId:scopeHash(workspaceId),metadata:{recordings:db.recordings.length}});
 return {ok:true,count:db.recordings.length};
}

export async function stopRecordingLearning(){await Promise.allSettled([...apps.values()].map(async pending=>(await pending).close()));apps.clear();}
