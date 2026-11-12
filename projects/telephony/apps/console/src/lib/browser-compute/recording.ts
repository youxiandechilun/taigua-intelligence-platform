/*
 * 中文导读：共享基础能力：recording.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {localTask,browserComputeProfile} from './runtime';

const preparedFiles=new WeakMap<File,Map<string,Promise<Blob>>>();
export function prepareRecording(file:File,options={normalize:true,filter:false}) {
  const key=JSON.stringify(options),cached=preparedFiles.get(file)??new Map<string,Promise<Blob>>();
  preparedFiles.set(file,cached);
  let result=cached.get(key);
  if(!result){result=convertRecording(file,options).catch(error=>{cached.delete(key);throw error;});cached.clear();cached.set(key,result);}
  return result;
}

async function convertRecording(file:File,options:{normalize:boolean;filter:boolean}) {
  if(!file.size||file.size>20*1024*1024)throw new Error('请选择20MB以内的录音。');
  const profile=await browserComputeProfile();
  if(!profile.audio)throw new Error('此浏览器不支持录音转换，请使用新版 Chrome、Edge 或 Safari。');
  const context=new AudioContext();let source:AudioBuffer;
  try {source=await context.decodeAudioData(await file.arrayBuffer());}
  catch {throw new Error('无法读取这段录音，请使用 WAV、MP3 或 M4A 格式。');}
  finally {await context.close();}
  if(source.duration<2||source.duration>600)throw new Error('请选择2秒至10分钟的通话录音。');
  const offline=new OfflineAudioContext(1,Math.ceil(source.duration*16000),16000),node=offline.createBufferSource();
  node.buffer=source;
  if(options.filter){const filter=offline.createBiquadFilter();filter.type='highpass';filter.frequency.value=70;filter.Q.value=0.707;node.connect(filter);filter.connect(offline.destination);}
  else node.connect(offline.destination);
  node.start();
  // Keep silence and timing intact so reviewed evidence still points to the original words.
  const pcm=(await offline.startRendering()).getChannelData(0);
  const buffer=await localTask('wav',{pcm,normalize:options.normalize});
  return new Blob([buffer],{type:'audio/wav'});
}
