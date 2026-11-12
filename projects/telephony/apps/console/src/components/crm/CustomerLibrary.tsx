/*
 * 中文导读：客户资料库界面。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw, LockKeyhole, ChevronLeft, ChevronRight, Users, UserRound, ContactRound, ArrowUpRight, Loader2, Check, Circle } from "lucide-react";
import { useCustomerReadState, useFollowupIdentity } from "@/src/hooks/use-customer-followup";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { followupRequest, followupDate, intentLabels, wechatLabels, isTemporaryCustomer, type CustomerSnapshot } from "@/src/lib/customer-followup";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

import { CustomerReadBadge } from "./CustomerReadBadge";
import { toast } from "@/src/lib/toast";

const CustomerSheet = dynamic(() => import("./CustomerFollowupSheet"), { ssr: false });


function IntentCustomers() {
  const { workspace, user } = useFollowupIdentity();
  const company = useCompanyContext();
  const reading = useCustomerReadState();
  const location = useSearchParams(), router = useRouter(), pathname = usePathname();
  const scope = location.get('scope') === 'all' ? 'all' : 'mine';
  const requestedReadState = location.get('readState') || '';
  const readState = ['read', 'unread'].includes(requestedReadState) ? requestedReadState : '';
  const requestedIntent = location.get('intent') || '';
  const intent = ['interested','unclear','uninterested','optout'].includes(requestedIntent) ? requestedIntent : '';
  function updateFilter(key: string, value: string) { const next = new URLSearchParams(location.toString()); if (value) next.set(key, value); else next.delete(key); router.replace(`${pathname}?${next}`, {scroll:false}); setPage(1); }
  const setScope = (value: string) => updateFilter('scope', value), setIntent = (value: string) => updateFilter('intent', value);
  const stage = location.get('stage') || '', addedOnly = location.get('wechatAdded') === 'true';
  function setStage(value: string) {
    const next = new URLSearchParams(location.toString());next.delete('stage');next.delete('wechatAdded');
    if (value === 'added-any') next.set('wechatAdded','true');else if(value) next.set('stage',value);
    router.replace(`${pathname}?${next}`,{scroll:false});setPage(1);
  }
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [detail, setDetail] = useState<string | null>(null);
  const params = new URLSearchParams({ scope, q: search.trim(), stage, intent, wechatAdded: String(addedOnly), readState, page: String(page) });
  const query = useQuery({ queryKey: ["customer-followup", workspace, user, "customers", params.toString()], queryFn: () => followupRequest<CustomerSnapshot>(workspace, `?${params}`), enabled: !!workspace && !!user, retry: false, refetchInterval: 15000, staleTime: 10000 });
  const data = query.data, counts = data?.counts;
  const selectClass = "h-8 px-2 text-xs";
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">客户库</h1>
      <dl aria-label="客户统计" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        {[{ label: "意向客户", value: counts?.interested }, { label: "待加微信", value: counts?.pending }, { label: "已加微信", value: counts?.added }, { label: "已发直播链接", value: counts?.sent }].map(item => <div key={item.label} className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">{item.label}</dt><dd className="text-sm font-semibold tabular-nums">{item.value ?? "—"}</dd></div>)}
      </dl>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-1" role="group" aria-label="客户范围">
        {([{ value: "mine", label: "我的客户", Icon: UserRound }, { value: "all", label: "全部客户", Icon: Users }] as const).map(tab => <Button key={tab.value} size="sm" variant={scope === tab.value ? "secondary" : "ghost"} className={`h-8 px-2 text-xs ${scope === tab.value ? "border-primary/15 bg-primary/5 text-primary" : "text-muted-foreground"}`} aria-pressed={scope === tab.value} onClick={() => { setScope(tab.value); setPage(1); }}><tab.Icon aria-hidden="true" className="size-3.5" />{tab.label}</Button>)}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <NativeSelect aria-label="筛选客户阅读状态" className={`${selectClass} w-24`} value={readState} onChange={e => updateFilter("readState", e.target.value)}><option value="">全部阅读</option><option value="unread">未读</option><option value="read">已读</option></NativeSelect>
        <NativeSelect aria-label="筛选客户意向" className={`${selectClass} w-24`} value={intent} onChange={e => { setIntent(e.target.value); setPage(1); }}><option value="">全部意向</option>{Object.entries(intentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect>
        <NativeSelect aria-label="筛选微信进度" className={`${selectClass} w-36`} value={addedOnly ? 'added-any' : stage} onChange={e => { setStage(e.target.value); setPage(1); }}><option value="">全部微信进度</option><option value="added-any">已加微信（含后续进度）</option>{Object.entries(wechatLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect>
        <div className="relative min-w-0 flex-1 sm:flex-none"><Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索意向客户" className="h-8 w-full min-w-36 pl-8 text-xs md:text-xs sm:w-52" placeholder="搜索号码、姓名或负责人" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      </div>
    </div>
    {query.isPending ? <div role="status" className="flex items-center justify-center gap-2 py-14 text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取通话意向…</div> : query.isError ? <div role="alert" className="space-y-3 rounded-md border p-6"><p>{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新读取</Button></div> : !data?.rows.length ? <div className="flex flex-col items-center gap-3 rounded-lg border py-14"><Users className="size-8 text-muted-foreground/50" /><p className="font-medium">{search || stage || intent || addedOnly || readState ? "没有符合条件的客户" : scope === "mine" ? "暂无归属于你的意向客户" : "暂无自动识别的意向客户"}</p><Link href="/calls" className="inline-flex items-center gap-1 text-sm text-primary">查看通话意向<ArrowUpRight className="size-3.5" /></Link></div> : <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[920px]"><TableHeader><TableRow className="bg-muted/20"><TableHead className="pl-4">客户号码</TableHead><TableHead>阅读状态</TableHead><TableHead>客户意向</TableHead><TableHead>微信进度</TableHead><TableHead>负责人</TableHead><TableHead>通话</TableHead><TableHead>更新于</TableHead><TableHead className="pr-4 text-right">操作</TableHead></TableRow></TableHeader><TableBody>{data.rows.map(row => {
      const temporary = isTemporaryCustomer(row);
      return <TableRow key={row.id} className={row.readOnly ? "" : "cursor-pointer hover:bg-primary/[.025]"} onClick={() => { if (!row.readOnly) setDetail(row.id); }}><TableCell className="pl-4"><div className="flex items-center gap-2"><span className="font-medium tabular-nums">{row.phone}</span>{row.readOnly && <LockKeyhole className="size-3 text-muted-foreground" aria-label="他人客户号码已脱敏" />}</div><span className="text-xs text-muted-foreground">{row.name || "姓名待补充"}</span></TableCell><TableCell><CustomerReadBadge readAt={row.readAt} /></TableCell><TableCell><span title={temporary ? "通话中命中关键词，待确认" : undefined} className={row.intent === "interested" ? "rounded-md bg-primary/5 px-2 py-1 text-xs text-primary" : "text-sm text-muted-foreground"}>{temporary ? "通话中待确认" : intentLabels[row.intent]}</span></TableCell><TableCell className="text-sm">{temporary ? "通话中" : wechatLabels[row.stage]}</TableCell><TableCell>{row.ownerName}</TableCell><TableCell className="tabular-nums">{row.callCount}次</TableCell><TableCell className="text-muted-foreground">{followupDate(row.updatedAt)}</TableCell><TableCell className="pr-4 text-right">{row.readOnly ? <span className="text-xs text-muted-foreground">仅概况</span> : <div className="flex items-center justify-end gap-1"><Button size="sm" variant="outline" className="h-7 border-primary/20 px-2 text-xs text-primary hover:bg-primary/5 hover:text-primary" onClick={event => { event.stopPropagation(); setDetail(row.id); }}><ContactRound aria-hidden="true" className="size-3.5" />查看资料</Button><Button size="icon-sm" variant="ghost" className="size-7" aria-label={`${row.readAt ? "标为未读" : "标为已读"}：${row.phone}`} title={row.readAt ? "标为未读" : "标为已读"} disabled={reading.isPending || row.readAt === undefined} onClick={event => { event.stopPropagation(); reading.mutate({ customerId: row.id, read: !row.readAt, revision: row.readRevision }, { onError: error => toast.error(error.message) }); }}>{row.readAt ? <Circle aria-hidden="true" className="size-3.5" /> : <Check aria-hidden="true" className="size-3.5" />}</Button></div>}</TableCell></TableRow>;
    })}</TableBody></Table></div>}
    {data && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>共{data.total}位客户{data.partial ? " · 已读取最近1000条通话" : ""}</span><div className="flex items-center gap-2"><span>第{data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}页</span><Button size="icon-sm" variant="outline" className="size-7" aria-label="上一页客户" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft className="size-4" /></Button><Button size="icon-sm" variant="outline" className="size-7" aria-label="下一页客户" disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}><ChevronRight className="size-4" /></Button></div></div>}
    {data?.syncWarning && <p role="status" className="text-sm text-muted-foreground">{data.syncWarning}</p>}
    {detail && <CustomerSheet key={`${workspace}:${user}:${detail}`} customerId={detail} onClose={() => setDetail(null)} staff={data?.staff} canAssign={data?.canAssign || (company.data?.allData && company.data.canAssignCustomers)} />}
  </div>;
}

export function CustomerLibrary() {
  const { workspace, user } = useFollowupIdentity();
  return <Suspense fallback={<p role="status" className="py-10 text-center text-sm text-muted-foreground">正在读取客户库…</p>}><IntentCustomers key={`${workspace}:${user}`} /></Suspense>;
}
