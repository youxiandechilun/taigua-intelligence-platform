/*
 * 中文导读：数字员工与话术的 AgentTestCallButton 组件，封装该界面的展示与交互。
 */
"use client";
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, Phone, RefreshCw } from 'lucide-react';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { telephonyApi, callReasonText, type TestCallInput, type TestCallStatus } from '@/src/lib/api/resources/telephony';
import { Button } from '../ui/button';
import { ApiError } from '@/src/lib/errors';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
const labels:Record<string,string>={DRAFT:'尚未拨打',QUEUED:'等待拨号',DISPATCHING:'正在提交线路',DIALING:'正在拨号',CONNECTED:'已接通，可以开始对话',COMPLETED:'测试已结束',NOT_ANSWERED:'未接通',FAILED:'拨号失败',CANCELLED:'已取消',NEEDS_REVIEW:'通话状态待核对',RUNNING:'等待电话服务回执',PAUSED:'已暂停等待'};
const terminal=new Set(['COMPLETED','NOT_ANSWERED','FAILED','CANCELLED']);
export function AgentTestCallButton({agentId,agentName,disabled=false,className}:{agentId:string;agentName:string;disabled?:boolean;className?:string}){
 const [open,setOpen]=useState(false);
 const {org,user}=useAliyunIdentity();
 return <><button type="button" className={className||'flex items-center gap-1.5 rounded px-2 py-2 text-xs text-primary hover:bg-primary/5 disabled:opacity-50'} disabled={disabled} aria-label={`测试模型：${agentName}`} onClick={e=>{e.stopPropagation();setOpen(true);}}><FlaskConical aria-hidden="true" className="size-3.5"/>测试模型</button>{open&&<TestCallDialog key={`${org}:${user}:${agentId}`} agentId={agentId} agentName={agentName} onClose={()=>setOpen(false)}/>}</>;
}
export function TestCallDialog({agentId,agentName,onClose}:{agentId:string;agentName:string;onClose:()=>void}){
 const {org,user}=useAliyunIdentity();
 const queryClient=useQueryClient();
 const storageKey=`taigua-test-call-v1:${org}:${user}:${agentId}`;
 const [phone,setPhone]=useState(''),[lineId,setLineId]=useState(''),[province,setProvince]=useState('');
 const [request,setRequest]=useState<TestCallInput|null>(null),[status,setStatus]=useState<TestCallStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 const [restoring,setRestoring]=useState(true),[recoveryBlocked,setRecoveryBlocked]=useState(false);
 const identity=useRef({org,user});identity.current={org,user};
 const lines=useQuery({queryKey:['test-call-lines',user,org],queryFn:()=>telephonyApi.lines(org),enabled:!!org&&!!user,retry:false});
 useEffect(()=>{
  let cancelled=false;
  async function restore(){
   try{
    const raw=sessionStorage.getItem(storageKey);
    if(!raw)return;
    const saved=JSON.parse(raw) as TestCallInput;
    if(saved.agentId!==agentId)return;
    // Never render an old cached result as the current test. Check the server
    // first, and only recover a request which may still be in progress.
    try{
     const latest=await telephonyApi.testCallStatus(org,saved.requestId);
     if(cancelled)return;
     if(terminal.has(latest.status)){sessionStorage.removeItem(storageKey);return;}
     queryClient.setQueryData(['test-call-status',user,org,saved.requestId],latest);
     setStatus(latest);setRequest(saved);
    }catch{
     if(cancelled)return;
     setRequest(saved);
     setError('上次测试状态暂时无法确认，正在自动核对，请勿重复拨号。');
    }
   }catch{if(!cancelled){setRecoveryBlocked(true);setError('无法读取上次测试，请先到外呼记录核对，避免重复拨号。');}}
   finally{if(!cancelled)setRestoring(false);}
  }
  void restore();return()=>{cancelled=true;};
 },[storageKey,agentId,org,user,queryClient]);
 const active=useQuery({queryKey:['test-call-status',user,org,request?.requestId],queryFn:()=>telephonyApi.testCallStatus(org,request!.requestId),enabled:!!request&&!!org,retry:false,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:'always',refetchInterval:q=>terminal.has(q.state.data?.status||'')?false:3000});
 useEffect(()=>{if(active.data)setError('');},[active.data]);
 const current=active.data||status;
 const available=lines.data?.lines.filter(line=>line.enabled&&line.liveEnabled)||[];
 const selected=available.find(line=>line.id===lineId);
 const provinces=selected?.provinces||[];
 const waiting=!!request&&!current;
 async function submit(){
  if(lock.current||restoring||request||recoveryBlocked||!org||!user)return;
  const number=phone.replace(/[\s()-]/g,'').replace(/^(\+86|0086)/,'');
  if(!/^1[3-9]\d{9}$/.test(number)&&!/^0\d{9,11}$/.test(number)){setError('请输入手机号或带区号的座机号码。');return;}
  if(!lineId||!selected){setError('请选择可用线路。');return;}
  lock.current=true;setBusy(true);setError('');
  const owner={org,user};
  const input:TestCallInput={requestId:crypto.randomUUID(),agentId,phoneNumber:number,lineId,...(province?{province}:{}),requestedAt:new Date().toISOString(),confirmation:'拨打测试电话'};
  try{
   // Persist before sending: losing the response must not offer another dial.
   sessionStorage.setItem(storageKey,JSON.stringify(input));setRequest(input);
   const result=await telephonyApi.testCall(org,input);
   if(identity.current.org===owner.org&&identity.current.user===owner.user)setStatus(result);
  }catch(e){
   if(identity.current.org===owner.org&&identity.current.user===owner.user){
    setError(e instanceof Error?e.message:'提交结果待核对，请刷新状态，不要重复拨打。');
    if(e instanceof ApiError&&[400,403,404,409,422].includes(e.status)){
     // Only a completed rejection plus an absent task permits a new request.
     // An unknown transport result retains its id and cannot dial twice.
     try{setStatus(await telephonyApi.testCallStatus(org,input.requestId));}
     catch(check){if(check instanceof ApiError&&check.status===404&&identity.current.org===owner.org&&identity.current.user===owner.user){sessionStorage.removeItem(storageKey);setRequest(null);}}
    }
   }
  }
  finally{lock.current=false;setBusy(false);}
 }
 async function discard(){if(!current||current.taskStatus!=='DRAFT'||busy)return;setBusy(true);try{await telephonyApi.discardTestCall(org,current.id);sessionStorage.removeItem(storageKey);setRequest(null);setStatus(null);setError('');}catch(e){setError(e instanceof Error?e.message:'尚未确认取消，请刷新状态。');}finally{setBusy(false);}}
 function reset(){if(!current||!terminal.has(current.status))return;sessionStorage.removeItem(storageKey);setRequest(null);setStatus(null);setError('');}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>测试模型</DialogTitle><DialogDescription>{agentName} · 使用本账号已保存的话术和声音</DialogDescription></DialogHeader>
 <div className="space-y-4">
 {restoring&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>正在核对上次测试…</p>}
 {!restoring&&!request&&<><label className="grid gap-2 text-sm">接听号码<Input type="tel" autoComplete="tel" autoFocus value={phone} onChange={e=>setPhone(e.target.value)} placeholder="输入你用于接听测试的电话号码"/></label>
 <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm">通话线路<select className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={lineId} onChange={e=>{setLineId(e.target.value);setProvince('');}}><option value="">{lines.isPending?'读取线路…':'选择线路'}</option>{available.map(line=><option key={line.id} value={line.id}>{line.name}</option>)}</select></label><label className="grid gap-2 text-sm">省份<select className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={province} onChange={e=>setProvince(e.target.value)} disabled={!lineId}><option value="">自动匹配</option>{provinces.map(value=><option key={value}>{value}</option>)}</select></label></div>
 {lines.isError&&<p role="alert" className="text-sm text-destructive">线路读取失败，请关闭后重试。</p>}
 {!lines.isPending&&!lines.isError&&!available.length&&<p className="text-sm text-muted-foreground">暂无可用线路，请先完成线路配置。</p>}
 <p className="text-xs leading-5 text-muted-foreground">点击后将真实拨打此号码，最多通话 3 分钟。请接听体验，结束时直接挂断电话。</p></>}
 {request&&<div className="rounded-lg border bg-muted/30 p-4" role="status" aria-live="polite"><p className="flex items-center gap-2 font-medium"><Phone className="size-4"/>{current?(labels[current.status]||'等待电话服务回执'):'正在核对提交结果'}</p>{current?.voiceName&&<p className="mt-2 text-sm text-muted-foreground">声音：{current.voiceName}</p>}{current?.error&&<p className="mt-2 text-sm text-destructive">{callReasonText(current.error,current.diagnostics)}</p>}{waiting&&<p className="mt-2 text-xs text-muted-foreground">尚未确认是否已拨打，请查询状态或查看外呼记录。</p>}</div>}
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 {active.isError&&request&&<p role="alert" className="text-xs text-destructive">{active.error.message} 本页不会自动重拨。</p>}
 </div><DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>关闭</Button>{request?<><Button variant="outline" disabled={active.isFetching} onClick={()=>void active.refetch()}><RefreshCw className="size-3.5"/>刷新状态</Button>{current?.taskStatus==='DRAFT'&&<Button disabled={busy} onClick={()=>void discard()}>取消未拨打测试</Button>}{current&&terminal.has(current.status)&&<Button onClick={reset}>再次测试</Button>}</>:<Button disabled={busy||restoring||recoveryBlocked||!org||!user||!phone.trim()||!selected} onClick={()=>void submit()}>{busy?<Loader2 className="size-4 animate-spin"/>:<Phone className="size-4"/>}拨打测试电话</Button>}</DialogFooter></DialogContent></Dialog>;
}
