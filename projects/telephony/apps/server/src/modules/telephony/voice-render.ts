/*
 * 中文导读：线路与语音外呼：voice-render.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {spawn} from 'node:child_process';
import {z} from 'zod';
import {type Scope} from '../crm/crm.service.js';
import {voiceAuditionAudio,tuningDetail} from './voice-tuning.js';
import {voiceOpeningAudio} from './voice-opening-store.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
export async function renderVoiceAudition(s:Scope,id:string,input:unknown){
 await tuningDetail(s,id);
 const data=z.object({auditionId:z.string().uuid(),volume:z.number().int().min(50).max(150),scene:z.enum(['off','opening','office']),backgroundVolume:z.number().int().min(0).max(12)}).strict().parse(input);
 const [audio,opening]=await Promise.all([voiceAuditionAudio(s,id,data.auditionId),data.scene==='opening'?voiceOpeningAudio(s,id):Promise.resolve(Buffer.alloc(0))]);
 return new Promise<Buffer>((resolve,reject)=>{
  const child=spawn(process.env.VOICE_PREVIEW_BINARY||'/opt/taigua-sales/voice/bin/voice-preview',[],{stdio:['pipe','pipe','ignore'],env:{}});const chunks:Buffer[]=[];let size=0,done=false;
  const fail=()=>{if(done)return;done=true;clearTimeout(timer);child.kill();reject(new BadRequestError('试听效果处理未完成，请稍后重试；没有重新调用模型。'));};
  const timer=setTimeout(fail,10000);
  child.on('error',fail);child.stdin.on('error',fail);child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>5*1024*1024)fail();else chunks.push(b);});
  child.on('close',code=>{if(done)return;if(code!==0)return fail();done=true;clearTimeout(timer);resolve(Buffer.concat(chunks));});
  child.stdin.end(JSON.stringify({...data,audio:audio.toString('base64'),opening:opening.toString('base64')}));
 });
}
