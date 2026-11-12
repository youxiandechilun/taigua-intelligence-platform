/*
 * 中文导读：线路与语音外呼：voice-opening-audio.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash} from 'node:crypto';
import {BadRequestError} from '../../common/errors/badRequest.js';

export function pcmWav(pcm:Buffer,rate:number){
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export function wavPcm(sample:Buffer){
 for(let offset=12;offset+8<=sample.length;){const size=sample.readUInt32LE(offset+4),end=offset+8+size;if(end>sample.length)break;if(sample.toString('ascii',offset,offset+4)==='data')return sample.subarray(offset+8,end);offset=end+(size%2);}
 throw new BadRequestError('录音没有音频内容。');
}
// The enrollment source remains unchanged; this only creates the telephone copy.
export function telephoneOpening(sample:Buffer,rate:number){
 const pcm=wavPcm(sample),count=pcm.length/2,output=Buffer.alloc(Math.round(count*16000/rate)*2),ratio=16000/rate;
 for(let i=0;i<output.length/2;i++){
  const position=i/ratio,center=Math.floor(position);let sum=0,weight=0;
  for(let j=Math.max(0,center-16);j<=Math.min(count-1,center+16);j++){
   const distance=position-j,x=Math.PI*distance*ratio;
   const w=(Math.abs(x)<1e-8?1:Math.sin(x)/x)*(0.5+0.5*Math.cos(Math.PI*distance/17));
   sum+=pcm.readInt16LE(j*2)*w;weight+=w;
  }
  output.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(sum/(weight||1)))),i*2);
 }
 return pcmWav(output,16000);
}
export function analyzeOpening(audio:Buffer){
 const pcm=wavPcm(audio);let total=0,peak=0,clipped=0;const frames:number[]=[];
 for(let offset=0;offset<pcm.length;offset+=640){let energy=0,count=0;for(let j=offset;j<Math.min(pcm.length,offset+640);j+=2){const v=pcm.readInt16LE(j)/32768;energy+=v*v;total+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>=0.995)clipped++;count++;}frames.push(Math.sqrt(energy/Math.max(1,count)));}
 const rms=Math.sqrt(total/(pcm.length/2)),threshold=Math.max(0.008,Math.min(0.04,peak*0.035)),pauses:number[]=[];let silence=0,speechFrames=0;
 for(const frame of frames){if(frame<threshold)silence++;else{speechFrames++;if(silence>=8)pauses.push(Math.round(silence*20));silence=0;}}
 if(peak<0.025||rms<0.004||speechFrames<50)throw new BadRequestError('录音人声过轻或有效人声不足，请上传清晰的开场原录音。');
 const sorted=[...pauses].sort((a,b)=>a-b);
 return {version:1,durationSeconds:pcm.length/32000,rmsDb:Math.round(20*Math.log10(rms)*10)/10,peakDb:Math.round(20*Math.log10(Math.max(peak,1e-6))*10)/10,clippingRatio:clipped/(pcm.length/2),speechSeconds:speechFrames*0.02,pauseCount:pauses.length,medianPauseMs:sorted.length?sorted[Math.floor(sorted.length/2)]:0,telephoneSampleRate:16000,sourcePreserved:true};
}
export const audioHash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
