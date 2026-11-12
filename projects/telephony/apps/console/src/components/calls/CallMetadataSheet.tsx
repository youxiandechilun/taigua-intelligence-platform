/*
 * 中文导读：通话记录的 CallMetadataSheet 组件，封装该界面的展示与交互。
 */
"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/src/components/ui/sheet';
import { ExtractedDataPanel } from './ExtractedDataPanel';
import { useCall } from '@/src/hooks/queries/calls';
import { uiLabel } from '@/src/lib/locale';
import type { CallLog } from '@/src/lib/api/types';
import { CallFailureDetails } from './CallFailureDetails';

export function CallMetadataSheet({call,onClose}:{call:CallLog|null;onClose:()=>void}){
 const detail=useCall(call?.callId??''),current=detail.data??call;
 return <Sheet open={!!call} onOpenChange={open=>{if(!open)onClose();}}><SheetContent side="right" className="flex !w-full flex-col gap-0 overflow-hidden p-0 sm:!max-w-lg"><SheetHeader className="border-b p-5"><SheetTitle>通话详情</SheetTitle><SheetDescription>{current?.startTime?new Date(current.startTime).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'通话信息'}</SheetDescription></SheetHeader><div className="min-w-0 flex-1 space-y-4 overflow-auto p-5">
  {current&&<><dl className="grid grid-cols-2 gap-4 rounded-lg border p-4">{[['客户号码',current.callerId??'未知'],['通话状态',uiLabel(current.status)],['通话类型',current.direction?.toLowerCase()==='outbound'?'呼出':current.direction?.toLowerCase()==='inbound'?'呼入':'未提供'],['通话时长',`${current.durationSeconds??0} 秒`]].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>
  {detail.isError&&<p role="alert" className="text-sm text-destructive">分析结果加载失败，请重试。</p>}
  <ExtractedDataPanel callId={current.callId} metadata={current.metadata} data={current.dataExtracted} evaluation={current.dataEvaluation} analysis={current.analysis}/></>}
  {current && <CallFailureDetails metadata={current.metadata} status={current.status} />}
 </div></SheetContent></Sheet>;
}
