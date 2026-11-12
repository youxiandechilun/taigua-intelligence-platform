/*
 * 中文导读：线路与语音外呼的 TaskContinueDialog 组件，封装该界面的展示与交互。
 */
'use client';
import {useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Play} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type SipTask,type CarrierBatchSummary} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {NativeSelect} from '@/src/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';

const chinaInput=(time:number)=>new Date(time+8*3600000).toISOString().slice(0,16);
const chinaDate=(value:string)=>new Date(value+':00+08:00');
type ContinueInput={requestId:string;confirmed:true;startTime:string;endTime:string};

export function TaskContinueDialog({task:summary,ready,compact=false}:{task:SipTask;ready:boolean;compact?:boolean}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [open,setOpen]=useState(false),[mode,setMode]=useState('now'),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const request=useRef<{key:string;data:ContinueInput}|null>(null),locked=useRef(false);
 const details=useQuery({queryKey:['telephony',user,org,'task',summary.id],queryFn:({signal})=>telephonyApi.task(org,summary.id,{signal}),enabled:!!org&&!!user&&open&&summary.summary===true,retry:false});
 const task=summary.summary&&details.data?details.data:summary;
 const busy=summary.summary===true&&(!details.data||details.isFetching||!!details.error);
 const count=task.continuationEligibleCount||0;
 const submit=useMutation({mutationFn:async()=>{
  if(busy||!count)throw new Error('未拨号码状态已变化，请重新打开任务。');
  const now=Date.now(),startDate=mode==='now'?new Date(now):chinaDate(start),endDate=chinaDate(end);
  if(!Number.isFinite(startDate.getTime())||!Number.isFinite(endDate.getTime()))throw new Error('请填写完整的拨打时间。');
  if(endDate.getTime()<=Math.max(now,startDate.getTime()))throw new Error('结束时间必须晚于开始时间和当前时间。');
  if(mode!=='now'&&startDate.getTime()<now)throw new Error('预约开始时间已过，请重新选择。');
  const key=JSON.stringify({org,user,id:task.id,mode,start:mode==='now'?'':start,end});
  if(request.current?.key!==key)request.current={key,data:{requestId:crypto.randomUUID(),confirmed:true,startTime:startDate.toISOString(),endTime:endDate.toISOString()}};
  return telephonyApi.action(org,task.id,'continue',request.current.data) as Promise<CarrierBatchSummary&{count:number}>;
 },onSuccess:result=>{
  setOpen(false);request.current=null;void qc.invalidateQueries({queryKey:['telephony']});
  if(result.skippedCount)toast.info(`已在原任务安排 ${result.count} 个未拨号码，${result.skippedCount} 个因线路规则跳过。`);
  else toast.success(`已在原任务安排 ${result.count} 个未拨号码`);
 },onError:(error:Error)=>{toast.error(error.message);void qc.invalidateQueries({queryKey:['telephony']});},retry:false});
 if(!summary.canOperate||!summary.continuationEligibleCount||summary.localPreview)return null;
 return <><Button type="button" size={compact?'icon-sm':'default'} variant={compact?'ghost':'default'} className={compact?'size-7':undefined} aria-label={'继续未拨号码'+task.name} title={`在原任务继续 ${summary.continuationEligibleCount} 个到期未拨号码`} disabled={!ready||submit.isPending} onClick={()=>{const now=Date.now();setMode('now');setStart(chinaInput(now+3600000));setEnd(chinaInput(now+86400000));request.current=null;setOpen(true);}}><Play aria-hidden="true" className="size-3.5"/>{!compact&&'继续未拨号码'}</Button>
 <Dialog open={open} onOpenChange={value=>{if(!submit.isPending)setOpen(value);}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>在原任务继续未拨号码</DialogTitle><DialogDescription>{task.name}。重新设置拨打期限，保留原任务和通话记录。</DialogDescription></DialogHeader>
 {busy?<div className="space-y-2 text-sm">{details.error?<><p role="alert" className="text-destructive">未拨号码读取失败：{details.error.message}</p><Button variant="outline" disabled={details.isFetching} onClick={()=>{void details.refetch();}}>重新读取</Button></>:<p role="status">正在核对未拨号码…</p>}</div>:<p className="rounded-md border bg-muted/20 p-3 text-sm">本次恢复 <strong>{count}</strong> 个因到期停止、尚未拨出的号码。已拨打或结果待回传的号码不会重复拨打。</p>}
 <div className="space-y-3"><label className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0">开始方式</span><NativeSelect className="flex-1" value={mode} disabled={submit.isPending} onChange={event=>setMode(event.target.value)}><option value="now">现在继续</option><option value="scheduled">预约继续</option></NativeSelect></label>
 {mode==='scheduled'&&<label className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0">开始时间</span><Input type="datetime-local" aria-label="继续任务开始时间（北京时间）" value={start} disabled={submit.isPending} onChange={event=>setStart(event.target.value)}/></label>}
 <label className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0">结束时间</span><Input type="datetime-local" aria-label="继续任务结束时间（北京时间）" value={end} disabled={submit.isPending} onChange={event=>setEnd(event.target.value)}/></label></div>
 <p className="text-xs leading-5 text-muted-foreground">以上为北京时间，最长可设置31天。沿用原任务的数字员工、声音和线路，按当前线路的时段、频次和并发规则拨打，产生正常通话费用。</p>
 <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={submit.isPending} onClick={()=>setOpen(false)}>取消</Button><Button type="button" disabled={!ready||busy||!count||submit.isPending} onClick={()=>{if(locked.current)return;locked.current=true;void submit.mutateAsync().catch(()=>{}).finally(()=>{locked.current=false;});}}>{submit.isPending?'正在安排…':'确认继续未拨号码'}</Button></div></DialogContent></Dialog></>;
}
