/*
 * 中文导读：线路与语音外呼：model-connectivity.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {crmDb} from '../crm/crm.db.js';
import {type Scope} from '../crm/crm.service.js';
import {companyContext} from '../workspace/company-access.js';
import prisma from '../../config/prisma.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {modelKey} from './model-credentials.js';
import {observeTextUsage,observeModelConnection} from './model-telemetry.js';

type Preset={id:string;key:string;base:string;kind:string;voices?:readonly {id:string;name:string}[]};
const fingerprint=(key:string)=>createHash('sha256').update(key).digest('hex');
export async function connectivity(workspaceId:string,preset:Preset,key:string){
 const row=(await crmDb.query('SELECT "connected","checkedAt","message","keyFingerprint" FROM "WorkspaceModelCheck" WHERE "workspaceId"=$1 AND "modelId"=$2',[workspaceId,preset.id]))[0];
 const current=!!row&&!!key&&row.keyFingerprint===fingerprint(key);
 // A check describes the last observed result for this credential. Time passing
 // does not disconnect a request-based model service or revoke its credential.
 return {connected:!!(current&&row.connected),checkedAt:current?row.checkedAt:null,message:current?row.message:''};
}
function failure(status:number){return status===401?'密钥无效或已过期':status===403?'当前账号没有此模型的权限':status===404?'当前模型暂不可用':status===429?'模型额度不足或请求受限':'模型连接未成功，请稍后核对';}
async function realtime(p:Preset,key:string):Promise<{connected:boolean;message:string}>{
 return new Promise(resolve=>{
  const ws=new WebSocket(p.base+'?model='+encodeURIComponent(p.id),{headers:{Authorization:'Bearer '+key},handshakeTimeout:12000});
  let done=false;
  const finish=(connected:boolean,message:string)=>{if(done)return;done=true;clearTimeout(timeout);ws.close();resolve({connected,message});};
  const timeout=setTimeout(()=>finish(false,'连接超时，请检查网络和服务权限'),15000);
  ws.on('unexpected-response',(_req,res)=>{res.resume();finish(false,failure(res.statusCode||0));});
  ws.on('error',()=>finish(false,'无法连接语音服务，请核对网络和权限'));
  ws.on('close',()=>finish(false,'语音连接已中断，请重新测试'));
  ws.on('message',raw=>{
   try{
    const e=JSON.parse(raw.toString());
    if(e.type==='session.created'){
     const step=p.key==='STEPFUN_API_KEY';
     const fn={name:'end_call',description:'结束测试会话',parameters:{type:'object',properties:{}}};
     const session:Record<string,unknown>={modalities:['text','audio'],instructions:'这是连接检查，不生成回复。',voice:p.voices?.[0]?.id||(p.id==='qwen-audio-3.1-realtime-plus'?'longanqian_v3.1':'Tina'),tools:[step?{type:'function',function:fn}:{type:'function',...fn}],turn_detection:{type:'server_vad',silence_duration_ms:700}};
     if(step){session.input_audio_format='pcm16';session.output_audio_format='pcm16';}
     else if(p.id.startsWith('qwen3.')){session.audio={input:{format:{type:'pcm',sample_rate:16000}},output:{format:{type:'pcm',sample_rate:24000},...(p.id.startsWith('qwen3.8-')?{voice:session.voice}:{})}};if(p.id.startsWith('qwen3.8-'))delete session.voice;session.input_audio_transcription={model:null};}
     else {session.input_audio_format='pcm';session.output_audio_format='pcm';}
     ws.send(JSON.stringify({event_id:'connectivity-check',type:'session.update',session}));
    }
    if(e.type==='session.updated')finish(true,'语音连接和会话配置已通过');
    if(e.type==='error')finish(false,'语音模型权限或会话配置未通过');
   }catch{finish(false,'语音服务返回格式异常');}
  });
 });
}
export async function testConnectivity(s:Scope,preset:Preset){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('请由系统超级管理员测试模型连接。');
 const key=await modelKey(s.workspaceId,preset.key);if(!key)throw new BadRequestError('请先保存此平台的模型密钥。');
 return crmDb.transaction(async db=>{
  const locked=(await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS locked',['model-test:'+s.workspaceId]))[0];
  if(!locked?.locked)throw new BadRequestError('已有模型正在测试，请稍后重试。');
  const last=(await db.query('SELECT "createdAt" FROM "AuditLog" WHERE "organizationId"=$1 AND "action"=\'MODEL_CONNECTION_TESTED\' ORDER BY "createdAt" DESC LIMIT 1',[s.workspaceId]))[0];
  if(last&&Date.now()-new Date(last.createdAt).getTime()<5000)throw new BadRequestError('请间隔5秒再检查。');
  const startedAt=new Date();
  let result={connected:false,message:'模型服务暂不可用'};
  if(preset.kind==='realtime')result=await realtime(preset,key);
  else try{
   const step=preset.key==='STEPFUN_API_KEY';
   const response=await fetch(preset.base+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:preset.id,messages:[{role:'user',content:'连接测试，请只回复：OK'}],max_tokens:step?4096:16,...(step?{reasoning_effort:'low'}:{})}),signal:AbortSignal.timeout(20000)});
   if(response.ok){const body=await response.json() as {choices?:{message?:{content?:unknown}}[]};await observeTextUsage(s.workspaceId,preset,body,'CONNECTIVITY',db);const content=body.choices?.[0]?.message?.content;result=typeof content==='string'&&content.trim()?{connected:true,message:'文字模型已正常响应'}:{connected:false,message:'模型未返回有效回答'};}
   else {response.body?.cancel().catch(()=>{});result={connected:false,message:failure(response.status)};}
  }catch{result={connected:false,message:'连接超时或网络异常，请稍后核对'};}
  if(await modelKey(s.workspaceId,preset.key)===key)await observeModelConnection(s.workspaceId,preset.id,key,result.connected,result.message,db,startedAt);
  await prisma.auditLog.create({data:{organizationId:s.workspaceId,userId:s.userId,action:'MODEL_CONNECTION_TESTED',resourceType:'WorkspaceModelSettings',resourceId:s.workspaceId,metadata:{modelId:preset.id,connected:result.connected}}});
  return result;
 });
}
