/*
 * 中文导读：通话记录的 ExtractedDataPanel 组件，封装该界面的展示与交互。
 */
"use client";

import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { useAnalyzeCall } from '@/src/hooks/queries/calls';
import type { CallLog } from '@/src/lib/api/types';

const labels: Record<string, string> = { summary:'沟通摘要', need:'客户需求', intent:'客户意向', reason:'接管理由', nextAction:'下一步', handoff:'人工接管', customerName:'客户姓名', companyName:'企业名称', phone:'电话号码', name:'姓名', email:'邮箱', budget:'预算', industry:'行业', appointmentTime:'预约时间', interest:'意向', notes:'备注', product:'产品', result:'结果', score:'评估分数', success:'目标完成', goal_achieved:'目标完成' };
const values: Record<string, string> = { AI:'数字员工通话', MANUAL:'人工通话', HAOKEHU_SIP:'好客呼线路', HAOKEHU_CALLBACK:'好客呼人工回拨', ALIYUN_ENGINE:'阿里云线路', ALIYUN:'阿里云线路', ALIYUN_AICCS:'阿里云线路', INTERESTED:'有意向', FOLLOW_UP:'待跟进', NO_NEED:'暂无需求', OPT_OUT:'拒绝再次联系', UNKNOWN:'尚不明确', interested:'有意向', declined:'已拒绝', follow_up:'待跟进', neutral:'未明确意向', ANSWERING_MACHINE:'语音助手接听，已自动挂断',UNALLOCATED_NUMBER:'线路返回号码不可达',NORMAL_CLEARING:'正常结束', USER_BUSY:'忙线', NO_ANSWER:'未接听', CALL_REJECTED:'呼叫被拒绝，需核对线路诊断', ORIGINATOR_CANCEL:'已取消', ALIYUN_COMPLETED:'通话完成', ALIYUN_NOT_CONNECTED:'未接通', GOOD:'沟通正常', NEEDS_IMPROVEMENT:'建议改进', INSUFFICIENT:'信息不足' };
type Field = { label:string; value:string; description?:string };
const record = (input:unknown):Record<string,unknown> => input && typeof input==='object' && !Array.isArray(input) ? input as Record<string,unknown> : {};
function display(value:unknown):string {
 if(value===null||value===undefined||value==='')return '未提供';
 if(typeof value==='boolean')return value?'是':'否';
 if(Array.isArray(value))return value.filter(v=>typeof v!=='object').map(display).join('、')||'未提供';
 if(typeof value==='object')return '待人工核对';
 return values[String(value)]??String(value);
}
function title(input:unknown,index:number){ const name=typeof input==='string'?input:''; return labels[name]||(/[\p{Script=Han}]/u.test(name)?name:`信息 ${index+1}`); }
function fields(input:unknown):Field[]{
 if(Array.isArray(input))return input.filter(v=>v&&typeof v==='object').map((item,i)=>{const r=record(item);return {label:title(r.name??r.identifier??r.key,i),value:display(r.value??r.result),description:typeof r.description==='string'?r.description:undefined};});
 return Object.entries(record(input)).map(([key,value],i)=>({label:title(key,i),value:display(value)}));
}
function Rows({items}:{items:Field[]}){return <dl className="space-y-4">{items.map((item,i)=><div key={i}><dt className="mb-1 text-xs text-muted-foreground">{item.label}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-6">{item.value}</dd>{item.description&&<p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{item.description}</p>}</div>)}</dl>;}
function recognizedIntent(value:unknown):CallLog['matchedIntent']{return typeof value==='string'&&['interested','unclear','uninterested','optout'].includes(value)?value as NonNullable<CallLog['matchedIntent']>:null;}
function recognizedRules(value:unknown):NonNullable<CallLog['matchedRules']>{return Array.isArray(value)?value.flatMap(item=>{const row=record(item);return typeof row.id==='string'&&typeof row.name==='string'?[{id:row.id,name:row.name,intent:typeof row.intent==='string'?row.intent:undefined,priority:typeof row.priority==='number'?row.priority:undefined}]:[];}):[];}
function evidenceLines(value:unknown):string[]{return typeof value==='string'&&value.trim()?[value]:Array.isArray(value)?value.filter((line):line is string=>typeof line==='string'&&!!line.trim()):[];}

export function ExtractedDataPanel({metadata,data,evaluation,analysis,callId,matchedIntent,provisionalIntent,matchedRules,matchedEvidence}:{metadata:unknown;data:unknown;evaluation:unknown;analysis?:CallLog['analysis'];callId?:string;matchedIntent?:CallLog['matchedIntent'];provisionalIntent?:CallLog['provisionalIntent'];matchedRules?:CallLog['matchedRules'];matchedEvidence?:CallLog['matchedEvidence']}){
 const meta=record(metadata),analyze=useAnalyzeCall();
 const currentMatchedIntent=recognizedIntent(matchedIntent)??recognizedIntent(meta.matchedIntent);
 const currentProvisionalIntent=recognizedIntent(provisionalIntent)??recognizedIntent(meta.provisionalIntent);
 const currentMatchedRules=matchedRules?.length?matchedRules:recognizedRules(meta.matchedRules??meta.provisionalRules);
 const currentMatchedEvidence=matchedEvidence?.length?matchedEvidence:evidenceLines(meta.matchedEvidence??meta.provisionalEvidence);
 const extracted=fields(data);
 const finalIntent=meta.doNotCallRequested===true?'OPT_OUT':meta.finalIntent||extracted.find(item=>item.label==='客户意向')?.value||meta.flowOutcome;
 const metaFields:Field[]=[];
 for(const [key,label] of [['mode','通话方式'],['provider','通信线路'],['toNumber','客户号码'],['fromNumber','主叫号码'],['handoffOwnerName','人工跟进负责人']] as const){if(meta[key]!==undefined&&meta[key]!==null&&meta[key]!=='')metaFields.push({label,value:display(meta[key])});}
 if(finalIntent)metaFields.push({label:'客户意向',value:display(finalIntent)+(meta.intentRecognitionStatus==='provisional'?' · 待核验':'')});
 if(typeof meta.disposition==='string'&&values[meta.disposition])metaFields.push({label:'结束原因',value:values[meta.disposition]});
 if(meta.handoffRequested===true)metaFields.push({label:'人工接管',value:meta.handoffTaskCreated?'已生成跟进任务':'已提出人工需求'});
 if(meta.doNotCallRequested===true)metaFields.push({label:'联系要求',value:'客户拒绝再次联系'});
 const collected=fields(meta.collected).filter(item=>item.value!=='未提供');
 const evaluated=fields(evaluation),busy=analyze.isPending||['QUEUED','RUNNING'].includes(analysis?.status??'');
 const status:Record<string,string>={QUEUED:'等待分析',RUNNING:'分析中',FAILED:'分析失败，可重试',NOT_STARTED:'尚未分析',DISABLED:'通话分析未开启',NO_TRANSCRIPT:'等待通话文字记录',SUCCESS:'已整理'};
 const intentLabels:Record<string,string>={interested:'有意向',unclear:'未明确',uninterested:'无意向',optout:'拒绝联系'};
 return <aside className="min-w-0 space-y-4">
  {(currentMatchedIntent||currentProvisionalIntent||currentMatchedRules.length||currentMatchedEvidence.length)?<section className="rounded-lg border border-primary/20 bg-primary/[0.03] p-5"><header className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">通话中规则命中</h3><span className="text-xs text-muted-foreground">过程记录</span></header>{currentMatchedIntent||currentProvisionalIntent?<div className="flex flex-wrap gap-2"><span className="rounded-md border bg-background px-2.5 py-1.5 text-sm">命中意向：{intentLabels[currentMatchedIntent||currentProvisionalIntent||'']||'未明确'}</span>{currentMatchedIntent&&currentProvisionalIntent&&currentProvisionalIntent!==currentMatchedIntent?<span className="rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">临时判断：{intentLabels[currentProvisionalIntent]||currentProvisionalIntent}</span>:null}</div>:null}{currentMatchedRules.length?<div className="mt-3 flex flex-wrap gap-1.5">{currentMatchedRules.map(rule=><span key={rule.id} className="rounded border bg-background px-2 py-1 text-xs">命中规则：{rule.name}</span>)}</div>:null}{currentMatchedEvidence.length?<div className="mt-3"><p className="text-xs text-muted-foreground">命中原句</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{currentMatchedEvidence.join('；')}</p></div>:null}</section>:null}
  {metaFields.length>0&&<section className="rounded-lg border bg-card p-5"><h3 className="mb-4 text-sm font-semibold">通话信息</h3><Rows items={metaFields}/></section>}
  <section className="rounded-lg border bg-card p-5"><header className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">提取信息</h3>{callId&&analysis?.canGenerate&&analysis.enabled&&<Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-primary" disabled={busy} onClick={()=>analyze.mutate(callId)}>{busy?<Loader2 className="size-3 animate-spin"/>:<Sparkles className="size-3"/>}{busy?'分析中':extracted.length?'更新分析':'生成分析'}</Button>}</header>
   {extracted.length||collected.length?<Rows items={[...extracted,...collected]}/>:<p role="status" className="text-sm text-muted-foreground">{status[analysis?.status??'']??'暂无分析结果'}</p>}
   {analysis&&['QUEUED','RUNNING','FAILED'].includes(analysis.status)&&extracted.length>0&&<p role="status" className="mt-3 text-xs text-muted-foreground">{status[analysis.status]}</p>}
   {analysis?.canGenerate&&!analysis.enabled&&<Link href="/automation?view=company" className="mt-3 inline-block text-sm text-primary hover:underline">开启通话整理</Link>}
  </section>
  <section className="rounded-lg border bg-card p-5"><header className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">通话评估</h3><span className="text-xs text-muted-foreground">{analysis?.evaluatedBy==='TRANSCRIPT'?'文字巡检':analysis?.evaluatedBy==='AI'?'AI 文字评估':''}</span></header>
   {evaluated.length?<Rows items={evaluated}/>:<p className="text-sm text-muted-foreground">{busy?'等待分析完成':'尚未生成评估'}</p>}
  </section>
 </aside>;
}
