/*
 * 中文导读：常见问题录音回复的编辑、生成和试听界面。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { generateAnswerRecording, generatedRecordingBlob } from "./recording-cloud";
import type { ScriptRecording } from "./use-script-recordings";
import { ScriptPreviewButton } from "./use-script-audio-preview";
import styles from "./simple-script-editor.module.css";

const canonical=(value:string)=>value.normalize('NFC').replace(/\r\n/g,'\n').trim();
export function readyFaqRecording(entry:ScriptRecording|undefined,text:string,voiceId?:string){
 return !!entry?.asset&&entry.mode!=='ai'&&entry.asset.voiceId===voiceId&&canonical(entry.transcript||'')===canonical(text);
}
export function FaqRecordingPreview({entry,text,voiceId,scope,disabled=false,showText=false}:{entry:ScriptRecording;text:string;voiceId?:string;scope:string;disabled?:boolean;showText?:boolean}){
 const ready=readyFaqRecording(entry,text,voiceId);
 return <ScriptPreviewButton id={`faq-asset-${entry.asset?.assetId||'none'}`} text="" label="试听已生成录音" disabled={disabled||!ready} className={showText?styles.faqListen:styles.previewButton} showText={showText} getBlob={async()=>{
  if(!ready||!entry.asset)return undefined;
  return entry.blob||await generatedRecordingBlob(scope,entry.asset.assetId);
 }}/>;
}

export function FaqRecordingEditor({entry:stored,text,voiceId,voiceName,scope,disabled,onBusy,onChange}:{entry?:ScriptRecording;text:string;voiceId?:string;voiceName?:string;scope:string;disabled:boolean;onBusy:(value:boolean)=>void;onChange:(entry:ScriptRecording)=>void}){
 const entry=stored||{mode:'recording-first' as const};
 const [phrase,setPhrase]=useState('');
 const [editing,setEditing]=useState<string|null>(null),[edited,setEdited]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<{key:string;id:string;retryOf?:string;failed?:boolean}>();
 const mounted=useRef(true);
 const latest=useRef({text,voiceId});latest.current={text,voiceId};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusy(false);};},[onBusy]);
 const ready=readyFaqRecording(entry,text,voiceId);
 const legacy=!entry.direct&&!!entry.blob;
 const phrases=entry.phrases||[];
 function addPhrase(){
  const next=phrase.trim();if(!next||disabled||busy)return;
  if(next.length<2){setError('相似问法至少2个字。');return;}
  if(phrases.length>=20){setError('最多添加20条相似问法。');return;}
  onChange({...entry,direct:true,phrases:[...new Set([...phrases,next])]});setPhrase('');setError('');
 }
 function savePhrase(){
  if(editing===null||disabled||busy)return;
  const next=edited.trim();
  if(next.length<2||next.length>200){setError('相似问法需要2至200个字。');return;}
  if(phrases.some(value=>value!==editing&&value===next)){setError('这条问法已经存在。');return;}
  onChange({...entry,direct:true,phrases:phrases.map(value=>value===editing?next:value)});
  setEditing(null);setEdited('');setError('');
 }
 async function generate(){
  if(disabled||busy||!voiceId||!text.trim())return;
  const before={text,voiceId},key=JSON.stringify(before);
  const request=pending?.key===key&&!pending.failed?pending:{key,id:crypto.randomUUID(),...(pending?.key===key&&pending.failed?{retryOf:pending.id}:{})};
  setPending(request);setBusy(true);setError('');onBusy(true);
  try{
   const result=await generateAnswerRecording(scope,voiceId,text,request.id,request.retryOf);
   if(!mounted.current||latest.current.text!==before.text||latest.current.voiceId!==before.voiceId)return;
   if(result.status!=='READY'||!result.audio||!result.asset){
    setPending({...request,id:result.requestId,failed:result.status==='NEEDS_REVIEW'});
    setError(result.status==='GENERATING'?'正在生成，稍后点击查询结果。':result.error||'生成失败，请重试。');return;
   }
   const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));
   onChange({...entry,mode:'recording-first',direct:true,phrases,asset:{assetId:result.asset.id,voiceId:result.asset.voiceId,textHash:result.asset.textHash},blob:new Blob([bytes],{type:'audio/wav'}),transcript:text,fileName:'已生成回答.wav'});
   setPending(undefined);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'生成结果未确认，请点击查询结果。');}
  finally{if(mounted.current){setBusy(false);onBusy(false);}}
 }
 return <section className={styles.faqRecording} aria-label="回答录音">
  {entry.mode!=='ai'&&<div className={styles.faqPhrases}>
   <span>相似问法</span>
   {phrases.map(value=>editing===value?<span className={styles.faqPhraseEditing} key={value}>
    <Input autoFocus aria-label={`修改相似问法：${value}`} value={edited} maxLength={200} disabled={disabled||busy} onChange={e=>setEdited(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();savePhrase();}else if(e.key==='Escape'){e.preventDefault();setEditing(null);setError('');}}}/>
    <button type="button" aria-label="保存问法" disabled={disabled||busy} onClick={savePhrase}><Check size={14}/></button>
    <button type="button" aria-label="取消修改问法" disabled={disabled||busy} onClick={()=>{setEditing(null);setError('');}}><X size={14}/></button>
   </span>:<span className={styles.faqPhrase} key={value}>
    <button type="button" className={styles.faqPhraseText} aria-label={`修改相似问法：${value}`} title="点击修改" disabled={disabled||busy} onClick={()=>{setEditing(value);setEdited(value);setError('');}}>{value}</button>
    <button type="button" aria-label={`移除相似问法：${value}`} disabled={disabled||busy} onClick={()=>onChange({...entry,direct:true,phrases:phrases.filter(v=>v!==value)})}><X size={12}/></button>
   </span>)}
   <Input aria-label="添加相似问法" placeholder="＋ 添加问法，回车确认" maxLength={200} value={phrase} disabled={disabled||busy||phrases.length>=20} onChange={e=>setPhrase(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();addPhrase();}}} onBlur={addPhrase}/>
  </div>}
  <div className={styles.faqAudioBar}>
   <span className={styles.faqAudioIcon}><AudioLines size={18} aria-hidden="true"/></span>
   <strong className={styles.faqAudioTitle}>回答录音</strong>
   <span className={styles.faqVoice} title={voiceName}>{voiceName||'请先选择真人声音'}</span>
   {entry.mode!=='ai'&&<span className={`${styles.faqState} ${ready?styles.faqReady:''}`}>{ready?<><Check size={13} aria-hidden="true"/>已生成</>:legacy?'原录音':entry.asset?'需重新生成':'未生成'}</span>}
   <div className={styles.faqAudioActions}>
   <select aria-label="回答方式" value={entry.mode} disabled={disabled||busy} onChange={e=>onChange({...entry,direct:true,mode:e.target.value as ScriptRecording['mode']})}>
    <option value="recording-first">{legacy?"原录音优先":"录音直答"}</option><option value="ai">AI回答</option>
   </select>
   {entry.mode!=='ai'&&<>
    <>{legacy?<ScriptPreviewButton id="legacy-faq" text="" label="试听原录音" disabled={disabled||busy} className={styles.faqListen} showText getBlob={()=>entry.blob}/>:<FaqRecordingPreview entry={entry} text={text} voiceId={voiceId} scope={scope} disabled={disabled||busy} showText/>}</>
    <Button type="button" variant="outline" className={styles.faqGenerate} disabled={disabled||busy||!voiceId||!text.trim()||text.trim().length>300} onClick={()=>void generate()}>{busy?<Loader2 className="size-3 animate-spin"/>:ready?<RefreshCw className="size-3"/>:<AudioLines className="size-3"/>}{pending&&!pending.failed?'查询结果':pending?.failed?'重试生成':ready?'重新生成':'生成录音'}</Button>
   </>}
   </div>
  </div>
  {entry.mode!=='ai'&&text.trim().length>300&&<p role="status" className={styles.error}>生成录音请将回答控制在300字内；当前仍可使用AI回答。</p>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
 </section>;
}
