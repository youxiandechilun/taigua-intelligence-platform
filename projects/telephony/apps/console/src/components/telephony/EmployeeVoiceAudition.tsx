/*
 * 中文导读：线路与语音外呼的 EmployeeVoiceAudition 组件，封装该界面的展示与交互。
 */
"use client";

import {useEffect,useRef,useState} from 'react';
import {Headphones,Loader2,Volume2} from 'lucide-react';
import {useQueryClient} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type VoiceProfile,type AgentVoicePreview} from '@/src/lib/api/resources/telephony';
import {useVoiceExpressionPolicy} from './use-voice-expression-policy';
import {Button} from '../ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '../ui/dialog';

// Match the phone engine's PCM gain and clipping. No extra model request is
// needed when changing playback volume, including amplification above 100%.
function previewWav(base64:string,volume:number){
 const binary=atob(base64),buffer=new ArrayBuffer(binary.length),bytes=new Uint8Array(buffer);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const view=new DataView(buffer),tag=(offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
 if(bytes.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('试听音频格式不正确，请重新查看。');
 let pcm=false,found=false;
 for(let offset=12;offset+8<=bytes.length;){
  const size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
  if(end>bytes.length)throw new Error('试听音频不完整，请重新查看。');
  if(tag(offset)==='fmt '){pcm=size>=16&&view.getUint16(start,true)===1&&view.getUint16(start+14,true)===16;}
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

export function EmployeeVoiceAudition({agentId,profile,modelName,voiceName,previewText,available,onVolumeChange}:{agentId:string;profile:VoiceProfile;modelName:string;voiceName:string;previewText?:string;available:boolean;onVolumeChange:(volume:number)=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const policy=useVoiceExpressionPolicy();
 const sourceText=(previewText?.trim()||'您好，想和您简单沟通一下，现在方便吗？').slice(0,300);
 const [open,setOpen]=useState(false),[text,setText]=useState(sourceText);
 const previousSource=useRef(sourceText);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [answer,setAnswer]=useState<{signature:string;data:AgentVoicePreview}|null>(null);
 const [audio,setAudio]=useState<{signature:string;url:string;error:string}|null>(null);
 const locked=useRef(false),lastRequest=useRef<{signature:string;id:string}|null>(null);
 const signature=JSON.stringify([profile.realtimeModel,profile.voiceId,profile.voice,profile.language,text.trim(),policy.signature]);
 const current=answer?.signature===signature?answer.data:null;
 const transportUnknown=!!error&&lastRequest.current?.signature===signature;

 useEffect(()=>{
  const previous=previousSource.current;previousSource.current=sourceText;
  setText(current=>current===previous?sourceText:current);
 },[sourceText]);

 useEffect(()=>{
  if(!current?.audio)return;
  let url='';
  try{url=URL.createObjectURL(previewWav(current.audio!,profile.audio.volume));setAudio({signature,url,error:''});}
  catch(e){setAudio({signature,url:'',error:e instanceof Error?e.message:'试听音频无法播放。'});}
  return ()=>{if(url)URL.revokeObjectURL(url);};
 },[current?.audio,profile.audio.volume,signature]);

 async function generate(){
  if(locked.current||!text.trim()||!available||!policy.ready)return;
  const retryOf=current?.status==='NEEDS_REVIEW'?current.requestId:undefined;
  const requestId=!retryOf&&lastRequest.current?.signature===signature?lastRequest.current.id:crypto.randomUUID();
  lastRequest.current={signature,id:requestId};locked.current=true;setBusy(true);setError('');
  try{
   const data=await telephonyApi.previewEmployeeVoice(org,agentId,{profile,text:text.trim(),requestId,...(retryOf?{retryOf}:{}),confirmed:true});
   lastRequest.current={signature,id:data.requestId};setAnswer({signature,data});
   void qc.invalidateQueries({queryKey:['model-usage']});void qc.invalidateQueries({queryKey:['model-alerts']});
  }catch(e){setError((e instanceof Error?e.message:'试听请求未返回结果。')+' 系统不会自动重新生成，可点击“查看结果”。');}
  finally{locked.current=false;setBusy(false);}
 }

 const playable=policy.ready&&audio?.signature===signature&&current?.status==='READY'?audio:null;
 return <>
  <Button type="button" size="xs" variant="outline" className="gap-1.5" onClick={()=>setOpen(true)}><Headphones aria-hidden="true" className="size-3"/>试听</Button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>声音试听</DialogTitle><DialogDescription>{modelName} · {voiceName}</DialogDescription></DialogHeader>
   <div className="space-y-4">
    <label className="grid gap-2 text-sm">试听文字<textarea aria-label="试听文字" className="min-h-28 resize-y rounded-lg border bg-background p-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={300} disabled={busy} value={text} onChange={e=>{setText(e.target.value);setError('');}}/><span className="text-right text-xs tabular-nums text-muted-foreground">{text.length}/300</span></label>
    <label className="grid gap-2 text-sm"><span className="flex items-center gap-1.5"><Volume2 aria-hidden="true" className="size-3.5"/>说话音量</span><span className="flex items-center gap-3"><input aria-label="试听说话音量" className="min-w-0 flex-1 accent-primary" type="range" min={50} max={150} step={5} value={profile.audio.volume} onChange={e=>onVolumeChange(Number(e.target.value))}/><output className="w-12 text-right text-xs tabular-nums">{profile.audio.volume}%</output></span></label>
    {playable?.url&&<div className="rounded-lg bg-muted/40 p-3"><audio key={playable.url} aria-label="试听音频" controls preload="metadata" src={playable.url} className="h-10 w-full"/></div>}
    {playable?.error&&<p role="alert" className="text-xs text-destructive">{playable.error}</p>}
    {policy.error&&<p role="alert" className="text-xs text-destructive">声音设置读取失败，请重新打开页面。</p>}
    <div role="status" aria-live="polite" className="text-xs leading-5">
     {busy?<p className="text-muted-foreground">正在生成，请稍候…</p>:error?<p className="text-destructive">{error}</p>:current?.status==='NEEDS_REVIEW'?<p className="text-amber-700 dark:text-amber-300">{current.error} 如需再次提交，请点击“重新生成试听”。</p>:current?.status==='GENERATING'?<p className="text-muted-foreground">试听仍在生成，稍后点击“查看结果”。</p>:!available?<p className="text-amber-700 dark:text-amber-300">请先在模型配置中授权并配置当前语音模型。</p>:null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="max-w-64 text-xs leading-5 text-muted-foreground">生成会使用模型额度，重复播放不再生成。此处可听音色与音量。</p><Button size="sm" type="button" disabled={busy||!text.trim()||!available||!policy.ready||current?.status==='READY'} onClick={()=>void generate()}>{busy?<Loader2 aria-hidden="true" className="size-3.5 animate-spin"/>:<Headphones aria-hidden="true" className="size-3.5"/>}{busy?'生成中…':current?.status==='READY'?'已生成':current?.status==='NEEDS_REVIEW'?'重新生成试听':transportUnknown||current?.status==='GENERATING'?'查看结果':'生成试听'}</Button></div>
   </div>
  </DialogContent></Dialog>
 </>;
}
