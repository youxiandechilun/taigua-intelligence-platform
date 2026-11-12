/*
 * 中文导读：单通电话费用及待核算状态的展示。
 */
import type {CallCost,CostTotals} from '@/src/lib/api/types';

export const costMoney=(value:number|null|undefined)=>value===null||value===undefined?'待核算':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<0.01?6:4}).format(value);

export function CallCostCell({cost,onOpen}:{cost?:CallCost;onOpen:()=>void}){
 return <button type="button" onClick={onOpen} aria-label="查看本通费用明细" className="call-cost-cell text-left tabular-nums hover:text-primary focus-visible:outline-ring" title={cost?.reasons.join('；')||'费用估算，点击查看明细'}><span className="block text-sm font-medium">{costMoney(cost?.totalCny)}</span><span className="mt-2 block whitespace-nowrap text-xs text-muted-foreground">电话 {costMoney(cost?.phoneCny)} · AI {costMoney(cost?.aiCny)}</span></button>;
}

export function CallCostPanel({cost}:{cost?:CallCost}){
 if(!cost)return <p className="text-sm text-muted-foreground">费用正在核算。</p>;
 return <section aria-label="本通费用明细" className="rounded-lg border bg-card p-4"><h3 className="text-sm font-semibold">本通费用 <span className="ml-2 font-normal text-muted-foreground">估算</span></h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">电话费</dt><dd className="mt-1 font-medium tabular-nums">{costMoney(cost.phoneCny)}</dd></div><div><dt className="text-muted-foreground">AI 费用</dt><dd className="mt-1 font-medium tabular-nums">{costMoney(cost.aiCny)}</dd></div><div><dt className="text-muted-foreground">总成本</dt><dd className="mt-1 font-semibold tabular-nums">{costMoney(cost.totalCny)}</dd></div><div><dt className="text-muted-foreground">已知小计</dt><dd className="mt-1 tabular-nums">{costMoney(cost.knownCny)}</dd></div></dl><p className="mt-3 text-xs leading-5 text-muted-foreground">{cost.lineName} · {cost.billableMinutes===null?'时长待回传':`${cost.billableMinutes} 计费分钟`}{cost.tariffCny===null?' · 单价待核对':` × ${costMoney(cost.tariffCny)}/分钟`}</p>{cost.items.length>0&&<ul className="mt-3 divide-y border-t">{cost.items.map((item,i)=><li key={`${item.purpose}:${item.model}:${i}`} className="flex justify-between gap-3 py-2 text-xs"><div><span>{item.name}</span><span className="mt-1 block text-muted-foreground">{item.model}</span></div><span className="shrink-0 tabular-nums" title={item.reason||item.priceVersion||undefined}>{costMoney(item.amountCny)}</span></li>)}</ul>}{cost.reasons.length>0&&<p className="mt-2 text-xs leading-5 text-muted-foreground">{cost.reasons.join('；')}。已知小计不代表完整成本。</p>}<p className="mt-2 text-xs leading-5 text-muted-foreground">电话费逐通按分钟进位；模型费按记录用量与公开单价估算，实扣以供应商账单为准。</p></section>;
}

export function CostSummary({costs}:{costs?:CostTotals}){
 return <section aria-label="通话成本" className="grid gap-3 sm:grid-cols-3">{[
  {label:'电话费',value:costs?.phoneCny,known:costs?.knownPhoneCny,pending:costs?.pendingPhoneCalls},
  {label:'AI 费用',value:costs?.aiCny,known:costs?.knownAiCny,pending:costs?.pendingAiCalls},
  {label:'总成本',value:costs?.totalCny,known:costs?.knownCny,pending:costs?.pendingCalls},
 ].map(item=><div key={item.label} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{item.label}<span className="ml-2 text-xs">估算</span></p><p className="mt-3 text-xl font-semibold tabular-nums">{costs?costMoney(item.value):'—'}</p><p className="mt-2 text-xs text-muted-foreground">{item.pending?`已知 ${costMoney(item.known)} · ${item.pending.toLocaleString('zh-CN')} 通待核算`:costs?`${costs.billableMinutes.toLocaleString('zh-CN')} 计费分钟`:'正在读取'}</p></div>)}</section>;
}
