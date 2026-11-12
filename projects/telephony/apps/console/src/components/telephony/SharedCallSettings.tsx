/*
 * 中文导读：线路与语音外呼的 SharedCallSettings 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { Save } from "lucide-react";
import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {telephonyApi,type EngineSettings} from '@/src/lib/api/resources/telephony';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {DialPolicyEditor} from '../aliyun/CloudSettingsControls';
import {toast} from '@/src/lib/toast';

function EngineForm({initial}:{initial:EngineSettings}){
 const {org}=useAliyunIdentity(),qc=useQueryClient(),[form,setForm]=useState(initial);
 const save=useMutation({mutationFn:()=>telephonyApi.saveEngine(org,form),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('阿里云线路设置已保存');},onError:(e:Error)=>toast.error(e.message)});
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">通信引擎应用编码<Input maxLength={120} value={form.applicationCode} onChange={e=>setForm(p=>({...p,applicationCode:e.target.value}))}/></label><label className="grid gap-2 text-sm">主叫号码或服务实例<Input maxLength={100} value={form.callerNumber} onChange={e=>setForm(p=>({...p,callerNumber:e.target.value}))}/></label><label className="grid gap-2 text-sm">服务地域<NativeSelect className="h-9 rounded-md border bg-background px-3" value={form.regionId} onChange={e=>setForm(p=>({...p,regionId:e.target.value}))}>{[{id:'cn-hangzhou',name:'杭州'},{id:'cn-shanghai',name:'上海'},{id:'cn-beijing',name:'北京'},{id:'cn-shenzhen',name:'深圳'}].map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">阿里云播报音色编码<Input maxLength={160} value={form.ttsVoiceCode} onChange={e=>setForm(p=>({...p,ttsVoiceCode:e.target.value}))}/></label><label className="grid gap-2 text-sm">已开通的线路并发<Input type="number" min={1} max={1000} value={form.concurrency} onChange={e=>setForm(p=>({...p,concurrency:Number(e.target.value)}))}/></label><label className="grid gap-2 text-sm">每秒拨号额度<Input type="number" min={1} max={100} value={form.callsPerSecond} onChange={e=>setForm(p=>({...p,callsPerSecond:Number(e.target.value)}))}/></label></div><DialPolicyEditor scope="workspace" product="aiccs" value={form.dialPolicy} onChange={dialPolicy=>setForm(p=>({...p,dialPolicy}))}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.resourcesConfirmed} onChange={e=>setForm(p=>({...p,resourcesConfirmed:e.target.checked}))}/>已完成云端应用、共享模型和回执联调</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e=>setForm(p=>({...p,enabled:e.target.checked}))}/>启用阿里云外呼</label><Button type="submit" size="sm" disabled={save.isPending}><Save aria-hidden="true" className="size-4" />保存阿里云设置</Button></form>;
}
export function SharedCallSettings({expanded=false}:{mode?:'all'|'engine';expanded?:boolean}){
 const {org,user}=useAliyunIdentity();
 const engine=useQuery({queryKey:['telephony',user,org,'aliyun-engine'],queryFn:()=>telephonyApi.engine(org),enabled:!!org,retry:false});
 return <div className="space-y-4"><details open={expanded||undefined} className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">阿里云独立线路 <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground"><span className={'size-1.5 rounded-full '+(engine.data?.ready?'bg-emerald-500':'bg-slate-400')}/>{engine.data?.ready?'接入配置已完成':'待接入'}</span></summary><div className="mt-4 space-y-4">{engine.error?<p role="alert" className="text-sm text-destructive">{engine.error.message}</p>:engine.data?.settings?<><p className="text-xs text-muted-foreground">{engine.data.missing.length?'待完成：'+engine.data.missing.join('、'):'与好客呼共用助手正式版本，独立执行任务。'}</p><EngineForm key={JSON.stringify(engine.data.settings)} initial={engine.data.settings}/></>:<p className="text-sm text-muted-foreground">正在读取配置…</p>}</div></details></div>;
}
