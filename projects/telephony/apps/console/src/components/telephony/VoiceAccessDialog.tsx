/*
 * 中文导读：线路与语音外呼的 VoiceAccessDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {SlidersHorizontal, Save } from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {telephonyApi,type Voice} from '@/src/lib/api/resources/telephony';
import {Button} from '../ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '../ui/dialog';
import {toast} from '@/src/lib/toast';

function AccessForm({voice,onDone}:{voice:Voice;onDone:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient(),company=useCompanyContext();
 const [baseRevision]=useState(voice.accessRevision);
 const [visible,setVisible]=useState(voice.employeeVisible),[mode,setMode]=useState(voice.assignedUserIds.length?'selected':'all');
 const [selected,setSelected]=useState(voice.assignedUserIds),[gender,setGender]=useState(voice.gender);
 const save=useMutation({mutationFn:()=>telephonyApi.saveVoiceAccess(org,voice.id,{employeeVisible:visible,assignedUserIds:mode==='all'?[]:selected,gender,expectedRevision:baseRevision}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['voice-library']});void qc.invalidateQueries({queryKey:['my-voice']});toast.success('音色使用范围已保存');onDone();},onError:(e:Error)=>toast.error(e.message)});
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={visible} disabled={save.isPending} onChange={e=>setVisible(e.target.checked)}/>允许员工选择此声音</label>
  <label className="grid gap-2 text-sm">声音类型<NativeSelect aria-label="声音类型" className="h-9 rounded-md border bg-background px-3" disabled={save.isPending} value={gender} onChange={e=>setGender(e.target.value as Voice['gender'])}><option value="neutral">不标注</option><option value="female">女声</option><option value="male">男声</option></NativeSelect></label>
  {visible&&<><label className="grid gap-2 text-sm">可使用员工<NativeSelect aria-label="音色可使用员工" className="h-9 rounded-md border bg-background px-3" disabled={save.isPending} value={mode} onChange={e=>setMode(e.target.value)}><option value="all">全公司员工</option><option value="selected">指定员工</option></NativeSelect></label>
   {mode==='selected'&&<div className="max-h-64 overflow-y-auto rounded-lg border p-3">{company.isPending?<p className="text-sm text-muted-foreground">正在读取员工…</p>:company.error?<p role="alert" className="text-sm text-destructive">{company.error.message}</p>:company.data?.assignees.map(m=><label key={m.id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" className="accent-primary" disabled={save.isPending} checked={selected.includes(m.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))}/>{m.name}{m.department&&<span className="text-xs text-muted-foreground">{m.department.name}</span>}</label>)}</div>}
  </>}
  <div className="flex justify-end"><Button type="submit" size="sm" disabled={save.isPending||(visible&&mode==='selected'&&(!selected.length||company.isPending||!!company.error))}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':'保存使用范围'}</Button></div>
 </form>;
}
export function VoiceAccessDialog({voice,open:controlledOpen,onOpenChange,hideTrigger=false,label='使用范围'}:{voice:Voice;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean;label?:string}){
 const [localOpen,setLocalOpen]=useState(false),open=controlledOpen??localOpen;const setOpen=onOpenChange??setLocalOpen;
 return <>{!hideTrigger&&<Button type="button" size="sm" variant="ghost" onClick={()=>setOpen(true)}><SlidersHorizontal aria-hidden="true" className="size-3.5"/>{label}</Button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{voice.name}</DialogTitle><DialogDescription>设置声音类型及可使用的员工。</DialogDescription></DialogHeader>{open&&<AccessForm key={voice.id} voice={voice} onDone={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}
