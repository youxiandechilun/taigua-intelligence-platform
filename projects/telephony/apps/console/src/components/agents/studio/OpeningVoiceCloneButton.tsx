/*
 * 中文导读：数字员工与话术的 OpeningVoiceCloneButton 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import {Loader2} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/src/components/ui/dialog';
import {cloneOpeningRecording} from './recording-cloud';
import type {OpeningRecordingClip} from './use-script-recordings';

export function OpeningVoiceCloneButton({clip,scope,personName,disabled,canUpdateExisting,onBusy,onReady}:{clip:OpeningRecordingClip;scope?:string;personName?:string;disabled:boolean;canUpdateExisting?:boolean;onBusy:(busy:boolean)=>void;onReady:(id:string,name:string)=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[consented,setConsented]=useState(false),[replace,setReplace]=useState(false),[name,setName]=useState(''),[error,setError]=useState('');
 function show(){setName((personName||clip.fileName.replace(/\.[^.]+$/,'')).slice(0,50));setReplace(!!clip.voiceId&&!!canUpdateExisting);setConsented(false);setError('');setOpen(true);}
 async function submit(){
  if(!scope||busy||!consented||!name.trim())return;
  setBusy(true);setError('');onBusy(true);
  try{
   const result=await cloneOpeningRecording(scope,clip,name.trim(),replace);
   if(result.status!=='READY')throw new Error(result.error||(result.status==='SUBMITTING'?'复刻正在处理，请稍后再查看；不会重复提交。':'复刻结果需要核对，请联系管理员。'));
   onReady(result.id,result.name);setOpen(false);
  }catch(e){setError(e instanceof Error?e.message:'复刻未完成，请到声音库核对结果后再操作。');}
  finally{setBusy(false);onBusy(false);}
 }
 return <>
  <Button type="button" variant="ghost" size="xs" disabled={disabled||!scope} onClick={show}>用此录音复刻</Button>
  <Dialog open={open} onOpenChange={next=>{if(!busy)setOpen(next);}}>
   <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
    <DialogHeader><DialogTitle>用开场录音复刻声音</DialogTitle><DialogDescription>将这条原始录音提交阿里云复刻，完成后用于后续 AI 回答。</DialogDescription></DialogHeader>
    <label className="grid gap-2 text-sm">声音人物<Input value={name} maxLength={60} disabled={busy} onChange={event=>setName(event.target.value)} /></label>
    {canUpdateExisting&&clip.voiceId&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={replace} disabled={busy} onChange={event=>setReplace(event.target.checked)} /><span>更新声音库中的“{personName||'对应人物'}”</span></label>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consented} disabled={busy} onChange={event=>setConsented(event.target.checked)} /><span>我已获得录音人物授权，同意用于声音复刻。</span></label>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button type="button" disabled={busy||!consented||!name.trim()} onClick={()=>void submit()}>{busy&&<Loader2 className="size-4 animate-spin" />}{busy?'正在复刻':'复刻并关联'}</Button></DialogFooter>
   </DialogContent>
  </Dialog>
 </>;
}
