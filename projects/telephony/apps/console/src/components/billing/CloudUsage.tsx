/*
 * 中文导读：用量与费用的 CloudUsage 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhoneCall, BrainCircuit, ExternalLink } from 'lucide-react';
import { authClient } from '@/src/lib/auth-client';
import { apiClient,unwrap } from '@/src/lib/api/client';
import { Input } from '@/src/components/ui/input';
import { Button } from '@/src/components/ui/button';
import {CallCostPanel,CostSummary,costMoney} from '@/src/components/calls/CallCosts';
import type {CallCost,CostTotals} from '@/src/lib/api/types';
import Link from 'next/link';
import { PageHeader } from '@/src/components/common/PageHeader';

interface LineUsage {provider:string;name:string;calls:number;completed:number;recordedSeconds:number;digitalCalls:number;manualCalls:number;estimatedCny:number|null;unpricedCalls:number;knownCny:number;billableMinutes:number}
interface ModelUsage {provider:string;providerName:string;modelId:string;name:string;requests:number;totalTokens:number|null;inputTokens:number|null;outputTokens:number|null;missingUsage:number;billingUrl:string|null;estimatedCny:number|null;knownCny:number;pendingRecords:number}
interface Usage {costs:CostTotals;recentCosts:{callId:string;phone:string|null;startTime:string|null;durationSeconds:number|null;cost:CallCost}[];publicKnownCny:number;modelUsage:ModelUsage[];month:string;calls:number;completed:number;recordedSeconds:number;missingDuration:number;summaryRuns:number;updatedAt:string;lines:LineUsage[];models:{id:string;name:string;vendor:string;kind:string}[];summaryModel:string|null}
interface AccountBill {connected:boolean;reason:string;code?:string;month:string;syncedAt?:string;items:{product:string;currency:string;pretaxAmount:number|null;paidAmount:number|null;outstandingAmount:number|null}[]}
const minutes=(seconds:number)=>Math.round(seconds/60*100)/100;
export function CloudUsage(){
 const {data:session}=authClient.useSession(),org=session?.session.activeOrganizationId??'';
 const query=useQuery({queryKey:['cloud-usage',session?.user.id,org],queryFn:()=>unwrap<Usage>(apiClient.get('/billing/cloud-usage',{headers:{'x-workspace-id':org}})),enabled:Boolean(org),staleTime:30000,refetchInterval:60000,refetchOnWindowFocus:true});
 const data=query.data,platformAdmin=session?.user.role?.split(',').includes('admin');
 const [billMonth,setBillMonth]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date()));
 const bill=useQuery({queryKey:['aliyun-account-bill',session?.user.id,org,billMonth],queryFn:()=>unwrap<AccountBill>(apiClient.get('/billing/aliyun-account',{params:{month:billMonth},headers:{'x-workspace-id':org}})),enabled:false,retry:false});
 const money=(value:number|null,currency:string)=>value===null?'—':new Intl.NumberFormat('zh-CN',{style:'currency',currency}).format(value);
 return <div className="space-y-5">
  <PageHeader title="用量与费用" actions={<span className="text-sm text-muted-foreground">{data?.month || '本月'} · 本公司</span>}/>
  {query.isError?<p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">用量加载失败，系统会自动重试。</p>:null}
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
   ['通话次数',data?.calls,'次'],['接通次数',data?.completed,'次'],['通话时长',data?minutes(data.recordedSeconds):undefined,'分钟'],['通话整理',data?.summaryRuns,'次'],
  ].map(([label,value,unit])=><div key={String(label)} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{query.isPending?<span className="inline-block h-8 w-16 animate-pulse rounded bg-muted"/>:value??'—'}<span className="ml-2 text-xs font-normal text-muted-foreground">{unit}</span></p></div>)}</div>
  <CostSummary costs={data?.costs}/>
  {data?.missingDuration?<p className="text-xs text-muted-foreground">{data.missingDuration} 条接通记录正在等待时长回传。</p>:null}
  <section className="overflow-hidden rounded-xl border bg-card"><h2 className="flex items-center gap-2 border-b px-5 py-4 text-sm font-semibold"><PhoneCall className="size-4"/>通信线路用量</h2>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr>{['线路','拨打次数','接通次数','计费分钟','电话费（估算）'].map(h=><th key={h} className="whitespace-nowrap px-5 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{data?.lines.map(line=><tr key={line.provider} className="border-b last:border-0"><td className="px-5 py-4 font-medium">{line.name}</td><td className="px-5 py-4 tabular-nums">{line.calls}</td><td className="px-5 py-4 tabular-nums">{line.completed}</td><td className="px-5 py-4 tabular-nums">{line.billableMinutes}</td><td className="px-5 py-4 text-xs text-muted-foreground">{costMoney(line.estimatedCny)}{line.unpricedCalls>0&&<span className="block">已知 {costMoney(line.knownCny)} · {line.unpricedCalls} 通待核算</span>}</td></tr>)}</tbody></table></div>
  </section>
  <section className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><BrainCircuit className="size-4"/>模型服务</h2><span className="text-xs text-muted-foreground">本月系统记录 · 每分钟更新</span></div>
   <div className="mt-4 flex flex-wrap gap-2">{data?.models.map(m=><span key={m.id} className="rounded-md bg-muted/40 px-3 py-2 text-xs">{m.name}</span>)}{data&&!data.models.length&&<span className="text-sm text-muted-foreground">尚未授权模型</span>}</div>
   <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{['平台 / 模型','请求次数','输入 Token','输出 Token','总 Token','模型费（估算）','账单'].map(h=><th key={h} className="whitespace-nowrap py-3 pr-4 font-medium">{h}</th>)}</tr></thead><tbody>{data?.modelUsage.map(row=><tr key={row.provider+row.modelId} className="border-b"><td className="py-3 pr-4"><span className="block font-medium">{row.providerName}</span><span className="text-xs text-muted-foreground">{row.name}</span></td><td className="pr-4">{row.requests}</td>{[row.inputTokens,row.outputTokens,row.totalTokens].map((n,i)=><td key={i} className="pr-4 tabular-nums">{n===null?'未返回':n.toLocaleString('zh-CN')}</td>)}<td className="pr-4 tabular-nums">{costMoney(row.estimatedCny)}{row.pendingRecords>0&&<span className="mt-1 block text-xs text-muted-foreground">已知 {costMoney(row.knownCny)}</span>}</td><td className="py-3 text-xs">{row.billingUrl&&<a href={row.billingUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">查看平台账单</a>}{row.missingUsage>0&&<span className="mt-1 block text-muted-foreground">{row.missingUsage} 次未返回完整用量</span>}</td></tr>)}</tbody></table>{data&&!data.modelUsage.length&&<p className="py-4 text-sm text-muted-foreground">本月暂无模型调用记录。</p>}</div>
   <p className="mt-3 text-xs leading-5 text-muted-foreground">电话费按每通电话的历史单价与整分钟核算；模型费按实际记录用量和当前公开单价估算。待核算部分不计作零，实扣以供应商账单为准。</p>
   {data?.summaryModel&&<p className="mt-3 text-xs text-muted-foreground">通话整理模型：{data.summaryModel}</p>}
  </section>
  <section className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-sm font-semibold">最近通话费用</h2><Link href="/calls" className="text-sm text-primary hover:underline">全部通话</Link></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr>{['时间 / 号码','计费分钟','电话费','AI 费用','总成本','明细'].map(h=><th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{data?.recentCosts.map(c=><tr key={c.callId} className="border-b last:border-0"><td className="px-4 py-3"><span className="block">{c.phone||'—'}</span><span className="mt-1 block text-xs text-muted-foreground">{c.startTime?new Date(c.startTime).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—'}</span></td><td className="px-4 py-3 tabular-nums">{c.cost.billableMinutes??'待回传'}</td><td className="px-4 py-3 tabular-nums">{costMoney(c.cost.phoneCny)}</td><td className="px-4 py-3 tabular-nums">{costMoney(c.cost.aiCny)}</td><td className="px-4 py-3 tabular-nums">{costMoney(c.cost.totalCny)}</td><td className="px-4 py-3"><details><summary className="cursor-pointer text-primary">费用明细</summary><div className="mt-3 min-w-72"><CallCostPanel cost={c.cost}/></div></details></td></tr>)}</tbody></table>{data&&!data.recentCosts.length&&<p className="p-4 text-sm text-muted-foreground">本月暂无通话。</p>}</div></section>
  {platformAdmin&&<details className="rounded-xl border bg-card"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold">阿里云账户账单</summary><div className="space-y-4 border-t p-5">
   <p className="text-xs text-muted-foreground">云账户总账单，包含服务器等资源；未分摊到各公司。</p>
   <div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-sm">账期<Input type="month" value={billMonth} onChange={e=>setBillMonth(e.target.value)} className="w-44"/></label><Button size="sm" variant="outline" disabled={bill.isFetching||!org||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(billMonth)} onClick={()=>bill.refetch()}>{bill.isFetching?'查询中…':'查询账单'}</Button><Button size="sm" asChild variant="ghost"><a href="https://usercenter2.aliyun.com/finance/bill/detail" target="_blank" rel="noopener noreferrer">查看原始账单<ExternalLink className="size-3.5"/></a></Button></div>
   {bill.isError?<p role="alert" className="text-sm text-destructive">账单查询失败，请重试。</p>:null}
   {bill.data&&!bill.data.connected?<p role="status" className="text-sm text-muted-foreground">{bill.data.reason}</p>:null}
   {bill.data?.connected?<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left">{['云产品','税前应付','已支付','未结清'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{bill.data.items.map((item,i)=><tr key={i} className="border-b"><td className="p-3">{item.product}</td><td className="p-3">{money(item.pretaxAmount,item.currency)}</td><td className="p-3">{money(item.paidAmount,item.currency)}</td><td className="p-3">{money(item.outstandingAmount,item.currency)}</td></tr>)}</tbody></table>{!bill.data.items.length?<p className="py-4 text-sm text-muted-foreground">本账期暂无账单。</p>:null}</div>:null}
  </div></details>}
 </div>;
}
