/*
 * 中文导读：线路与语音外呼的 TaskParallelismControls 组件，封装该界面的展示与交互。
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Check } from 'lucide-react';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { telephonyApi, type SipTask } from '@/src/lib/api/resources/telephony';
import { useOutboundParallelismPolicy } from '@/src/lib/api/resources/outbound-parallelism';
import { apiClient, unwrap } from '@/src/lib/api/client';
import { toast } from '@/src/lib/toast';
import { Button } from '../ui/button';
import { OutboundMultiplier } from './OutboundMultiplier';

export function TaskParallelismControls({task,canManage}:{task:SipTask;canManage:boolean}) {
  const {org}=useAliyunIdentity(),qc=useQueryClient();
  const [editing,setEditing]=useState(false),[value,setValue]=useState(task.parallelism??1);
  const current=task.parallelism;
  const {query:policy}=useOutboundParallelismPolicy();
  const max=policy.data?.maxParallelism??6;
  const effective=Math.min(task.effectiveParallelism??current??1,max);
  const latest=new Map<number,SipTask['attempts'][number]>();
  for(const attempt of task.attempts){const prior=latest.get(attempt.recipientIndex);if(!prior||attempt.attemptNumber>=prior.attemptNumber)latest.set(attempt.recipientIndex,attempt);}
  const rows=[...latest.values()];
  const active=rows.filter(row=>['DISPATCHING','DIALING','CONNECTED'].includes(row.status)).length;
  const done=rows.filter(row=>['COMPLETED','FAILED','NOT_ANSWERED','CANCELLED'].includes(row.status)).length;
  const review=rows.filter(row=>row.status==='NEEDS_REVIEW').length;
  const waiting=Math.max(0,task.recipients.length-active-done-review);
  const canEdit=canManage&&current!==undefined&&['DRAFT','RUNNING','PAUSED'].includes(task.status)&&!task.localRemoved&&!(process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true'&&!task.localPreview);
  const save=useMutation({mutationFn:()=>task.localPreview?unwrap(apiClient.patch('/outbound-task-drafts',{id:task.id,parallelism:value,expectedParallelism:current},{headers:{'x-workspace-id':org}})):telephonyApi.parallelism(org,task.id,value,current!),onSuccess:()=>{setEditing(false);void qc.invalidateQueries({queryKey:['telephony']});toast.success(task.localPreview?'本地外呼倍数已更新':'外呼倍数已更新');},onError:(error:Error)=>toast.error(error.message),retry:false});
  return <section aria-label="任务外呼倍数" className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{task.agentName}{current!==undefined&&<span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-primary">×{effective}</span>}</h3>{canEdit&&!editing&&<Button variant="outline" size="sm" onClick={()=>{setValue(Math.min(current!,max));setEditing(true);}}><Settings2 className="size-3.5"/>调整倍数</Button>}</div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums"><span>拨打中 <strong className="font-medium text-primary">{active}{current!==undefined?' / '+effective:''}</strong></span><span className="text-muted-foreground">待拨 {waiting}</span><span className="text-muted-foreground">已完成 {done}</span>{review>0&&<span className="text-amber-700">待核对 {review}</span>}</div>
    {current!==undefined&&current>effective&&<p className="text-xs leading-5 text-muted-foreground">任务原设置 {current} 倍，当前按工作区上限 {effective} 倍调度。</p>}
    {editing&&<div className="space-y-3 border-t pt-4"><OutboundMultiplier value={value} onChange={setValue} disabled={save.isPending} max={max} ready={!!policy.data}/><p className="text-xs leading-5 text-muted-foreground">调高后增加同时拨打数量；调低后，已发起的通话继续完成，空出的席位停止领取新号码。</p><div className="flex gap-2"><Button size="sm" disabled={save.isPending||!policy.data||!Number.isSafeInteger(value)||value<1||value>max||value===current} onClick={()=>save.mutate()}><Check className="size-3.5"/>{save.isPending?'保存中…':'保存倍数'}</Button><Button variant="outline" size="sm" disabled={save.isPending} onClick={()=>setEditing(false)}>取消</Button></div></div>}
  </section>;
}
