/*
 * 中文导读：线路与语音外呼的 opening-file 组件，封装该界面的展示与交互。
 */
export async function openingFileAudio(file:File){
 if(file.size>20*1024*1024)throw new Error('请选择20MB以内的开场录音。');
 const original=await file.arrayBuffer(),view=new DataView(original),bytes=new Uint8Array(original);
 if(bytes.length>=44&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'){
  for(let offset=12;offset+24<=bytes.length;){const size=view.getUint32(offset+4,true);if(String.fromCharCode(...bytes.subarray(offset,offset+4))==='fmt '&&view.getUint32(offset+12,true)<24000)throw new Error('请上传原始开场录音，电话录音的采样率不足。');offset+=8+size+(size%2);}
 }
 const context=new AudioContext();let decoded:AudioBuffer;
 try{decoded=await context.decodeAudioData(original);}catch{throw new Error('录音无法读取，请使用 m4a、mp3、mp4 或 wav 文件。');}finally{await context.close();}
 if(decoded.duration<3||decoded.duration>43)throw new Error('开场录音请控制在3至43秒。');
 const rate=24000,offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*rate),rate),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
 const pcm=(await offline.startRendering()).getChannelData(0),out=new ArrayBuffer(44+pcm.length*2),wav=new DataView(out);
 const chars=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)wav.setUint8(offset+i,text.charCodeAt(i));};
 chars(0,'RIFF');wav.setUint32(4,out.byteLength-8,true);chars(8,'WAVEfmt ');wav.setUint32(16,16,true);wav.setUint16(20,1,true);wav.setUint16(22,1,true);wav.setUint32(24,rate,true);wav.setUint32(28,rate*2,true);wav.setUint16(32,2,true);wav.setUint16(34,16,true);chars(36,'data');wav.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++){const v=Math.max(-1,Math.min(1,pcm[i]));wav.setInt16(44+i*2,Math.round(v<0?v*32768:v*32767),true);}
 const result=new Uint8Array(out);let binary='';for(let i=0;i<result.length;i+=16384)binary+=String.fromCharCode(...result.subarray(i,i+16384));return btoa(binary);
}
