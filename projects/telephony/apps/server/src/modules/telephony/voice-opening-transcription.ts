/*
 * 中文导读：线路与语音外呼：voice-opening-transcription.ts。相关类型、配置或辅助实现集中在本文件。
 */
import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {presets} from './models.service.js';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import {modelKey} from './model-credentials.js';
import {wavPcm} from './voice-opening-audio.js';
import {tokenUsage,storeModelUsage} from './model-telemetry.js';
import {BadRequestError} from '../../common/errors/badRequest.js';

// Transcription only. Never request an assistant response or synthesized audio.
export async function transcribeOpening(workspaceId:string,audio:Buffer):Promise<string>{
 const preset=presets.find(p=>p.id===CALL_VOICE_MODEL);
 if(!preset||!('voices' in preset)||!preset.voices[0])throw new BadRequestError('开场识别模型尚未配置可用声音，请联系系统管理员。');
 const key=await modelKey(workspaceId,preset.key),requestId=randomUUID();
 let usage:unknown;
 try{return await new Promise<string>((resolve,reject)=>{
  const ws=new WebSocket(preset.base+'?model='+encodeURIComponent(CALL_VOICE_MODEL),{headers:{Authorization:'Bearer '+key},handshakeTimeout:10000,maxPayload:1024*1024});let done=false,sent=false;
  const finish=(text?:string)=>{if(done)return;done=true;clearTimeout(timer);ws.close();text?.trim()?resolve(text.trim().slice(0,4000)):reject(new BadRequestError('开场识别没有完成，请在声音库核对文字；系统不会自动重复识别。'));};
  const timer=setTimeout(()=>finish(),60000);
  ws.on('unexpected-response',(_req,response)=>{response.resume();finish();});ws.on('error',()=>finish());ws.on('close',()=>{if(!done)finish();});
  ws.on('message',(raw:Buffer)=>{try{
   const e=JSON.parse(raw.toString());
   if(e.type==='session.created')ws.send(JSON.stringify({event_id:randomUUID(),type:'session.update',session:{
    modalities:['text'],turn_detection:null,input_audio_transcription:{model:'qwen3-asr-flash-realtime'},
    audio:{input:{format:{type:'pcm',sample_rate:16000}},output:{voice:preset.voices[0]?.id,format:{type:'pcm',sample_rate:24000}}},
   }}));
   if(e.type==='session.updated'&&!sent){sent=true;const pcm=wavPcm(audio);for(let offset=0;offset<pcm.length;offset+=16000)ws.send(JSON.stringify({event_id:randomUUID(),type:'input_audio_buffer.append',audio:pcm.subarray(offset,offset+16000).toString('base64')}));ws.send(JSON.stringify({event_id:randomUUID(),type:'input_audio_buffer.commit'}));}
   if(e.usage)usage=e.usage;
   if(e.type==='conversation.item.input_audio_transcription.completed')finish(typeof e.transcript==='string'?e.transcript:'');
   if(e.type==='error'||e.type==='conversation.item.input_audio_transcription.failed')finish();
  }catch{finish();}});
 });}finally{
  const tokens=tokenUsage(usage);
  await storeModelUsage(workspaceId,'qwen',CALL_VOICE_MODEL,'VOICE_OPENING_TRANSCRIPTION','opening-asr:'+requestId,{...tokens,requests:1,missingUsage:tokens.totalTokens===null?1:0}).catch(()=>{});
 }
}
