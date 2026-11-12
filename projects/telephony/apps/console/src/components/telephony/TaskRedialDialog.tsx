/*
 * 中文导读：线路与语音外呼的 TaskRedialDialog 组件，封装该界面的展示与交互。
 */
'use client';
import {useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {RotateCcw,ChevronLeft,ChevronRight} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,taskOutcomeNames,callReasonText,type SipTask} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {NativeSelect} from '@/src/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';
import {useDialingLines} from './DialingLineSelect';
const PAGE_SIZE=10;
export function TaskRedialDialog({task:taskSummary,ready,onView}:{task:SipTask;ready:boolean;onView:(id:string)=>void}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [open,setOpen]=useState(false),[filter,setFilter]=useState('ALL'),[page,setPage]=useState(1),[selection,setSelection]=useState<string[]|null>(null);
 const [lineId,setLineId]=useState('');
 const details=useQuery({queryKey:['telephony',user,org,'task',taskSummary.id],queryFn:({signal})=>telephonyApi.task(org,taskSummary.id,{signal}),enabled:!!org&&!!user&&open&&taskSummary.summary===true,retry:false});
 const task=taskSummary.summary===true&&details.data?details.data:taskSummary;
 const detailUnavailable=taskSummary.summary===true&&!details.data;
 const detailError=taskSummary.summary===true?details.error:null;
 const detailBusy=taskSummary.summary===true&&(detailUnavailable||details.isFetching||!!detailError);
 const lines=useDialingLines(open,task.createdBy);
 const redialLines=lines.data.filter(line=>line.provider==='HAOKEHU_SIP');
 const chosenLine=redialLines.find(line=>line.id===lineId);
 const invalidLine=!!lineId&&(!chosenLine||!chosenLine.enabled||!chosenLine.ready||lines.isError);
 const request=useRef<{key:string;id:string}|null>(null);
 const submitLock=useRef(false);
 const candidates=useMemo(()=>task.recipientResults?.filter(row=>row.redialEligible&&row.attemptId)||[],[task.recipientResults]);
 const candidateIds=useMemo(()=>candidates.map(row=>row.attemptId!),[candidates]);
 const selectedIds=selection??candidateIds;
 const hasCandidates=(taskSummary.redialEligibleCount??candidates.length)>0;
 const updateSelection=(update:(ids:string[])=>string[])=>setSelection(prior=>update(prior??candidateIds));
 const filtered=useMemo(()=>candidates.filter(row=>filter==='ALL'||row.outcome===filter),[candidates,filter]);
 const selectedSet=useMemo(()=>new Set(selectedIds),[selectedIds]);
 const filteredSet=useMemo(()=>new Set(filtered.map(row=>row.attemptId!)),[filtered]);
 const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),current=Math.min(page,pages),visible=filtered.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE);
 const selected=useMemo(()=>candidates.filter(row=>selectedSet.has(row.attemptId!)),[candidates,selectedSet]);
 const allSelected=filtered.length>0&&filtered.every(row=>selectedSet.has(row.attemptId!));
 const submit=useMutation({mutationFn:async()=>{
  const attemptIds=selected.map(row=>row.attemptId!).sort(),key=JSON.stringify({org,user,taskId:task.id,attemptIds,lineId:lineId||null});
  if(detailBusy)throw new Error('请等待任务详情读取完成后再重拨');
  if(!attemptIds.length)throw new Error('请选择需要重拨的号码');
  if(invalidLine)throw new Error('所选线路当前不可用，请重新选择');
  if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  return telephonyApi.redial(org,task.id,{requestId:request.current.id,attemptIds,confirmed:true,...(lineId?{lineId}:{})});
 },onSuccess:result=>{
  setOpen(false);setSelection([]);request.current=null;void qc.invalidateQueries({queryKey:['telephony']});
  if(result.startError){toast.error('重拨已保存：'+result.startError);onView(result.id);}
  else if(result.skippedCount)toast.info(`已在原任务安排 ${result.count} 个号码重拨，${result.skippedCount} 个因线路规则跳过。${result.skipReasons?.map(row=>row.reason+'（'+row.count+'个）').join('；')||''}`);
  else toast.success(`已在原任务安排 ${result.count} 个号码再拨一次`);
 },onError:(error:Error)=>{toast.error(error.message);void qc.invalidateQueries({queryKey:['telephony']});},retry:false});
 if(!task.canOperate||!task.redialSupported||task.localPreview)return null;
 return <><Button type="button" variant="outline" size="icon-sm" className="size-7" aria-label={"再拨一次"+task.name} disabled={!hasCandidates} title={hasCandidates?'选择未接听、未打通的号码再拨一次':'暂无适合重拨的号码'} onClick={()=>{setFilter('ALL');setPage(1);setLineId('');setSelection(null);request.current=null;setOpen(true);}}><RotateCcw aria-hidden="true" className="size-3.5"/></Button>
 <Dialog open={open} onOpenChange={value=>{if(!submit.isPending)setOpen(value);}}><DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl"><DialogHeader><DialogTitle>选择号码再拨一次</DialogTitle><DialogDescription>{task.name}。在原任务内重拨勾选的号码，每次拨打记录都会保留。</DialogDescription></DialogHeader>
 {detailUnavailable||detailError?<div className="space-y-3 py-6 text-sm">{detailError?<><p role="alert" className="text-destructive">重拨号码读取失败：{detailError.message}</p><Button type="button" variant="outline" disabled={details.isFetching} onClick={()=>{void details.refetch();}}>{details.isFetching?'重试中…':'重新加载'}</Button></>:<p role="status" className="text-muted-foreground">正在读取可重拨号码…</p>}</div>:<>
 <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={allSelected} disabled={submit.isPending||!filtered.length} onChange={event=>updateSelection(prior=>event.target.checked?[...new Set([...prior,...filtered.map(row=>row.attemptId!)])]:prior.filter(id=>!filteredSet.has(id)))}/>全选筛选结果（{filtered.length}）</label><NativeSelect aria-label="筛选重拨号码" value={filter} disabled={submit.isPending} onChange={event=>{const value=event.target.value;setFilter(value);setPage(1);setSelection(candidates.filter(row=>value==='ALL'||row.outcome===value).map(row=>row.attemptId!));}}><option value="ALL">未接听和未打通</option><option value="UNANSWERED">未接听</option><option value="FAILED">未打通</option></NativeSelect></div>
 <label className="flex flex-wrap items-center gap-3 text-sm"><span className="shrink-0">重拨线路</span><NativeSelect aria-label="重拨线路" className="min-w-0 flex-1" value={lineId} disabled={submit.isPending} onChange={event=>setLineId(event.target.value)}><option value="">沿用原线路{task.lineName?' · '+task.lineName:''}</option>{redialLines.map(line=><option key={line.id} value={line.id} disabled={!line.enabled||!line.ready}>{line.serviceProvider||'好客呼'} · {line.name}{!line.enabled?'（未启用）':!line.ready?'（暂不可用）':''}</option>)}</NativeSelect></label>
 {lines.isError?<p role="alert" className="text-xs text-destructive">线路列表读取失败，可沿用原线路，或关闭后重新打开。</p>:lines.isPending?<p className="text-xs text-muted-foreground">正在读取可用线路…</p>:null}
 <div className="min-h-0 overflow-auto rounded-md border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-card"><tr><th className="w-10 p-3"><span className="sr-only">选择</span></th><th className="p-3">号码</th><th className="p-3">拨打结果</th><th className="p-3">原因</th></tr></thead><tbody>{visible.map(row=>{
  const recipient=task.recipients[row.recipientIndex],attempt=task.attempts.find(attempt=>attempt.id===row.attemptId);
  return <tr key={row.attemptId} className="border-t"><td className="p-3"><input type="checkbox" className="size-4 accent-primary" aria-label={'重拨'+recipient.phoneNumber} checked={selectedSet.has(row.attemptId!)} disabled={submit.isPending} onChange={event=>updateSelection(prior=>event.target.checked?[...new Set([...prior,row.attemptId!])]:prior.filter(id=>id!==row.attemptId))}/></td><td className="p-3 tabular-nums">{recipient.phoneNumber}{recipient.name&&<p className="text-xs text-muted-foreground">{recipient.name}</p>}</td><td className="whitespace-nowrap p-3">{taskOutcomeNames[row.outcome]}</td><td className="p-3 text-xs text-muted-foreground">{attempt?.result.reason?callReasonText(attempt.result.reason,attempt.result.diagnostics):'线路暂未接通'}</td></tr>;
 })}</tbody></table>{!filtered.length&&<p className="p-6 text-center text-sm text-muted-foreground">当前没有符合条件的号码。</p>}</div>
 <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>已选 {selected.length} 个号码</span><div className="flex items-center gap-2"><Button type="button" size="icon-sm" variant="outline" aria-label="上一页重拨号码" disabled={current<=1||submit.isPending} onClick={()=>setPage(current-1)}><ChevronLeft className="size-4"/></Button><span>{current} / {pages}</span><Button type="button" size="icon-sm" variant="outline" aria-label="下一页重拨号码" disabled={current>=pages||submit.isPending} onClick={()=>setPage(current+1)}><ChevronRight className="size-4"/></Button></div></div>
 </>}
 <p className="text-xs leading-5 text-muted-foreground">沿用原任务的数字员工、话术和声音，每个勾选号码再拨一次。{lineId?'本次勾选的重拨号码使用所选线路，原有待拨号码按原线路执行。':'本次重拨沿用原线路。'}暂停的任务将恢复执行。按线路允许的时段、频次和并发执行，产生正常通话费用。</p>
 <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={submit.isPending} onClick={()=>setOpen(false)}>取消</Button><Button type="button" disabled={submit.isPending||detailBusy||!selected.length||!ready||invalidLine} onClick={()=>{if(submitLock.current)return;submitLock.current=true;void submit.mutateAsync().catch(()=>{}).finally(()=>{submitLock.current=false;});}}>{submit.isPending?'正在安排…':`确认再拨 ${selected.length} 个号码`}</Button></div></DialogContent></Dialog></>;
}
