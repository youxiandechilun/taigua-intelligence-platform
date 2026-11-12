/*
 * 中文导读：将声音库配置转换为语音合成参数。
 */
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import WebSocket from 'ws';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {synthesisDelivery,type SynthesisDelivery} from './voice-synthesis-delivery.js';

export type SpeechSynthesisBinding={credentialScope:string;sourceModel:string;sourceVoice:string;voiceId:string;model:string;voice:string;rate:number;pitch:number;volume:number;instruction:string;seed?:number};
type Binding=SpeechSynthesisBinding;
const path='/opt/taigua-sales/voice/synthesis.json';
export function voiceSynthesis(model:string,voice:string):Binding|undefined{
 let rows:Binding[];
 try{const text=readFileSync(path,'utf8');if(text.length>256*1024)throw Error('oversized');rows=JSON.parse(text) as Binding[];}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw new BadRequestError('声音合成配置读取失败，请联系管理员。');}
 if(!Array.isArray(rows))throw new BadRequestError('声音合成配置格式异常。');
 const row=rows.find(r=>r.sourceModel===model&&r.sourceVoice===voice);
 if(row&&(!['cosyvoice-v3.5-plus','qwen-audio-3.1-tts-plus'].includes(row.model)||!row.voice.startsWith(row.model+'-')||row.rate<.5||row.rate>2||row.pitch<.5||row.pitch>2||row.volume<0||row.volume>100||(row.seed!==undefined&&(!Number.isInteger(row.seed)||row.seed<0||row.seed>2147483647))))throw new BadRequestError('声音合成参数无效。');
 return row;
}
export function voiceSynthesisSignature(model:string,voice:string){const row=voiceSynthesis(model,voice);return row?[createHash('sha256').update(JSON.stringify(row)).digest('hex')]:[];}
export function effectiveSpeechSynthesis(model:string,voice:string,settings?:SynthesisDelivery,identity?:{voiceId?:string;credentialScope?:string}){
 const binding=voiceSynthesis(model,voice);
 if(!binding)return undefined;
 if(identity?.voiceId&&identity.voiceId!==binding.voiceId||identity?.credentialScope&&identity.credentialScope!==binding.credentialScope)throw new BadRequestError('声音库人物与合成绑定不一致，请核对所选声音。');
 if(!settings)return {...binding};
 const delivery=synthesisDelivery(settings);
 // Playback loudness is applied by the existing audio layer in both preview
 // and live calls. Applying its percentage here would amplify it twice.
 return {...binding,rate:Math.max(.5,Math.min(2,Number((binding.rate*delivery.rateFactor).toFixed(3)))),instruction:delivery.instruction};
}
export function speechSynthesisRequest(binding:SpeechSynthesisBinding|undefined){
 if(!binding)return undefined;
 const {credentialScope:_,...request}=binding;
 return request;
}
function wav(pcm:Buffer){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
export function synthesizeBoundVoice(key:string,binding:Binding,text:string,onUsage?:(usage:unknown)=>void):Promise<Buffer>{
 if(!text.trim()||text.length>600||/\{\{[^{}]+\}\}/u.test(text))return Promise.reject(new BadRequestError('请填写600字以内、不含未填写变量的试听文案。'));
 return new Promise((resolve,reject)=>{
  const task=randomUUID().replaceAll('-',''),ws=new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference',{headers:{Authorization:'Bearer '+key},handshakeTimeout:10000,maxPayload:8*1024*1024});
  let done=false,size=0,started=false;const chunks:Buffer[]=[];
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);ws.close();error?reject(error):resolve(wav(Buffer.concat(chunks)));};
  const timer=setTimeout(()=>finish(new BadRequestError('声音生成超时，没有自动重复提交。')),45000);
  const send=(action:string,payload:unknown)=>ws.send(JSON.stringify({header:{action,task_id:task,streaming:'duplex'},payload}));
  ws.on('open',()=>send('run-task',{task_group:'audio',task:'tts',function:'SpeechSynthesizer',model:binding.model,parameters:{voice:binding.voice,format:'pcm',sample_rate:24000,volume:binding.volume,rate:binding.rate,pitch:binding.pitch,...(binding.instruction?{instruction:binding.instruction}:{}),...(binding.seed!==undefined?{seed:binding.seed}:{})},input:{}}));
  ws.on('error',()=>finish(new BadRequestError('CosyVoice 服务暂不可用，请检查模型授权。')));
  ws.on('unexpected-response',(_req,res)=>{res.resume();finish(new BadRequestError('CosyVoice 连接被拒绝，请检查模型授权和额度。'));});
  ws.on('close',()=>{if(!done)finish(new BadRequestError('CosyVoice 音频连接中断，没有自动重试。'));});
  ws.on('message',(raw:Buffer,binary:boolean)=>{
   if(binary){size+=raw.length;if(size>8*1024*1024||raw.length%2)return finish(new BadRequestError('返回的声音格式或长度异常。'));chunks.push(Buffer.from(raw));return;}
   try{const e=JSON.parse(raw.toString());
    if(e.header?.event==='task-started'&&!started){started=true;send('continue-task',{input:{text}});send('finish-task',{input:{}});}
    if(e.header?.event==='task-failed')finish(new BadRequestError('CosyVoice 生成未成功，请检查音色状态和模型额度。'));
    if(e.header?.event==='task-finished'){onUsage?.({...e.payload?.usage,synthesisModel:binding.model});if(!size)return finish(new BadRequestError('CosyVoice 未返回声音。'));finish();}
   }catch{finish(new BadRequestError('CosyVoice 返回格式异常。'));}
  });
 });
}
