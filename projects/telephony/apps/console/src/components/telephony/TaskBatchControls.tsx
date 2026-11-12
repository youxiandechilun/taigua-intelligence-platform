/*
 * 中文导读：线路与语音外呼的 TaskBatchControls 组件，封装该界面的展示与交互。
 */
"use client";

import {useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Pause,Play,Loader2} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type TaskBatchResult} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';

export function TaskBatchControls(){
 const {org,user}=useAliyunIdentity(),client=useQueryClient();
 const [action,setAction]=useState<'pause'|'resume'|null>(null),[result,setResult]=useState<TaskBatchResult|null>(null);
 const pauseRequest=useRef<{org:string;id:string}|null>(null);
 const control=useQuery({queryKey:['telephony',user,org,'batch-control'],queryFn:()=>telephonyApi.taskControl(org),enabled:!!org&&!!user,retry:false,refetchInterval:15000,refetchIntervalInBackground:false});
 const batch=control.data?.activeBatch;
 const change=useMutation({mutationFn:async(next:'pause'|'resume')=>{
  if(next==='resume'){
   if(!batch)throw new Error('本次一键暂停的任务已处理，请刷新状态。');
   return telephonyApi.resumeAll(org,batch.id);
  }
  if(!pauseRequest.current||pauseRequest.current.org!==org)pauseRequest.current={org,id:crypto.randomUUID()};
  return telephonyApi.pauseAll(org,pauseRequest.current.id);
 },onSuccess:(data,next)=>{
  setResult(data);setAction(null);pauseRequest.current=null;
  const failed=(data.failed?.length||0)+(data.failures?.length||0);
  toast.success(next==='pause'?`已暂停 ${data.pausedCount||0} 个任务，正在通话的电话正常结束`:`已恢复 ${data.resumedCount||0} 个任务${failed?'，部分任务需要处理':''}`);
  void client.invalidateQueries({queryKey:['telephony']});
 },onError:(error:Error)=>{toast.error(error.message);void control.refetch();},retry:false});
 if(control.isPending)return <p role="status" className="text-xs text-muted-foreground">正在核对全局任务控制…</p>;
 if(control.error)return <div className="flex items-center gap-2 text-xs text-destructive" role="alert"><span>一键任务控制读取失败：{control.error.message}</span><Button type="button" size="sm" variant="outline" onClick={()=>void control.refetch()}>重新读取</Button></div>;
 if(!control.data?.canControl)return null;
 const issues=[...(result?.skipped||[]),...(result?.failed||[]),...(result?.failures||[])];
 return <section className="rounded-xl border bg-card px-5 py-4" aria-label="超级管理员任务控制">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="space-y-1"><h2 className="text-sm font-semibold">全部员工AI外呼控制</h2><p className="text-xs leading-5 text-muted-foreground">当前工作区AI外呼执行中 {control.data.runningCount} 个任务{batch?`，本次一键暂停仍有 ${batch.pausedCount} 个待恢复`:''}。</p></div>
   <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={change.isPending||control.data.runningCount===0} onClick={()=>setAction('pause')}><Pause className="size-3.5"/>一键暂停全部</Button><Button type="button" size="sm" disabled={change.isPending||!batch||batch.pausedCount===0} onClick={()=>setAction('resume')}><Play className="size-3.5"/>恢复本次暂停</Button></div>
  </div>
  {result&&<div role="status" className="mt-3 text-xs leading-6 text-muted-foreground"><p>{result.pausedCount!==undefined?`已暂停 ${result.pausedCount} 个任务`: `已恢复 ${result.resumedCount||0} 个任务，剩余 ${result.remainingCount||0} 个待处理`}{issues.length?`；跳过或失败 ${issues.length} 个`:''}。</p>{issues.length>0&&<details className="mt-1"><summary className="cursor-pointer text-foreground">查看未恢复原因</summary><ul className="max-h-40 overflow-auto">{issues.map((item,index)=><li key={(item.id||'task')+index}>{item.name||'任务'}：{item.reason}</li>)}</ul></details>}</div>}
  <Dialog open={action!==null} onOpenChange={open=>{if(!open&&!change.isPending)setAction(null);}}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{action==='pause'?'暂停当前工作区全部执行中任务':'恢复本次一键暂停的任务'}</DialogTitle><DialogDescription>{action==='pause'?`将暂停当前工作区所有员工正在执行的AI外呼 ${control.data.runningCount} 个任务，停止追加拨号；已接通电话正常完成。`:`仅恢复本次一键暂停后仍可继续的 ${batch?.pausedCount||0} 个任务。手动暂停、已结束和已过期的任务会跳过。恢复后将在允许的线路服务时间内拨打剩余号码。`}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={change.isPending} onClick={()=>setAction(null)}>取消</Button><Button type="button" disabled={change.isPending||!action} onClick={()=>{if(action)change.mutate(action);}}>{change.isPending?<Loader2 className="size-3.5 animate-spin"/>:null}{change.isPending?'正在处理…':action==='pause'?'确认暂停':'确认恢复'}</Button></div></DialogContent></Dialog>
 </section>;
}
