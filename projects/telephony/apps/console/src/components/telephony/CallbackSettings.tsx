/*
 * 中文导读：线路与语音外呼的 CallbackSettings 组件，封装该界面的展示与交互。
 */
"use client";
import Link from 'next/link';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Copy,Headset,Check,LoaderCircle, Save } from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type CallbackConfig} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {toast} from '@/src/lib/toast';

function Configuration({config,onSaved}:{config:CallbackConfig;onSaved:()=>void}){
 const {org}=useAliyunIdentity();
 const [appKey,setKey]=useState(config.appKey||''),[appSecret,setSecret]=useState('');
 const [enabled,setEnabled]=useState(config.enabled),[webhookConfirmed,setWebhook]=useState(config.webhookConfirmed);
 const [concurrent,setConcurrent]=useState(config.maxConcurrent),[cps,setCps]=useState(config.callsPerSecond),[hosts,setHosts]=useState(config.recordingHosts.join('\n'));
 const save=useMutation({mutationFn:()=>telephonyApi.saveCallback(org,{settings:{enabled,maxConcurrent:concurrent,callsPerSecond:cps,webhookConfirmed,recordingHosts:hosts.split(/[\n,，]/).map(v=>v.trim()).filter(Boolean)},appKey,...(appSecret?{appSecret}:{})}),onSuccess:()=>{setSecret('');toast.success('人工回拨配置已保存');onSaved();},onError:(e:Error)=>toast.error(e.message)});
 return <form onSubmit={e=>{e.preventDefault();save.mutate();}} className="space-y-4 border-t pt-4">
  <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm"><span>应用标识</span><Input aria-label="回拨应用标识" autoComplete="off" value={appKey} onChange={e=>setKey(e.target.value.trim())} required/></label><label className="space-y-1.5 text-sm"><span>应用密钥</span><Input aria-label="回拨应用密钥" type="password" autoComplete="new-password" placeholder={config.credentialConfigured?'已保存，填写可更换':'填写线路方提供的密钥'} value={appSecret} onChange={e=>setSecret(e.target.value)} required={!config.credentialConfigured}/></label></div>
  <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-sm"><span>同时通话上限</span><Input aria-label="回拨同时通话上限" type="number" min={1} max={100} value={concurrent} onChange={e=>setConcurrent(Number(e.target.value))}/></label><label className="space-y-1.5 text-sm"><span>每秒拨号上限</span><Input aria-label="回拨每秒拨号上限" type="number" min={1} max={10} value={cps} onChange={e=>setCps(Number(e.target.value))}/></label></div>
  <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用人工回拨</label><label className="flex items-center gap-2"><input type="checkbox" checked={webhookConfirmed} onChange={e=>setWebhook(e.target.checked)}/>线路方已配置话单通知地址</label></div>
  {config.callbackUrl&&<div className="rounded-lg bg-muted/40 p-3"><p className="mb-1.5 text-sm font-medium">给线路方的话单通知地址</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-sm leading-5 text-muted-foreground">{config.callbackUrl}</code><Button type="button" size="icon-sm" variant="ghost" aria-label="复制话单通知地址" onClick={()=>{void navigator.clipboard.writeText(config.callbackUrl!).then(()=>toast.success('通知地址已复制'));}}><Copy className="size-3.5"/></Button></div></div>}
  <details><summary className="cursor-pointer text-sm text-muted-foreground">录音来源设置</summary><label className="mt-3 block space-y-2"><span>额外录音域名（每行一个）</span><textarea aria-label="回拨录音域名" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={hosts} onChange={e=>setHosts(e.target.value)} placeholder="线路方提供录音地址后填写"/></label></details>
  <div className="flex items-center justify-end gap-3"><Button size="sm" type="submit" disabled={save.isPending||!config.canStore}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':'保存配置'}</Button></div>
 </form>;
}
export function CallbackSettings(){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const query=useQuery({queryKey:['telephony',user,org,'callback'],queryFn:()=>telephonyApi.callback(org),enabled:!!org,retry:false});
 const [open,setOpen]=useState(false);
 const refresh=()=>{void qc.invalidateQueries({queryKey:['telephony',user,org]});};
 const test=useMutation({mutationFn:()=>telephonyApi.testCallback(org),onSuccess:data=>{refresh();if(data.connected)toast.success(data.message);else toast.error(data.message);},onError:(e:Error)=>toast.error(e.message)});
 const sync=useMutation({mutationFn:(id:string)=>telephonyApi.syncCallbackEmployee(org,id),onSuccess:data=>{refresh();if(data.synced)toast.success(data.message);else toast.error(data.message);},onError:(e:Error)=>toast.error(e.message)});
 const data=query.data;
 if(query.isPending)return <p className="text-sm text-muted-foreground">正在加载人工回拨…</p>;
 if(query.error)return <p role="alert" className="text-sm text-destructive">{query.error.message}</p>;
 if(!data)return null;
 return <section className="space-y-4 rounded-xl border bg-card p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary"><Headset className="size-5"/></span><h2 className="text-sm font-semibold">人工回拨</h2></div><div className="flex items-center gap-3"><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={'size-1.5 rounded-full '+(data.connected?'bg-emerald-500':'bg-slate-400')}/>{data.connected?'接口已连接':'接口待连接'}</span>{data.canConfigure&&<><Button size="sm" variant="outline" disabled={!data.configured||test.isPending} onClick={()=>test.mutate()}>{test.isPending?<LoaderCircle className="size-3.5 animate-spin"/>:null}测试连接</Button><Button size="sm" variant="ghost" onClick={()=>setOpen(v=>!v)}>{open?'收起配置':'配置'}</Button></>}</div></div>
  {data.configured&&<div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>{data.enabled?'人工回拨已启用':'人工回拨未启用'}</span><span>{data.lastWebhookAt?'已收到话单通知':data.webhookConfirmed?'通知地址已登记，待首通话单':'通知地址待线路方登记'}</span></div>}
  {data.canConfigure&&(open||!data.configured)&&<Configuration key={org+data.updatedAt} config={data} onSaved={refresh}/>}
  {data.employees.length>0&&<div className="overflow-auto border-t pt-1"><table className="w-full text-left text-sm"><thead><tr>{['员工 / 部门','接听号码','回拨授权',''].map((v,i)=><th key={i} className="py-3 pr-4 font-medium text-muted-foreground">{v}</th>)}</tr></thead><tbody>{data.employees.map(e=><tr key={e.userId} className="border-t border-border/50"><td className="py-3 pr-4"><p className="font-medium">{e.name}</p>{e.department&&<p className="mt-1 text-xs text-muted-foreground">{e.department}</p>}</td><td className="pr-4 tabular-nums">{e.phone||'未设置'}</td><td className="pr-4"><span className={'inline-flex items-center gap-1 '+(e.ready?'text-emerald-600':'text-muted-foreground')}>{e.ready?<Check className="size-3.5"/>:null}{e.ready?'已同步':'待同步'}</span></td><td className="text-right"><Button size="sm" variant="ghost" disabled={!data.connected||!e.phone||sync.isPending} onClick={()=>sync.mutate(e.userId)}>{sync.isPending&&sync.variables===e.userId?'同步中…':'同步接听号码'}</Button></td></tr>)}</tbody></table></div>}
  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs"><Link href="/settings/members" className="text-primary hover:underline">管理员工与接听号码</Link><Link href="/crm/calls" className="text-muted-foreground hover:text-primary">客户话单与录音</Link></div>
 </section>;
}
