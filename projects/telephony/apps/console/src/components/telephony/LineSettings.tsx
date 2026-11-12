/*
 * 中文导读：线路与语音外呼的 LineSettings 组件，封装该界面的展示与交互。
 */
"use client";

import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useState,type ReactNode} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {RotateCcw} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,useTelephony,type Connection} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {toast} from '@/src/lib/toast';
import {LineForm} from './LineForm';
const CallbackSettings=dynamic(()=>import('./CallbackSettings').then(module=>module.CallbackSettings));

function Readiness({data}:{data:Connection}) {
 return <div className="grid gap-3 sm:grid-cols-2">
  <section className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">人工通话</h2><span className="text-sm text-muted-foreground">{data.manualMissing.length?'待完成':'已就绪 · 待验收'}</span></div>{data.manualMissing.length>0&&<p className="mt-2 text-sm leading-5 text-muted-foreground">尚需：{data.manualMissing.join('、')}</p>}<Link className="mt-2 inline-flex text-sm text-primary hover:underline" href="/settings/members">设置员工账号与接听</Link></section>
  <section className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">数字员工通话</h2><span className="text-sm text-muted-foreground">{data.aiMissing.length?'待完成':'已就绪'}</span></div>{data.aiMissing.length>0&&<p className="mt-2 text-sm leading-5 text-muted-foreground">尚需：{data.aiMissing.join('、')}</p>}<div className="mt-2 flex gap-4 text-sm"><Link className="text-primary hover:underline" href="/settings/models">模型与声音</Link><Link className="text-primary hover:underline" href="/agents">设置数字员工</Link></div></section>
 </div>;
}

function LineHealthStatus({data}:{data:Connection}) {
 const health=data.lineHealth;
 const state=health?.state;
 const label=state==='offline'?'历史失败待验证':state==='degraded'?'历史失败待验证':state==='healthy'?'线路健康':'暂无检测结果';
 const tone=state==='offline'?'text-destructive':state==='degraded'?'text-amber-700 dark:text-amber-300':state==='healthy'?'text-emerald-700 dark:text-emerald-300':'text-muted-foreground';
 return <section className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">线路健康检查</h2><span className={'inline-flex items-center gap-1.5 text-sm '+tone}><span className="size-1.5 rounded-full bg-current"/>{label}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">显示最近通话失败次数、原因和时间。失败记录不会暂停线路调度，线路状态由后续通话结果更新。</p>{health&&health.consecutiveFailures>0&&<p className="mt-2 text-xs text-muted-foreground">连续失败 {health.consecutiveFailures} 次{health.lastFailureReason?' · '+health.lastFailureReason:''}</p>}</section>;
}

export function LineSettings({children}:{children?:ReactNode}={}) {
 const query=useTelephony({refreshStatus:true}),{org}=useAliyunIdentity();
 const qc=useQueryClient();
 const [showCallback,setShowCallback]=useState(false);
 const restore=useMutation({mutationFn:()=>telephonyApi.restoreLine(org,'haokehu-default'),onSuccess:async()=>{await qc.invalidateQueries({queryKey:['telephony']});toast.success('默认线路已恢复，通话仍关闭，请核对配置后重新开启');},onError:(error:Error)=>toast.error(error.message)});
 return <div className="space-y-4">
  {query.error&&<p role="alert" className="text-sm text-destructive">{query.data?'刷新失败，当前编辑内容已保留：':''}{query.error.message}<Button type="button" size="sm" variant="ghost" onClick={()=>void query.refetch()}>重新读取</Button></p>}
  {query.isPending?<p className="text-sm text-muted-foreground">正在加载线路…</p>:query.data&&<>
   {query.data.removed?<section className="space-y-3 rounded-lg border bg-card p-4"><h3 className="text-sm font-semibold">默认线路已移除</h3><p className="text-sm leading-6 text-muted-foreground">原配置和通话记录已保留。恢复后通话仍保持关闭，请核对配置并手动开启。</p>{query.data.canConfigure?<Button variant="outline" disabled={restore.isPending} onClick={()=>restore.mutate()}><RotateCcw aria-hidden="true" className="size-4"/>{restore.isPending?'恢复中…':'恢复默认线路'}</Button>:<p className="text-sm text-muted-foreground">请联系超级管理员恢复线路。</p>}</section>:query.data.canConfigure?<>
    {children}
    <LineForm key={org} config={query.data}/>
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">连接状态</summary><div className="mt-4 space-y-4"><Readiness data={query.data}/><LineHealthStatus data={query.data}/></div></details>
    <details className="rounded-xl border bg-card p-4" onToggle={event=>setShowCallback(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">人工回拨接口</summary>{showCallback&&<div className="mt-4"><CallbackSettings/></div>}</details>
   </>:<p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{query.data.manualReady?'线路已准备，员工接听设置在“组织与人员”中管理。':'等待超级管理员完成线路接入。'}</p>}
  </>}
 </div>;
}
