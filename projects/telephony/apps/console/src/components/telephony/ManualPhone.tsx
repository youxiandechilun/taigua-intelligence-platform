/*
 * 中文导读：线路与语音外呼的 ManualPhone 组件，封装该界面的展示与交互。
 */
"use client";
import Link from 'next/link';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {PhoneCall,PhoneOff,Delete,Headset,ChevronDown,Smartphone} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,useTelephony,useManualTasks,phoneStatus,callReason} from '@/src/lib/api/resources/telephony';
import type {Recipient} from '@/src/lib/api/resources/aliyun';
import {CrmRecipientPicker} from '@/src/components/crm/CrmRecipientPicker';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {toast} from '@/src/lib/toast';
import {DialingLineSelect,useDialingLines} from './DialingLineSelect';
import {selectedDialLine,dialProvinceName,type DialSelection} from '@/src/lib/outbound/dialing-lines';
const localPreview=process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true';
export function ManualPhonePanel({onCollapse}:{onCollapse?:()=>void}){
 const {org,user}=useAliyunIdentity(),config=useTelephony({refreshStatus:true}),qc=useQueryClient();
 const lines=useDialingLines();
 const [selection,setSelection]=useState<DialSelection>({provider:'HAOKEHU_SIP',province:'',lineId:''});
 const selectedLine=selectedDialLine(lines.data,selection);
 const [number,setNumber]=useState(''),[recipient,setRecipient]=useState<Recipient|null>(null),[requestId,setRequestId]=useState('');
 const seats=useQuery({queryKey:['telephony',user,org,'seats'],queryFn:()=>telephonyApi.seats(org),enabled:!!org&&!!user,retry:false,staleTime:15000});
 const tasks=useManualTasks();
 const seat=seats.data?.find(s=>s.userId===user),calls=tasks.data?.filter(t=>t.kind==='MANUAL')||[];
 const active=calls.find(t=>t.createdBy===user&&t.attempts.some(a=>['DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW'].includes(a.status))),attempt=active?.attempts.find(a=>['DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW'].includes(a.status));
 const target=recipient||{phoneNumber:number,name:'',variables:{}};
 const priorRequest=calls.find(t=>t.id===requestId&&t.createdBy===user)?.attempts[0];
 const latest=calls.find(t=>t.createdBy===user&&t.recipients[0]?.phoneNumber===target.phoneNumber)?.attempts[0];
 const failed=latest&&['NOT_ANSWERED','FAILED'].includes(latest.status)?latest:undefined;
 const refresh=()=>{void qc.invalidateQueries({queryKey:['telephony',user,org]});};
 const dial=useMutation({mutationFn:(id:string)=>telephonyApi.dial(org,{recipient:target,requestId:id,confirmation:target.phoneNumber,...selection}),onSuccess:data=>{refresh();if(data.status==='NEEDS_REVIEW'){toast.error('拨号结果未确认，请先核对通话记录');return;}if(['NOT_ANSWERED','FAILED'].includes(data.status)){toast.error(callReason[data.reason]||'上次通话未接通，请查看通话记录');return;}if(data.duplicate){toast.success('此请求已处理，当前状态：'+(phoneStatus[data.status]||'待确认'));return;}toast.success('正在呼叫你的接听电话');},onError:(e:Error)=>{refresh();toast.error(e.message);}});
 const preview=useMutation({mutationFn:async(candidate:Recipient)=>{
  const missing=[...(!selectedLine?['请选择通话线路']:selectedLine.provider!=='HAOKEHU_SIP'?['此线路未开通人工通话']:!selectedLine.enabled||!selectedLine.ready||!config.data?.manualReady?['人工通话线路尚未就绪']:[]),...(!seat?.phone?['员工接听号码未配置']:[]),...(!seat?.available?['员工当前离岗']:[])];
  return {...(localPreview?{steps:['员工接听','连接客户','记录通话'],employeePhone:seat?.phone||'',missing,ready:missing.length===0,lineName:selectedLine?.name||'',province:dialProvinceName(selection.province)}:await telephonyApi.manualPreview(org,{recipient:candidate,requestId:crypto.randomUUID(),...selection})),recipientKey:JSON.stringify({candidate,selection})};
 },onError:(e:Error)=>toast.error(e.message)});
 const selectedPreview=preview.data?.recipientKey===JSON.stringify({candidate:target,selection})?preview.data:undefined;
 const lineReady=!localPreview&&!!selectedLine&&selectedLine.provider==='HAOKEHU_SIP'&&selectedLine.enabled&&selectedLine.ready;
 const canControl=active?active.manualControls!==false:config.data?.manualControls!==false;
 const control=useMutation({mutationFn:({action,digit}:{action:string;digit?:string})=>telephonyApi.control(org,attempt!.id,action,digit),onSuccess:refresh,onError:(e:Error)=>toast.error(e.message)});
 function digit(value:string){if(attempt?.status==='CONNECTED'&&canControl)control.mutate({action:'dtmf',digit:value});else if(!active){setNumber(n=>(n+value).slice(0,20));setRecipient(null);setRequestId('');preview.reset();}}
 async function confirm(){
  if(dial.isPending||preview.isPending)return;
  try{
   const checked=await preview.mutateAsync(target);
   if(!checked.ready){toast.error('暂不能拨打：'+checked.missing.join('、'));return;}
   const finished=priorRequest&&['COMPLETED','NOT_ANSWERED','FAILED','CANCELLED'].includes(priorRequest.status);
   const id=!requestId||finished?crypto.randomUUID():requestId;
   if(window.confirm(`确认通过${checked.lineName||selectedLine?.name||'所选线路'}呼叫客户 ${target.phoneNumber}？系统先呼叫你的接听号码 ${checked.employeePhone||seat?.phone||'未配置'}，接听后连接客户。两路通话均可能产生线路费用。`)){setRequestId(id);dial.mutate(id);}
  }catch{/* The preview mutation reports validation errors without placing a call. */}
 }
 const serviceLoading=config.isPending||seats.isPending||tasks.isPending;
 const serviceFailed=config.isError||seats.isError||tasks.isError;
 const statusText=attempt?`当前：${phoneStatus[attempt.status]||'待确认'}`:serviceLoading?'正在连接通话服务…':serviceFailed?'通话服务暂不可用，请稍后再试。':selectedPreview?.missing.length?'暂不能拨打：'+selectedPreview.missing.join('、')+'。':localPreview?'本地预览可查看拨号流程。':!selectedLine?'请选择通话线路。':selectedLine.provider==='ALIYUN_ENGINE'?'所选线路未开通人工通话。':!seat?.phone?'请先配置员工接听号码。':!seat.available?'设为在岗后即可拨打。':!lineReady?'通话线路准备中，暂不能拨打。':'先接听员工手机，再连接客户。';
 return <section className="bg-card text-foreground">
  <header className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
   <div className="flex min-w-0 items-center gap-2.5"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary"><Headset className="size-5" strokeWidth={1.8}/></span><h2 className="text-sm font-semibold">人工通话</h2></div>
   <div className="flex shrink-0 items-center gap-1.5"><span className={'rounded-full px-2 py-1 text-xs '+(seat?.available?'bg-primary/8 text-primary':'bg-muted text-muted-foreground')}>{seat?.available?'在岗':'离岗'}</span>{onCollapse&&<Button type="button" size="icon-sm" variant="ghost" className="rounded-lg" aria-label="收起拨号面板" onClick={onCollapse}><ChevronDown className="size-4"/></Button>}</div>
  </header>
  <div className="space-y-3 px-4 py-3">
   <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5"><Smartphone className="size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">员工接听号码</p><p className="mt-0.5 truncate text-sm font-medium tabular-nums">{seat?.phone||'待管理员分配'}</p></div>{config.data?.canManage&&<Link className="shrink-0 text-xs text-primary hover:underline" href="/settings/members">设置</Link>}</div>
   <DialingLineSelect value={selection} compact disabled={!!active||dial.isPending||preview.isPending} onChange={next=>{setSelection(next);setRequestId('');preview.reset();}}/>
   <div className="space-y-1.5">
    <label htmlFor="manual-customer-number" className="text-xs text-muted-foreground">客户号码</label>
    <div className="relative"><Input id="manual-customer-number" aria-label="客户电话号码" type="tel" inputMode="tel" autoComplete="off" className="h-12 rounded-xl border-border/80 bg-background pr-10 pl-3 text-center text-xl! font-medium tracking-wide tabular-nums shadow-none placeholder:text-sm placeholder:font-normal placeholder:tracking-normal" value={active?.recipients[0]?.phoneNumber||number} disabled={!!active||dial.isPending||preview.isPending} placeholder="输入号码或从客户库选择" onChange={e=>{setNumber(e.target.value.replace(/[^0-9]/g,'').slice(0,20));setRecipient(null);setRequestId('');preview.reset();}}/><Button type="button" variant="ghost" size="icon-sm" className="absolute top-2 right-1.5 rounded-lg text-muted-foreground" aria-label="删除末位号码" disabled={!number||!!active||dial.isPending||preview.isPending} onClick={()=>{setNumber(v=>v.slice(0,-1));setRecipient(null);setRequestId('');preview.reset();}}><Delete className="size-4"/></Button></div>
    {recipient&&<p className="truncate text-center text-xs text-muted-foreground">{recipient.name||'已关联客户'}</p>}
   </div>
   <div role="group" aria-label="拨号键盘" className="grid grid-cols-3 gap-1.5">{'123456789*0#'.split('').map(value=><button key={value} type="button" aria-label={'拨号按键'+value} disabled={dial.isPending||preview.isPending||control.isPending||!!active&&(!canControl||attempt?.status!=='CONNECTED')} onClick={()=>digit(value)} className="flex h-10 items-center justify-center rounded-xl border border-border/50 bg-muted/30 text-[22px] leading-none font-medium tabular-nums transition-colors hover:border-primary/30 hover:bg-primary/8 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{value}</button>)}</div>
   <div className="flex gap-2"><Button type="button" className="h-10 flex-1 gap-2 rounded-xl" disabled={!lineReady||preview.isPending||!seat?.available||!seat.phone||!number||!!active||dial.isPending||tasks.isPending||tasks.isError} onClick={confirm}><PhoneCall className="size-[18px]"/>{dial.isPending?'连接中…':'拨打电话'}</Button><Button type="button" variant="destructive" size="icon-lg" className="rounded-xl" aria-label="挂断当前通话" disabled={!attempt||!canControl||control.isPending} onClick={()=>control.mutate({action:'hangup'})}><PhoneOff className="size-[18px]"/></Button></div>
   <div className="grid grid-cols-2 gap-2"><CrmRecipientPicker workspaceId={org} userId={user} triggerClassName="h-8 w-full rounded-lg px-2 text-xs shadow-none" disabled={!!active||dial.isPending||preview.isPending} onSelect={rows=>{if(active)return;const r=rows[0];if(r){setRecipient(r);setNumber(r.phoneNumber);setRequestId('');preview.reset();if(rows.length>1)toast.success('人工通话一次联系一个客户，已选择名单中的第一位');}}}/><Button type="button" variant="ghost" className="h-8 rounded-lg text-xs text-muted-foreground" disabled={!number||!selectedLine||preview.isPending||!!active} onClick={()=>preview.mutate(target)}>{preview.isPending?'预览中…':'拨号预览'}</Button></div>
   {active&&!canControl&&<p className="text-xs leading-5 text-muted-foreground">请在接听手机上挂断。结束后会自动更新话单和录音。</p>}
   <p role="status" className="border-t border-border/60 pt-2.5 text-xs leading-5 text-muted-foreground">{statusText}</p>
   {!active&&failed&&<p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">上次未接通：{callReason[failed.result.reason||'']||'线路呼叫失败，请在通话记录中核对'}。再次拨打会重新请求你的确认。</p>}
   {[config.error,seats.error].filter(Boolean).map((e,i)=><p key={i} role="alert" className="text-xs text-destructive">{e?.message}</p>)}
   {selectedPreview&&<div className="space-y-1 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs leading-5"><strong className="font-medium text-primary">仅预览，不发起通话</strong><p>匹配线路：{selectedPreview.lineName}{selectedPreview.province?'（'+selectedPreview.province+'）':''}</p><p className="text-muted-foreground">{selectedPreview.steps.join(' → ')}</p>{selectedPreview.missing.length>0&&<p className="text-muted-foreground">待完成：{selectedPreview.missing.join('、')}</p>}</div>}
  </div>
 </section>;
}
export function ManualPhone(){
 const {org,user}=useAliyunIdentity(),config=useTelephony(),qc=useQueryClient(),tasks=useManualTasks();
 const calls=tasks.data?.filter(t=>t.kind==='MANUAL')||[];
 const refresh=()=>{void qc.invalidateQueries({queryKey:['telephony',user,org]});};
 const reconcile=useMutation({mutationFn:({id,note}:{id:string;note?:string})=>telephonyApi.reconcile(org,id,{close:!!note,note:note||''}),onSuccess:(data,vars)=>{refresh();if(data.closed){toast.success('已归档，未重新拨号');return;}if(data.canArchive===false){toast.success(data.message||'话单已核对');return;}if(data.active){toast.success('线路上仍有通话，请等待结束或挂断');return;}const note=window.prompt('线路已无活动通话。请核对结果并填写归档说明；归档不会重拨。');if(note?.trim())reconcile.mutate({id:vars.id,note:note.trim()});},onError:(e:Error)=>toast.error(e.message)});
 return <section className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between gap-3 border-b px-5 py-4"><h2 className="text-sm font-semibold">人工通话记录</h2><Button size="sm" onClick={()=>window.dispatchEvent(new Event('taigua:open-manual-phone'))}><PhoneCall className="size-4"/>打开拨号器</Button><Link className="text-xs text-primary" href="/calls">全部通话记录</Link></div>{tasks.error?<p role="alert" className="p-5 text-sm text-destructive">{tasks.error.message}</p>:tasks.isPending?<p className="p-5 text-sm text-muted-foreground">正在加载…</p>:calls.length?<div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/20"><tr>{['客户','电话','状态','时长','操作'].map(h=><th key={h} className="px-4 py-3 text-sm font-medium">{h}</th>)}</tr></thead><tbody>{calls.map(t=>{const a=t.attempts[0],r=t.recipients[0];return <tr key={t.id} className="border-t"><td className="px-4 py-3">{r?.crmCompanyId?<Link className="hover:text-primary" href={'/crm/companies/'+r.crmCompanyId}>{r.name||'客户资料'}</Link>:r?.name||'人工拨号'}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{r?.phoneNumber}</td><td className="px-4 py-3"><p>{phoneStatus[a?.status||t.status]||'待确认'}</p>{a?.result.reason&&<p className="mt-1 text-xs text-muted-foreground">{callReason[a.result.reason]||'待核对'}</p>}</td><td className="px-4 py-3 tabular-nums">{a?.result.durationSeconds!=null?a.result.durationSeconds+'秒':'—'}{a?.result.recordingState&&<p className="mt-1 text-xs text-muted-foreground">{({READY:'录音可收听',PENDING:'录音生成中',WAITING:'等待录音',HOST_REQUIRED:'录音来源待配置',UNAVAILABLE:'暂无录音'} as Record<string,string>)[a.result.recordingState]||''}</p>}</td><td className="px-4 py-3">{a?.status==='NEEDS_REVIEW'&&config.data?.canManage?<Button size="sm" variant="outline" disabled={reconcile.isPending} onClick={()=>reconcile.mutate({id:a.id})}>核对</Button>:r?.crmCompanyId?<Link className="text-xs text-primary" href={'/crm/companies/'+r.crmCompanyId}>查看客户</Link>:'—'}</td></tr>;})}</tbody></table></div>:<div className="px-5 py-12 text-center"><PhoneCall className="mx-auto size-6 text-muted-foreground"/><p className="mt-3 text-sm">还没有人工通话记录</p></div>}</section>;
}
