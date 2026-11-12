/*
 * 中文导读：线路与语音外呼的 employee-voice-audio 组件，封装该界面的展示与交互。
 */
// The same PCM gain and clipping used by the SIP engine. Volume changes only
// adjust the downloaded clip; they never submit a second synthesis request.
export function previewWav(base64:string,volume:number){
 const binary=atob(base64),buffer=new ArrayBuffer(binary.length),bytes=new Uint8Array(buffer);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const view=new DataView(buffer),tag=(offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
 if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('试听音频格式不正确，请重新查看。');
 let pcm=false,found=false;
 for(let offset=12;offset+8<=bytes.length;){
  const size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
  if(end>bytes.length)throw new Error('试听音频不完整，请重新查看。');
  if(tag(offset)==='fmt ')pcm=size>=16&&view.getUint16(start,true)===1&&view.getUint16(start+14,true)===16;
  if(tag(offset)==='data'){
   if(!pcm||size%2)throw new Error('试听音频格式不受支持。');
   for(let i=start;i<end;i+=2)view.setInt16(i,Math.max(-32768,Math.min(32767,Math.round(view.getInt16(i,true)*volume/100))),true);
   found=true;
  }
  offset=end+size%2;
 }
 if(!found)throw new Error('试听未包含音频，请重新查看。');
 return new Blob([buffer],{type:'audio/wav'});
}
