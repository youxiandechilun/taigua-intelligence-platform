/*
 * 中文导读：线路与语音外呼的 SipTaskCenter 组件，封装该界面的展示与交互。
 */
"use client";
import {DataAccountFilter} from "@/src/components/shared/DataAccountFilter";
import { NativeSelect } from "@/src/components/ui/native-select";
import {useSearchParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,useTelephony,phoneStatus,callReasonText,type SipTask,taskOutcomeNames,type TaskOutcome,type CarrierBatchSummary,type TaskResultStats} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/src/components/ui/dropdown-menu';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {downloadExcelMatrix} from '@/src/lib/export-excel';
import {toast} from '@/src/lib/toast';
import {Download,Trash2,Search,ChevronRight,ChevronLeft,ClipboardList,RotateCcw,Pause,Play,MoreHorizontal,Eye,Loader2} from 'lucide-react';
import {TaskParallelismControls} from './TaskParallelismControls';
import {TaskRetryControls} from './TaskRetryControls';
import {TaskRedialDialog} from './TaskRedialDialog';
import {TaskContinueDialog} from './TaskContinueDialog';
import {TaskRecipients} from './TaskRecipients';
import {QuickOutboundForm} from './QuickOutboundForm';
import {TaskBatchControls} from './TaskBatchControls';
import {useDialingLines} from './DialingLineSelect';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {dialProviderName,dialProvinceName} from '@/src/lib/outbound/dialing-lines';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {canViewAllOutbound} from '@/src/lib/outbound/task-visibility';
const localPreview=process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true';
const taskStatusStyles:Record<string,string>={
 DRAFT:'bg-muted text-muted-foreground',
 RUNNING:'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
 PAUSED:'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
 COMPLETED:'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
 NEEDS_REVIEW:'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
 FAILED:'bg-destructive/10 text-destructive',
};
const taskFilters=[{id:'ALL',label:'全部状态'},{id:'DRAFT',label:'草稿'},{id:'RUNNING',label:'执行中'},{id:'WAITING',label:'等待拨打'},{id:'PAUSED',label:'已暂停'},{id:'COMPLETED',label:'已完成'},{id:'NEEDS_REVIEW',label:'待继续'},{id:'FAILED',label:'失败'},{id:'CANCELLED',label:'已归档'},...(localPreview?[{id:'REMOVED',label:'已移除的本地草稿'}]:[])];
const PAGE_SIZE=12;
const resultStatItems:{key:keyof TaskResultStats;label:string}[]=[{key:'dialed',label:'已打'},{key:'answered',label:'接听'},{key:'unanswered',label:'未接'},{key:'assistant',label:'语音助手'},{key:'pending',label:'待拨'}];
const resultStatsDescription='按每个任务内客户号码去重，重拨不重复累计。接听包含语音助手；已打包含已发起且仍在处理的拨号。未接包含实际发起后的未接听、未打通；拨号前被拦截的不计入。待拨包含排队重拨，可与已打、未接重叠。';
function TaskResultCounts({stats,className}:{stats:TaskResultStats;className:string}){
 return <div title={resultStatsDescription} className={className}>{resultStatItems.map(({key,label})=><span key={key} className="whitespace-nowrap text-muted-foreground">{label} <strong className={key==='answered'?'font-medium text-emerald-700 dark:text-emerald-300':'font-medium text-foreground'}>{stats[key]}</strong></span>)}</div>;
}
const taskCaller=(line:{callerLabel?:string;callerMode?:string;callerNumber:string})=>line.callerLabel||(line.callerMode==='provider'?'服务商分配':line.callerNumber||'未记录主叫标识');
const taskState=(task:SipTask)=>task.continuationEligibleCount?'已到期':task.dispatch?.label||(task.status==='NEEDS_REVIEW'?'待继续':phoneStatus[task.status]||'待确认');
const beijingTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

function TaskLineDetails({task}:{task:SipTask}) {
 return <section className="space-y-3" aria-label="保存时的任务线路">
  <p className="text-xs text-muted-foreground">保存时的线路信息</p>
  {<dl className="grid gap-2 rounded-md border p-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">线路供应商</dt><dd className="mt-1">{dialProviderName(task.provider,task.serviceProvider)}</dd></div><div><dt className="text-muted-foreground">省份 / 范围</dt><dd className="mt-1">{task.province?dialProvinceName(task.province):'历史任务未记录'}</dd></div><div><dt className="text-muted-foreground">具体线路</dt><dd className="mt-1">{task.lineName||'旧任务未记录线路名称'}</dd></div><div><dt className="text-muted-foreground">主叫标识</dt><dd className="mt-1 tabular-nums">{taskCaller(task)}</dd></div></dl>}{(task.lineRoutes?.length||0)>1&&<div className="space-y-2 rounded-md border p-4 text-sm"><h3 className="font-medium">保存的逐线路分配</h3>{task.lineRoutes?.map((line,index)=><p key={index}>{line.province?dialProvinceName(line.province):'未记录省份'} · {line.lineName} · 主叫 {taskCaller(line)} · {line.recipients} 位客户</p>)}</div>}
 </section>;
}

function TaskRow({task:taskSummary,canManage,ready,initialOpen=false,showCreator=false,onView}:{task:SipTask;canManage:boolean;ready:boolean;initialOpen?:boolean;showCreator?:boolean;onView:(id:string)=>void}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();const [open,setOpen]=useState(initialOpen),[confirmAction,setConfirmAction]=useState<'start'|'delete'|null>(null);
 const details=useQuery({queryKey:['telephony',user,org,'task',taskSummary.id],queryFn:({signal})=>telephonyApi.task(org,taskSummary.id,{signal}),enabled:!!org&&!!user&&taskSummary.summary===true&&(open||confirmAction==='start'),retry:false,refetchInterval:open&&taskSummary.status==='RUNNING'?15000:false,refetchIntervalInBackground:false});
 const task=taskSummary.summary===true&&(open||confirmAction==='start')&&details.data?details.data:taskSummary;
 const detailUnavailable=taskSummary.summary===true&&!details.data;
 const startDetailsBlocked=taskSummary.summary===true&&(detailUnavailable||details.isFetching||!!details.error);
 const preview=useMutation({mutationFn:()=>telephonyApi.preview(org,task.id),onError:(e:Error)=>toast.error(e.message)});
 const mutate=useMutation({mutationFn:({action,id,lineId}:{action:string;id?:string;lineId?:string})=>(action==='delete'||action==='restore')?(task.localPreview?unwrap(apiClient.patch('/outbound-task-drafts',{id:task.id,removed:action!=='restore'},{headers:{'x-workspace-id':org}})):telephonyApi.remove(org,task.id)):telephonyApi.action(org,task.id,action,{confirmation:id,...(lineId?{lineId}:{})}),onSuccess:(data,variables)=>{const summary=data&&typeof data==='object'?data as Partial<CarrierBatchSummary>:null;setConfirmAction(null);if(variables.action==='delete')setOpen(false);void qc.invalidateQueries({queryKey:['telephony']});if(task.localPreview&&variables.action==='delete'){toast.success('本地草稿已移除',{duration:15000,action:{label:'撤销',onClick:()=>{void unwrap(apiClient.patch('/outbound-task-drafts',{id:task.id,removed:false},{headers:{'x-workspace-id':org}})).then(()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('本地草稿已恢复');}).catch((error:Error)=>toast.error(error.message));}}});}else toast.success(task.localPreview?'本地草稿已恢复':variables.action==='delete'?'任务已删除，通话记录已保留':variables.action==='pause'?'已暂停新拨号，正在通话的客户正常结束':summary?.skippedCount?`本次可拨 ${summary.acceptedCount??0} 个，已跳过 ${summary.skippedCount} 个号码`:variables.lineId?'已切换线路并继续任务':'任务已继续');},onError:(e:Error)=>{void qc.invalidateQueries({queryKey:['telephony']});toast.error(e.message);},retry:false});
 const resumable=['PAUSED','NEEDS_REVIEW'].includes(task.status);
 const [resumeLineId,setResumeLineId]=useState('');
 const canSwitchResumeLine=resumable&&(task.provider||'HAOKEHU_SIP')==='HAOKEHU_SIP'&&!task.localPreview;
 const resumeLines=useDialingLines(confirmAction==='start'&&canSwitchResumeLine,task.createdBy);
 const sipLines=resumeLines.data.filter(line=>line.provider==='HAOKEHU_SIP');
 const selectedResumeLine=sipLines.find(line=>line.id===resumeLineId);
 const invalidResumeLine=!!resumeLineId&&(!selectedResumeLine||!selectedResumeLine.enabled||!selectedResumeLine.ready||resumeLines.isError);
 const queuedLineIds=[...new Set(task.attempts.filter(attempt=>attempt.status==='QUEUED').map(attempt=>(attempt.result as {lineOverride?:{lineId?:string}}).lineOverride?.lineId||''))];
 const queuedLineLabel=queuedLineIds.length>1?'多条已安排线路':queuedLineIds[0]?(sipLines.find(line=>line.id===queuedLineIds[0])?.name||'已安排线路'):(task.lineName||'原任务线路');
 useEffect(()=>{if(confirmAction===null)setResumeLineId('');},[confirmAction]);
 const hasRemaining=task.hasQueuedAttempts??task.attempts.some(a=>a.status==='QUEUED');
 const expired=task.endTime?Date.parse(task.endTime)<=Date.now():false;
 return <tr className="border-t align-middle hover:bg-muted/20">
  <td className="max-w-72 px-5 py-3">
   <button type="button" className="max-w-full rounded-sm text-left text-sm font-medium leading-6 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpen(true)}>{task.name}</button>{task.localPreview&&<span className="ml-2 rounded bg-primary/5 px-1.5 py-0.5 text-xs text-primary">本地草稿</span>}
   {task.dispatch&&task.dispatch.message!=='线路分配已变化，等待系统更新任务状态'&&<p className="mt-1 max-w-72 text-xs leading-5 text-amber-700 dark:text-amber-300" title={task.dispatch.message}>{task.dispatch.nextDialAt?'下次可拨：'+beijingTime(task.dispatch.nextDialAt)+'（北京时间）':task.dispatch.message}</p>}
   {!!task.carrierSummary?.skippedCount&&<p className="mt-1 max-w-72 text-xs leading-5 text-muted-foreground" title={task.carrierSummary.skipReasons.map(item=>`${item.reason}：${item.count} 个`).join('；')}>本次可拨 {task.carrierSummary.acceptedCount} 个，已跳过 {task.carrierSummary.skippedCount} 个</p>}
   {task.error&&task.error!=='部分通话结果未回传，继续处理其余号码；未回传的号码不会重复拨打'&&task.status!=='COMPLETED'&&<p className="mt-1 max-w-64 text-xs leading-5 text-destructive">{task.status==='NEEDS_REVIEW'?'部分结果未回传，可继续拨打剩余号码。':task.error}</p>}
  </td>
  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground tabular-nums"><time dateTime={task.createdAt}>{Number.isFinite(Date.parse(task.createdAt))?new Date(task.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未记录'}</time></td>
  {showCreator&&<td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{task.createdByName||(task.createdBy===user?'本人':'未记录姓名')}</td>}
  <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span>{task.agentName}</span>{task.parallelism!==undefined&&<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">×{task.effectiveParallelism??Math.min(task.parallelism,6)}</span>}</div></td>
  <td className="px-4 py-3 text-right text-sm tabular-nums">{task.recipientCount??task.recipients.length}</td>
  <td className="w-20 whitespace-nowrap px-2 py-2"><span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium ${taskStatusStyles[task.dispatch?'PAUSED':task.status]||'bg-muted text-muted-foreground'}`}><span className="size-1 rounded-full bg-current" aria-hidden="true"/>{taskState(task)}</span></td>
  <td className="min-w-60 px-4 py-3">{task.resultStats?<TaskResultCounts stats={task.resultStats} className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs tabular-nums"/>:<span className="text-xs text-muted-foreground">尚未统计</span>}</td>
  <td className="w-20 px-2 py-2 text-center">
   {canManage&&!task.localPreview&&!task.localRemoved&&task.status==='RUNNING'&&<Button size="icon-sm" variant="ghost" className="size-7" aria-label={'暂停任务'+task.name} title="暂停：停止新拨号，已接通的电话正常结束" disabled={mutate.isPending} onClick={()=>mutate.mutate({action:'pause'})}>{mutate.isPending?<Loader2 aria-hidden="true" className="size-3.5 animate-spin"/>:<Pause aria-hidden="true" className="size-3.5"/>}</Button>}
   {canManage&&!task.localPreview&&!task.localRemoved&&resumable&&!expired&&<Button size="icon-sm" variant="ghost" className="size-7" aria-label={'继续任务'+task.name} title={expired?'任务已过结束时间':'继续：拨打剩余号码'} disabled={!ready||mutate.isPending||expired||!hasRemaining} onClick={()=>setConfirmAction('start')}>{mutate.isPending?<Loader2 aria-hidden="true" className="size-3.5 animate-spin"/>:<Play aria-hidden="true" className="size-3.5"/>}</Button>}
   <TaskContinueDialog task={task} ready={ready} compact/>
   {canManage&&task.localRemoved&&<Button size="icon-sm" variant="ghost" className="size-7 text-primary" aria-label={'恢复草稿'+task.name} title="恢复草稿" disabled={mutate.isPending} onClick={()=>mutate.mutate({action:'restore'})}><RotateCcw aria-hidden="true" className="size-3.5"/></Button>}
  </td>
  <td className="w-20 px-2 py-2 text-center"><TaskRedialDialog task={task} ready={ready} onView={onView}/></td>
  <td className="w-14 px-2 py-2 text-center"><Button size="icon-sm" variant="ghost" className="size-7 text-primary hover:bg-primary/5 hover:text-primary" aria-label={'查看任务详情'+task.name} title="详情" onClick={()=>setOpen(true)}><Eye aria-hidden="true" className="size-3.5"/></Button></td>
  <td className="w-14 px-2 py-2 text-center">
   {canManage&&!task.localRemoved&&(!task.localPreview||task.status==='DRAFT')&&<Button size="icon-sm" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" aria-label={'删除任务'+task.name} title="删除" disabled={mutate.isPending} onClick={()=>{if(task.localPreview)mutate.mutate({action:'delete'});else setConfirmAction('delete');}}><Trash2 aria-hidden="true" className="size-3.5"/></Button>}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-3 overflow-hidden sm:max-w-3xl"><DialogHeader><DialogTitle>{task.name}</DialogTitle><DialogDescription>{task.agentName} · 主叫 {taskCaller(task)} · {taskState(task)}{task.voiceName?' · '+task.voiceName:''}{task.voiceVolume!==null&&task.voiceVolume!==undefined?' · 音量 '+task.voiceVolume+'%':''}</DialogDescription></DialogHeader>{detailUnavailable||details.error?<div className="space-y-3 py-6 text-sm">{details.error?<><p role="alert" className="text-destructive">任务详情读取失败：{details.error.message}</p><Button type="button" variant="outline" disabled={details.isFetching} onClick={()=>{void details.refetch();}}>{details.isFetching?'重试中…':'重新加载'}</Button></>:<p role="status" className="text-muted-foreground">正在读取任务详情…</p>}</div>:<><div className="max-h-[35dvh] min-h-0 shrink-0 space-y-3 overflow-y-auto"><div className="flex flex-wrap items-center gap-2"><TaskContinueDialog task={task} ready={ready}/>{canManage&&!task.localPreview&&['DRAFT','PAUSED','NEEDS_REVIEW'].includes(task.status)&&<Button disabled={!ready||mutate.isPending||(resumable&&!hasRemaining)||expired} onClick={()=>setConfirmAction('start')}><Play className="size-4"/>{resumable?'继续任务':'开始任务'}</Button>}{canManage&&task.status==='RUNNING'&&<Button disabled={mutate.isPending} onClick={()=>mutate.mutate({action:'pause'})}><Pause className="size-4"/>{mutate.isPending?'暂停中…':'暂停任务'}</Button>}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="size-4"/>更多操作</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={()=>downloadExcelMatrix(task.name+'-通话结果.xlsx',['客户','联系电话','拨打次数','状态','时长（秒）','通话结果'],task.attempts.map(a=>{const r=task.recipients[a.recipientIndex];return [r?.name,r?.phoneNumber,a.attemptNumber,phoneStatus[a.status]||'待确认',a.result.durationSeconds??'',callReasonText(a.result.reason||'',a.result.diagnostics)];}),'当前任务全部已加载的通话记录。')}><Download className="size-4"/>导出结果</DropdownMenuItem>{!task.localPreview&&<DropdownMenuItem disabled={preview.isPending} onSelect={()=>preview.mutate()}><ClipboardList className="size-4"/>模拟流程预览</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div>{task.status==='RUNNING'&&canManage&&<p className="text-xs leading-5 text-muted-foreground">暂停后停止拨打后续号码，已接通的电话继续完成。</p>}{resumable&&<p className="text-xs leading-5 text-muted-foreground">任务已暂停，继续后仅拨打剩余未拨打号码，未回传结果的号码不会重复拨打。</p>}{task.dispatch&&<div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><p className="font-medium">{task.dispatch.label}</p><p>{task.dispatch.message}</p>{task.dispatch.nextDialAt&&<p>下次可拨：{beijingTime(task.dispatch.nextDialAt)}（北京时间）</p>}</div>}{task.carrierSummary&&<section aria-label="线路规则检查结果" className="rounded-md border px-3 py-2 text-xs leading-6"><p>本次检查 {task.carrierSummary.totalCount} 个，可拨 <strong className="font-medium text-primary">{task.carrierSummary.acceptedCount}</strong> 个，跳过 <strong className="font-medium">{task.carrierSummary.skippedCount}</strong> 个。</p>{task.carrierSummary.skipReasons.map(item=><p key={item.reason} className="text-muted-foreground">{item.reason}：{item.count} 个</p>)}</section>}
<TaskParallelismControls task={task} canManage={canManage}/>
{task.error==='部分通话结果未回传，继续处理其余号码；未回传的号码不会重复拨打'&&task.status!=='COMPLETED'&&<div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><p className="font-medium">通话结果待核对</p><p>{task.error}</p></div>}
<TaskRetryControls task={task} canManage={canManage}/><details className="group rounded-md border px-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">查看任务线路<ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90"/></summary><div className="max-h-[25vh] overflow-auto pb-3"><TaskLineDetails task={task}/></div></details>{preview.data&&<section className="rounded-lg border bg-muted/20 p-4 text-sm"><h3 className="font-medium">模拟预览 · 不拨号</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{preview.data.stages.join(' → ')}</p><p className="mt-3">开场白：{preview.data.opening||'请先补充话术'}</p></section>}</div><TaskRecipients key={task.id} task={task}/></>}</DialogContent></Dialog>
<Dialog open={confirmAction!==null} onOpenChange={value=>{if(!value&&!mutate.isPending)setConfirmAction(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{confirmAction==='start'?(resumable?'继续外呼任务':'确认启动真实外呼'):'删除外呼任务'}</DialogTitle><DialogDescription>{confirmAction==='start'?(resumable?'继续后只拨打尚未完成的号码，将产生线路及模型费用。已处理及结果未回传的号码不会重复拨打。':`即将联系 ${task.recipientCount??task.recipients.length} 位客户，将产生线路及模型费用。请核对保存的线路和客户名单。`):`删除“${task.name}”后将停止后续拨号，正在通话的电话正常结束，已有通话记录保留。`}</DialogDescription></DialogHeader>{confirmAction==='start'&&(detailUnavailable||details.error?<div className="space-y-3 text-sm">{details.error?<><p role="alert" className="text-destructive">任务详情读取失败：{details.error.message}</p><Button type="button" variant="outline" disabled={details.isFetching} onClick={()=>{void details.refetch();}}>{details.isFetching?'重试中…':'重新加载'}</Button></>:<p role="status" className="text-muted-foreground">正在读取任务详情…</p>}</div>:<TaskLineDetails task={task}/>)}
{confirmAction==='start'&&canSwitchResumeLine&&!detailUnavailable&&!details.error&&<div className="space-y-2 border-t pt-4">
 <label className="grid gap-2 text-sm"><span className="font-medium">继续使用的线路</span>
  <NativeSelect aria-label="继续任务使用的线路" value={resumeLineId} disabled={mutate.isPending} onChange={event=>setResumeLineId(event.target.value)}>
   <option value="">保持待拨号码当前线路 · {queuedLineLabel}</option>
   {sipLines.map(line=><option key={line.id} value={line.id} disabled={!line.enabled||!line.ready}>{dialProviderName(line.provider,line.serviceProvider)} · {line.name} · {line.identifier}{!line.enabled?'（未启用）':!line.ready?'（暂不可用）':''}</option>)}
  </NativeSelect>
 </label>
 {resumeLines.isError?<p role="alert" className="text-xs text-destructive">线路列表读取失败，可保持当前线路，或重新打开后再试。</p>:resumeLines.isPending?<p className="text-xs text-muted-foreground">正在读取可用线路…</p>:null}
 {resumeLineId&&<p className="text-xs leading-5 text-muted-foreground">切换后，待拨号码和后续自动重拨使用所选线路；正在通话和已有记录保持原线路。</p>}
</div>}
<div className="flex justify-end gap-2"><Button variant="outline" disabled={mutate.isPending} onClick={()=>setConfirmAction(null)}>取消</Button><Button variant={confirmAction==='delete'?'destructive':'default'} disabled={mutate.isPending||(confirmAction==='start'&&(!ready||startDetailsBlocked||invalidResumeLine))} onClick={()=>{if(confirmAction)mutate.mutate({action:confirmAction,...(confirmAction==='start'?{id:task.id,...(canSwitchResumeLine&&resumeLineId?{lineId:resumeLineId}:{})}:{})});}}>{mutate.isPending?'处理中…':confirmAction==='start'?(resumable?'确认继续':'确认启动真实外呼'):'确认删除任务'}</Button></div></DialogContent></Dialog></td></tr>;
}
export function SipTaskCenter(){
 const params=useSearchParams(),ownerId=params.get('ownerId')||'mine';
 const {org,user}=useAliyunIdentity(),qc=useQueryClient(),config=useTelephony();
 const company=useCompanyContext(),allOutbound=canViewAllOutbound(company.data);
 const engine=useQuery({queryKey:['telephony',user,org,'aliyun-engine'],queryFn:()=>telephonyApi.engine(org),enabled:!!org,retry:false});
 const taskReady=(task:SipTask)=>!localPreview&&(task.provider==='ALIYUN_ENGINE'?engine.data?.ready===true:config.data?.serviceReady===true);
 const [search,setSearch]=useState(''),[statusFilter,setStatusFilter]=useState('ALL'),[outcomeFilter,setOutcomeFilter]=useState('ALL'),[page,setPage]=useState(1);
 const [debouncedSearch,setDebouncedSearch]=useState('');
 useEffect(()=>{const timer=setTimeout(()=>{setDebouncedSearch(search.trim());setPage(1);},300);return ()=>clearTimeout(timer);},[search]);
 const [focusedTask,setFocusedTask]=useState<{id:string;sequence:number}|null>(null);
 const removed=localPreview&&statusFilter==='REMOVED';
 useEffect(()=>{setPage(1);setFocusedTask(null);},[ownerId,org,user]);
 const tasks=useQuery({queryKey:['telephony',user,org,'tasks','summary','paged',removed,ownerId,page,debouncedSearch,statusFilter,outcomeFilter],queryFn:async({signal})=>{
  if(localPreview){
   const [online,drafts]=await Promise.all([removed?Promise.resolve([]):telephonyApi.tasks(org,ownerId,{summary:true,signal}),unwrap<SipTask[]>(apiClient.get('/outbound-task-drafts?trash='+removed,{headers:{'x-workspace-id':org},signal}))]);
   const term=debouncedSearch.toLocaleLowerCase();
   const items=[...drafts,...online].filter(t=>t.kind==='AI'&&(statusFilter==='ALL'||statusFilter==='REMOVED'&&t.localRemoved||statusFilter==='WAITING'&&!!t.dispatch||t.status===statusFilter)&&(outcomeFilter==='ALL'||(t.outcomes?.[outcomeFilter as TaskOutcome]||0)>0)&&(!term||t.name.toLocaleLowerCase().includes(term)||t.agentName.toLocaleLowerCase().includes(term)||(t.createdByName||'').toLocaleLowerCase().includes(term)));
   return {items:items.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),total:items.length,page,pageSize:PAGE_SIZE,outcomeTotals:items.reduce((counts,task)=>{for(const outcome of Object.keys(taskOutcomeNames) as TaskOutcome[])counts[outcome]+=(task.outcomes?.[outcome]||0);return counts;},{ANSWERED:0,UNANSWERED:0,FAILED:0,ASSISTANT:0,PENDING:0,ACTIVE:0,UNCERTAIN:0,CANCELLED:0}),resultStatsTotals:items.every(task=>!!task.resultStats)?items.reduce((counts,task)=>{for(const {key} of resultStatItems)counts[key]+=task.resultStats![key];return counts;},{dialed:0,answered:0,unanswered:0,assistant:0,pending:0}):undefined};
  }
  return telephonyApi.tasksPage(org,ownerId,{summary:true,kind:'AI',page,pageSize:PAGE_SIZE,search:debouncedSearch,status:statusFilter,outcome:outcomeFilter as TaskOutcome|'ALL'},{signal});
 },enabled:!!org&&!!user,retry:false,refetchInterval:15000,refetchIntervalInBackground:false});
 const visibleTasks=tasks.data?.items||[];
 const total=tasks.data?.total||0;
 const pageCount=Math.max(1,Math.ceil(total/PAGE_SIZE)),currentPage=tasks.data?.page||page;
 useEffect(()=>{if(tasks.data&&tasks.data.page!==page)setPage(tasks.data.page);},[tasks.data,page]);
 const resultStatsTotals=tasks.data?.resultStatsTotals;
 const focused=useQuery({queryKey:['telephony',user,org,'task',focusedTask?.id],queryFn:({signal})=>telephonyApi.task(org,focusedTask!.id,{signal}),enabled:!!org&&!!user&&!!focusedTask&&!visibleTasks.some(t=>t.id===focusedTask.id),retry:false});
 const viewTask=(id:string)=>{setSearch('');setDebouncedSearch('');setStatusFilter('ALL');setOutcomeFilter('ALL');setPage(1);setFocusedTask(previous=>({id,sequence:(previous?.sequence||0)+1}));};
 return <div className="space-y-5"><QuickOutboundForm initialAgentId={params.get('agentId')||''} onCreated={()=>{void qc.invalidateQueries({queryKey:['telephony']});setStatusFilter('ALL');setOutcomeFilter('ALL');setPage(1);}} onView={viewTask}/>{company.data?.isSystemAdmin&&!localPreview&&<TaskBatchControls key={org}/>}<section className="overflow-hidden rounded-xl border bg-card">
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
   <div className="flex flex-wrap items-center gap-2.5"><h2 className="text-base font-semibold">外呼记录</h2>{!tasks.isPending&&!tasks.error&&<span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{total}</span>}<span className="text-xs text-muted-foreground">{company.isPending?'正在核对可见范围':allOutbound?(ownerId==='mine'?'我的外呼':ownerId==='all'?'全部账号外呼':'所选账号外呼'):'仅本人外呼'}</span></div>
   {!tasks.isPending&&!tasks.error&&resultStatsTotals&&<div aria-label="外呼统计"><TaskResultCounts stats={resultStatsTotals} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs tabular-nums"/></div>}
  </div>
  {config.error&&<p role="alert" className="border-t px-5 py-3 text-sm text-destructive">{config.error.message}</p>}
  <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
   <div className="relative w-52 shrink-0"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input aria-label="搜索任务或员工" placeholder="搜索任务 / 员工" className="rounded-md pl-9" value={search} onChange={e=>{setSearch(e.target.value);setFocusedTask(null);}}/></div>
   <div className="ml-auto flex flex-wrap items-center gap-2"><NativeSelect aria-label="按拨打结果筛选任务" value={outcomeFilter} onChange={event=>{setOutcomeFilter(event.target.value);setPage(1);setFocusedTask(null);}}><option value="ALL">全部拨打结果</option>{(Object.keys(taskOutcomeNames) as TaskOutcome[]).map(outcome=><option key={outcome} value={outcome}>有{taskOutcomeNames[outcome]}</option>)}</NativeSelect><DataAccountFilter compact/><NativeSelect aria-label="按任务状态筛选" className="h-8 w-24 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);setFocusedTask(null);}}>{taskFilters.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</NativeSelect></div>
  </div>
  {tasks.isPending?<p className="border-t p-5 text-sm text-muted-foreground" role="status">正在读取任务…</p>:tasks.error?<p role="alert" className="border-t p-5 text-sm text-destructive">{tasks.error.message}</p>:visibleTasks.length||focusedTask&&focused.data?<>
   <div className="overflow-x-auto">
    <table className="w-full min-w-[780px] text-left">
     <caption className="sr-only">数字员工外呼任务</caption>
     <thead className="border-t bg-muted/35 text-xs font-medium text-muted-foreground"><tr><th scope="col" className="px-5 py-3 font-medium">任务名称</th><th className="px-4 py-3 font-medium">创建时间</th>{allOutbound&&<th scope="col" className="px-4 py-3 font-medium">创建人</th>}<th scope="col" className="px-4 py-3 font-medium">数字员工</th><th scope="col" className="px-4 py-3 text-right font-medium">客户数</th><th scope="col" className="w-20 px-2 py-2 font-medium">状态</th><th scope="col" className="px-4 py-3 font-medium">拨打结果</th><th scope="col" className="w-20 whitespace-nowrap px-2 py-2 text-center font-medium">暂停 / 继续</th><th scope="col" className="w-20 whitespace-nowrap px-2 py-2 text-center font-medium">再拨一次</th><th scope="col" className="w-14 px-2 py-2 text-center font-medium">详情</th><th scope="col" className="w-14 px-2 py-2 text-center font-medium">删除</th></tr></thead>
     <tbody>{focusedTask&&focused.data&&!visibleTasks.some(t=>t.id===focusedTask.id)&&<TaskRow key={focusedTask.id+':'+focusedTask.sequence} initialOpen showCreator={allOutbound} task={focused.data} canManage={!!focused.data.canOperate} ready={taskReady(focused.data)} onView={viewTask}/>}{visibleTasks.map(t=><TaskRow key={t.id+(focusedTask?.id===t.id?':'+focusedTask.sequence:'')} initialOpen={focusedTask?.id===t.id} showCreator={allOutbound} task={t} canManage={!!t.canOperate} ready={taskReady(t)} onView={viewTask}/>)}</tbody>
    </table>
   </div>
   <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground"><p role="status" aria-live="polite">共 {total} 个任务{search||statusFilter!=='ALL'||outcomeFilter!=='ALL'?'（当前筛选）':''}</p>{pageCount>1&&<nav className="flex items-center gap-2" aria-label="任务分页"><Button size="icon-sm" variant="outline" className="rounded-md" aria-label="上一页任务" disabled={currentPage<=1} onClick={()=>{setPage(currentPage-1);setFocusedTask(null);}}><ChevronLeft className="size-4"/></Button><span className="tabular-nums">{currentPage} / {pageCount}</span><Button size="icon-sm" variant="outline" className="rounded-md" aria-label="下一页任务" disabled={currentPage>=pageCount} onClick={()=>{setPage(currentPage+1);setFocusedTask(null);}}><ChevronRight className="size-4"/></Button></nav>}</div>
  </>:<div className="flex flex-col items-center gap-2 border-t px-5 py-12 text-sm"><ClipboardList aria-hidden="true" className="mb-1 size-7 text-muted-foreground/60"/><p className="font-medium">{search||statusFilter!=='ALL'||outcomeFilter!=='ALL'?'没有匹配的任务':'暂无外呼任务'}</p>{search||statusFilter!=='ALL'||outcomeFilter!=='ALL'?<Button type="button" variant="link" onClick={()=>{setSearch('');setDebouncedSearch('');setStatusFilter('ALL');setOutcomeFilter('ALL');setPage(1);}}>清除筛选</Button>:null}</div>}
 </section>{focusedTask&&focused.error&&<p role="alert" className="text-sm text-destructive">任务详情读取失败：{focused.error.message}</p>}</div>;
}
