/*
 * 中文导读：线路与语音外呼：callback.recording.ts。相关类型、配置或辅助实现集中在本文件。
 */
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import type {IncomingMessage} from 'node:http';
import {assertSafeRemoteUrl} from '../../lib/url-safety.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {permittedRecordingUrl} from './callback.events.js';

// Pin validated DNS results to the socket; never forward a session, Secret or
// redirect to a supplier-provided URL. Only explicit HTTPS audio hosts work.
export async function openCallbackRecording(raw:string,hosts:string[],range?:string):Promise<IncomingMessage>{
 if(!permittedRecordingUrl(raw,hosts))throw new BadRequestError('录音来源待管理员核对。');
 let addresses:{address:string;family:number}[]=[];
 const u=await assertSafeRemoteUrl(raw,{allowedProtocols:['https:'],lookup:async host=>{addresses=await lookup(host,{all:true});return addresses;}});
 const pinned=addresses.find(a=>a.family===4)||addresses[0];if(!pinned)throw new BadRequestError('录音来源不可用。');
 if(range&&!/^bytes=\d{1,12}-\d{0,12}$/.test(range))throw new BadRequestError('录音范围请求无效。');
 return new Promise((resolve,reject)=>{
  const request=https.get(u,{headers:{Accept:'audio/*,application/octet-stream',...(range?{Range:range}:{})},lookup:(_host,options,cb)=>options.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},response=>{
   const type=response.headers['content-type']||'';
   if(![200,206].includes(response.statusCode||0)||!(/^(?:audio\/|application\/octet-stream)/i.test(type))){response.resume();reject(new BadRequestError(response.statusCode===404?'录音仍在生成，请稍后再听。':'录音暂不可用，请稍后重试。'));return;}
   let received=0;response.on('data',chunk=>{received+=chunk.length;if(received>64*1024*1024)request.destroy(new Error('AUDIO_LIMIT'));});
   resolve(response);
  });
  const deadline=setTimeout(()=>request.destroy(new Error('AUDIO_TIMEOUT')),60000);request.on('close',()=>clearTimeout(deadline));
  request.setTimeout(12000,()=>request.destroy(new Error('AUDIO_TIMEOUT')));
  request.on('error',()=>reject(new BadRequestError('录音暂不可用，请稍后重试。')));
 });
}
