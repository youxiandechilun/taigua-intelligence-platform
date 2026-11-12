/*
 * 中文导读：线路与语音外呼的 VoiceLibraryUpload 组件，封装该界面的展示与交互。
 */
"use client";
import {useEffect,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Loader2,Upload} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi} from '@/src/lib/api/resources/telephony';
import {toast} from '@/src/lib/toast';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {openingFileAudio} from './opening-file';
import {refreshVoiceLibrary} from './voice-library-cache';

export function VoiceLibraryUpload({onDone,onBusyChange}:{onDone:()=>void;onBusyChange:(busy:boolean)=>void}){
 const {org}=useAliyunIdentity(),client=useQueryClient();
 const [name,setName]=useState(''),[file,setFile]=useState<File|null>(null),[consent,setConsent]=useState(false);
 const save=useMutation({mutationFn:async()=>{
  if(!file)throw new Error('请选择开场原录音。');
  return telephonyApi.openingVoice(org,{name:name.trim(),fileName:file.name,audio:await openingFileAudio(file),consented:true});
 },onSuccess:result=>{
  refreshVoiceLibrary(client);toast.success(result.cached?'已找到相同录音，无需重复处理':'录音已保存，正在识别并建立声音');onDone();
 },onError:(error:Error)=>toast.error(error.message)});
 useEffect(()=>{onBusyChange(save.isPending);return()=>onBusyChange(false);},[save.isPending,onBusyChange]);
 return <form className="space-y-5" onSubmit={event=>{event.preventDefault();if(consent&&file&&name.trim()&&!save.isPending)save.mutate();}}>
  <fieldset disabled={save.isPending} className="space-y-4">
   <label className="grid gap-2 text-sm font-medium">声音名称<Input required maxLength={60} placeholder="例如：商务男声" value={name} onChange={event=>setName(event.target.value)}/></label>
   <label className="grid gap-2 text-sm font-medium">开场录音<Input required type="file" accept=".wav,.m4a,.mp3,.mp4,audio/*,video/mp4" onChange={event=>setFile(event.target.files?.[0]||null)}/><span className="text-xs font-normal leading-5 text-muted-foreground">支持 WAV、MP3、M4A、MP4，时长 3 至 43 秒。</span></label>
   <label className="flex items-start gap-2 text-xs leading-5"><input className="mt-1 accent-primary" type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>我已取得本人授权，同意保存录音并提交阿里云识别和复刻；首次处理可能产生模型费用。</label>
  </fieldset>
  {save.error&&<p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
  <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={!consent||!file||!name.trim()||save.isPending}>{save.isPending?<Loader2 aria-hidden="true" className="size-4 animate-spin"/>:<Upload aria-hidden="true" className="size-4"/>}{save.isPending?'上传中…':'上传并建立声音'}</Button></div>
 </form>;
}
