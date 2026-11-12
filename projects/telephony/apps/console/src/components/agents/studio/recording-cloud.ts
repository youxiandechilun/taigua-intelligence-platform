/*
 * 中文导读：数字员工与话术的 recording-cloud 组件，封装该界面的展示与交互。
 */
import { apiClient, unwrap } from '@/src/lib/api/client';
import type { ConversationPlaybook, RecordingManifest } from '@/src/lib/api/resources/playbook';
import { openingClips, openingRecordingKey, type ScriptRecording } from './use-script-recordings';
import { scenarioItems } from './scenario-model';
const canonical=(value:string)=>value.normalize('NFC').replace(/\r\n/g,'\n').trim();
function identity(scope:string){const parts=JSON.parse(scope);if(parts.length!==5||parts[0]!=='script-recordings-v1'||!['personal','template'].includes(parts[4]))throw new Error('录音归属不正确，请重新打开员工。');return {user:parts[1] as string,org:parts[2] as string,agent:parts[3] as string,kind:parts[4] as 'personal'|'template'};}
async function wav(blob:Blob,rate=16000){
 const original=await blob.arrayBuffer();
 if(rate===24000&&original.byteLength>=44){
  const bytes=new Uint8Array(original),view=new DataView(original);
  if(String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WAVE'){
   for(let offset=12;offset+24<=original.byteLength;){
    const tag=String.fromCharCode(...bytes.subarray(offset,offset+4)),size=view.getUint32(offset+4,true);
    if(tag==='fmt '&&size>=16&&view.getUint32(offset+12,true)<24000)throw new Error('这条录音只保留了电话播放版本，请重新添加原始录音后复刻。');
    offset+=8+size+(size%2);
   }
  }
 }
 const context=new AudioContext();let decoded:AudioBuffer;
 try{decoded=await context.decodeAudioData(original);}finally{await context.close();}
 if(decoded.duration<0.1||decoded.duration>45)throw new Error('每条录音请控制在 0.1 至 45 秒。');
 if(rate===24000&&decoded.duration<3)throw new Error('这段开场太短，复刻需要至少3秒连续清晰人声。');
 const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*rate),rate);
 const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
 const samples=(await offline.startRendering()).getChannelData(0),buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 const chars=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 if(rate===24000&&buffer.byteLength>2*1024*1024)throw new Error('复刻样本过长，请剪短至43秒以内后重试。');
 chars(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);chars(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);chars(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
 let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);
}
export async function generatedRecordingBlob(scope:string,assetId:string){
 const owner=identity(scope);
 const response=await apiClient.get(`/telephony/script-recordings/${owner.agent}/${assetId}/audio`,{headers:{'x-workspace-id':owner.org},responseType:'blob'});
 return response.data as Blob;
}
export async function generateAnswerRecording(scope:string,voiceId:string,text:string,requestId:string,retryOf?:string){
 const owner=identity(scope);
 return unwrap<{status:string;requestId:string;error?:string;audio:string|null;asset?:{id:string;textHash:string;voiceId:string}}>(apiClient.post(`/telephony/script-recordings/${owner.agent}/generate-answer`,{scope:owner.kind,voiceId,text,requestId,retryOf,confirmed:true},{headers:{'x-workspace-id':owner.org},timeout:75000}));
}
export async function cloneOpeningRecording(scope:string,clip:{blob:Blob;voiceId?:string},name:string,replaceExisting=false){
 const owner=identity(scope),audio=await wav(clip.blob,24000);
 return unwrap<{id:string;status:string;name:string;error:string;cached:boolean;promoted?:boolean}>(apiClient.post(`/telephony/script-recordings/${owner.agent}/clone-voice`,{scope:owner.kind,name,sourceVoiceId:clip.voiceId||undefined,audio,replaceExisting,consented:true},{headers:{'x-workspace-id':owner.org},timeout:75000}));
}
export async function uploadRecordingManifest(scope:string,entries:Record<string,ScriptRecording>,playbook:ConversationPlaybook):Promise<RecordingManifest>{
 const owner=identity(scope),manifest:RecordingManifest={version:1,entries:{}};
 const voiceId=playbook.recordingReplies?.voiceId;
 const hasAudio=Object.values(entries).some(v=>v.mode!=='ai'&&(v.blob||v.openingClips?.length));
 if(hasAudio&&!voiceId&&!openingClips(entries[openingRecordingKey]).some(c=>c.voiceId))throw new Error('请选择录音人物对应的真人声音，AI 将使用同一声音接着回答。');
 manifest.voiceId=voiceId;manifest.openingSource=playbook.recordingReplies?.openingSource;
 for(const item of scenarioItems(playbook)){
  if(item.entry&&manifest.openingSource==='library')continue;
  if(item.entry&&manifest.openingSource==='generated'){const generated=playbook.recordingReplies?.entries[openingRecordingKey];if(!generated?.clips.length)throw new Error('请先生成自定义开场白，再保存话术。');manifest.entries[openingRecordingKey]=generated;continue;}
  const key=item.entry?openingRecordingKey:item.key,entry=entries[key];if(!entry)continue;
  if(entry.direct){
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(item.text))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const ready=entry.mode!=='ai'&&entry.asset?.voiceId===voiceId&&entry.asset?.textHash===hash;
   manifest.entries[key]={mode:entry.mode,direct:true,phrases:entry.phrases||[],clips:ready?[entry.asset!]:[]};
   continue;
  }
  if(entry.mode==='ai'){manifest.entries[key]={mode:'ai',clips:[]};continue;}
  const clips=item.entry?openingClips(entry):entry.blob?[{id:'answer',blob:entry.blob,transcript:entry.transcript||'',fileName:entry.fileName||'回答录音'}]:[];
  if(!clips.length)continue;
  if((!item.entry||canonical(item.text))&&clips.some(clip=>canonical(clip.transcript)!==canonical(item.text)))throw new Error(`“${item.entry?'开场白':item.title}”文案有变化，请核对录音后再保存。`);
  if(/\{\{/.test(item.text))throw new Error('录音无法替换姓名等动态变量，请使用固定文案或 AI 回答。');
  const saved:RecordingManifest['entries'][string]={mode:'recording-first',clips:[],...(item.entry?{openingPlayback:entry.openingPlayback||'random'}:{})};
  for(const clip of clips){
   const speaker=item.entry?(clip as {voiceId?:string}).voiceId:voiceId;
   if(!speaker)throw new Error(`“${clip.fileName}”尚未关联声音库中的本人声音。`);
   const text=item.entry&&!canonical(item.text)?'':clip.transcript;
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(text))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const asset=await unwrap<{id:string;textHash:string}>(apiClient.post(`/telephony/script-recordings/${owner.agent}`,{scope:owner.kind,voiceId:speaker,fileName:clip.fileName,text,audio:await wav(clip.blob)},{headers:{'x-workspace-id':owner.org}}));saved.clips.push({assetId:asset.id,textHash:asset.textHash,voiceId:speaker});if(clip.id===entry.selectedOpeningId)saved.selectedOpeningId=asset.id;}
  if(item.entry&&saved.openingPlayback==='fixed'&&!saved.selectedOpeningId)saved.selectedOpeningId=saved.clips[0]?.assetId;
  manifest.entries[key]=saved;
 }
 const opening=manifest.entries[openingRecordingKey];
 if(opening?.mode==='recording-first'&&opening.clips.length){const selected=opening.openingPlayback==='fixed'?opening.clips.find(c=>c.assetId===opening.selectedOpeningId):opening.clips[0];manifest.voiceId=selected?.voiceId||voiceId;}
 return manifest;
}
export async function loadCloudRecordings(scope:string,manifest:RecordingManifest,playbook:ConversationPlaybook){
 const owner=identity(scope),entries:Record<string,ScriptRecording>={};
 const lines=new Map(scenarioItems(playbook).map(item=>[item.entry?openingRecordingKey:item.key,item.text]));
 for(const [key,entry] of Object.entries(manifest.entries)){
  if(!lines.has(key)||key===openingRecordingKey&&['library','generated'].includes(manifest.openingSource||''))continue;
  if(entry.direct){
   const asset=entry.clips[0];
   const currentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(lines.get(key)||''))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   entries[key]={mode:entry.mode,direct:true,phrases:entry.phrases||[],...(asset?{asset:{...asset,voiceId:asset.voiceId||manifest.voiceId||''},transcript:asset.textHash===currentHash?lines.get(key):'',fileName:'已生成回答.wav'}:{})};
   continue;
  }
  const clips=[];
  for(const clip of entry.clips){
   const response=await apiClient.get(`/telephony/script-recordings/${owner.agent}/${clip.assetId}/audio`,{headers:{'x-workspace-id':owner.org},responseType:'blob'});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(lines.get(key)!))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   clips.push({id:clip.assetId,blob:response.data as Blob,fileName:'已保存录音.wav',voiceId:clip.voiceId||manifest.voiceId,transcript:hash===clip.textHash?lines.get(key)!:''});
  }
  entries[key]=key===openingRecordingKey?{mode:entry.mode,openingClips:clips,openingPlayback:entry.openingPlayback,selectedOpeningId:entry.selectedOpeningId}:{mode:entry.mode,blob:clips[0]?.blob,transcript:clips[0]?.transcript,fileName:clips[0]?.fileName};
 }
 return entries;
}
