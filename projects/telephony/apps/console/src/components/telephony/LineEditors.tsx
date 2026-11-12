/*
 * 中文导读：线路与语音外呼的 LineEditors 组件，封装该界面的展示与交互。
 */
"use client";
import { Save } from "lucide-react";
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type RegionalLine,type Line,useTelephony} from '@/src/lib/api/resources/telephony';
import {LineForm} from './LineForm';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {toast} from '@/src/lib/toast';

export function DefaultScopeForm({route,provinces,onDone}:{route:RegionalLine;provinces:string[];onDone:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const [selected,setSelected]=useState(route.provinces);
 const [scopeRevision,setScopeRevision]=useState(route.scopeRevision);
 const save=useMutation({mutationFn:()=>telephonyApi.saveDefaultLineScope(org,selected,scopeRevision),onSuccess:result=>{setScopeRevision(result.revision);void qc.invalidateQueries({queryKey:['telephony']});toast.success('原有线路省份已保存');onDone();},onError:(e:Error)=>toast.error(e.message)});
 return <form className="space-y-5 rounded-xl border bg-card p-5" onSubmit={event=>{event.preventDefault();save.mutate();}}><fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">适用省份</legend><div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{provinces.map(province=><label key={province} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(province)} onChange={event=>setSelected(values=>event.target.checked?[...values,province]:values.filter(value=>value!==province))}/>{province}</label>)}</div></fieldset><Button type="submit" disabled={save.isPending}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':'保存省份'}</Button></form>;
}

function RouteForm({route,provinces,base,onDone,initialProvider}:{route:RegionalLine|null;provinces:string[];base:Line;onDone:()=>void;initialProvider?:string}){
 const {org}=useAliyunIdentity();
 const [baseRoute]=useState(route);
 const [selected,setSelected]=useState(route?.provinces||[]),[note,setNote]=useState(route?.note||''),[enabled,setEnabled]=useState(route?.enabled??true);
 const [initial]=useState<Line>(()=>route?.line||{...base,serviceProvider:initialProvider||'好客呼',callerMode:'custom',carrierPolicy:null,name:'',trunkKey:'regional-'+crypto.randomUUID().slice(0,8),serverIp:'',callerNumber:'',prefix:'',employeePrefix:'',costPerMinute:null,concurrency:0,callsPerSecond:0,liveEnabled:false,whitelistConfirmed:false});
 return <LineForm config={initial} onSave={async line=>{
  await telephonyApi.saveLine(org,route?.id||null,{line,provinces:selected,note,enabled,assignedUserIds:baseRoute?.assignedUserIds||[],expectedRevision:baseRoute?.revision});onDone();
 }}><details className="space-y-4 rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">适用省份{selected.length?` · 已选 ${selected.length} 个`:' · 请选择'}</summary><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">适用省份 <span className="text-primary">*</span></h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用省份匹配</label></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{provinces.map(p=><label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p)} onChange={e=>setSelected(v=>e.target.checked?[...v,p]:v.filter(x=>x!==p))}/>{p}</label>)}</div><label className="grid gap-2 text-sm">备注<Input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：华东客户专用线路"/></label></details></LineForm>;
}
export function LineAssignment({route,onDone}:{route:RegionalLine;onDone:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const context=useCompanyContext();
 const seats={data:context.data?.assignees?.map(m=>({...m,userId:m.id})),error:context.error,isPending:context.isPending,isError:context.isError};
 const [ids,setIds]=useState(route.assignedUserIds||[]);
 const [assignmentRevision]=useState(route.assignmentRevision);
 const save=useMutation({mutationFn:()=>telephonyApi.assignLine(org,route.id,ids,assignmentRevision),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('线路使用范围已保存');onDone();},onError:(e:Error)=>toast.error(e.message)});
 return <div className="space-y-4"><p className="text-sm text-muted-foreground">选择可使用此线路的员工；不勾选时为全公司。</p>{seats.error?<p className="text-sm text-destructive">{seats.error.message}</p>:<div className="grid gap-3 sm:grid-cols-2">{seats.data?.map(s=><label key={s.userId} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={ids.includes(s.userId)} onChange={e=>setIds(v=>e.target.checked?[...v,s.userId]:v.filter(id=>id!==s.userId))}/>{s.name}</label>)}</div>}<Button disabled={save.isPending||seats.isPending||seats.isError} onClick={()=>save.mutate()}><Save aria-hidden="true" className="size-4" />保存分配</Button></div>;
}

export function RegionalLineEditor({route,provinces,onDone,initialProvider}:{route:RegionalLine|null;provinces:string[];onDone:()=>void;initialProvider?:string}){
 const base=useTelephony();
 if(base.isPending)return <p className="text-sm text-muted-foreground">正在读取线路配置…</p>;
 if(base.error&&!base.data)return <p role="alert" className="text-sm text-destructive">{base.error.message}</p>;
 if(!base.data?.canConfigure)return <p role="alert" className="text-sm text-muted-foreground">当前账号不能修改线路参数。</p>;
 return <>{base.error&&<p role="alert" className="text-sm text-destructive">刷新线路失败，当前草稿已保留：{base.error.message}</p>}<RouteForm key={route?.id||'new'} route={route} provinces={provinces} base={base.data} onDone={onDone} initialProvider={initialProvider}/></>;
}
