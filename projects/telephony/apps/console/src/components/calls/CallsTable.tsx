/*
 * 中文导读：通话记录表格：展示号码、状态、意向、费用及行操作。
 */
"use client";

import { normalizeCallDirection, callDirectionLabel } from "@/src/lib/call-direction";

import { CallCostCell } from "./CallCosts";
import { CallIntentControl } from "./CallIntentControl";
import { useFollowupCallStates } from "@/src/hooks/use-customer-followup";
import { uiLabel } from "@/src/lib/locale";

import { useState, useEffect, type ReactNode } from "react";
import {
  Loader2,
  MoreHorizontal,
  FileText,
  Check,
  Circle,
  Trash2,
  Columns3,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { PhoneCall } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import { CallDetailsSheet } from './CallDetailsSheet';
import { CallReadBadge } from './CallReadBadge';
import { CallFailureCode } from './CallFailureDetails';
import { callFailure } from '@/src/lib/api/call-diagnostics';
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useAgents } from "@/src/hooks/queries/agents";
import { useCalls, useDeleteCall, useSetCallReadState } from "@/src/hooks/queries/calls";
import { authClient } from '@/src/lib/auth-client';
import type { CallListParams } from "@/src/lib/api/resources/calls";
import type { CallLog, CallStatus } from "@/src/lib/api/types";
import { downloadRowsAsExcel } from "@/src/lib/export-excel";

// ── formatters ────────────────────────────────────────────────────────────────

function fmtStartTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDuration(s: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CallStatus }) {
  if (status === "NEEDS_REVIEW") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-xs text-amber-600 dark:text-amber-400">
        {uiLabel(status)}
      </Badge>
    );
  }
  if (status === "COMPLETED") {
    return (
      <span className="inline-flex items-center rounded-sm border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-400">
        已完成
      </span>
    );
  }
  if (status === "FAILED" || status === "NOT_ANSWERED") {
    return (
      <Badge variant="destructive" className="text-xs uppercase">
        {uiLabel(status)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs uppercase">
      {uiLabel(status)}
    </Badge>
  );
}

function DirectionCell({ direction: rawDirection }: { direction: string | null }) {
  const direction = normalizeCallDirection(rawDirection);
  if (direction === "outbound") {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-sm border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-400">
          呼出
        </span>
      </div>
    );
  }
  if (direction === "inbound") {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
          呼入
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

// ── column definitions ────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "startTime", label: "开始时间" },
  { key: "owner",     label: "所属员工" },
  { key: "number",    label: "电话号码" },
  { key: "agent",     label: "数字员工" },
  { key: "duration",  label: "通话时长" },
  { key: "direction", label: "通话类型" },
  { key: "status",    label: "状态" },
  { key: "readState", label: "阅读状态" },
  { key: "intent",    label: "客户意向" },
  { key: "cost", label: "费用" },
] as const;

type ColKey = (typeof COLUMNS)[number]["key"];

// ── main component ────────────────────────────────────────────────────────────

export function CallsTable({
  filters,
  renderHeader,
}: {
  renderHeader?: (actions: ReactNode) => ReactNode;
  filters: Omit<CallListParams, "cursor" | "limit">;
}) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const { data: agents } = useAgents();
  const del = useDeleteCall();
  const readState = useSetCallReadState();
  const { data: session } = authClient.useSession();
  const viewerKey = `${session?.user.id ?? ''}:${session?.session.activeOrganizationId ?? ''}`;

  // Seed pageIdx from URL ?page= (1-based → 0-based)
  const urlPage = Math.max(1, Number(searchParams.get("page") ?? 1));
  const [pageIdx, setPageIdx] = useState(urlPage - 1);
  const [pageSize, setPageSize] = useState(20);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    new Set(COLUMNS.map((c) => c.key))
  );
  const [detailSelection, setDetailSelection] = useState<{ call: CallLog; viewerKey: string } | null>(null);
  const [deleteTarget, setDeleteTarget]     = useState<CallLog | null>(null);

  const query = useCalls(filters, pageSize);
  const followup = useFollowupCallStates((query.data?.pages[pageIdx]?.data ?? []).map(call => call.callId));
  const intentById = new Map(followup.data?.rows.map(row => [row.id, row]));

  // Reflect pageIdx in URL without adding browser-history entries
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (pageIdx === 0) {
      params.delete("page");
    } else {
      params.set("page", String(pageIdx + 1));
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pageIdx]); // eslint-disable-line

  // Reset to first page when filters or page size change
  useEffect(() => { setPageIdx(0); }, [JSON.stringify(filters), pageSize]); // eslint-disable-line

  // Auto-fetch intermediate pages when landing on a deep URL (e.g. ?page=3)
  useEffect(() => {
    if (pageIdx >= (query.data?.pages.length ?? 0) && query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [pageIdx, query.data?.pages.length, query.hasNextPage, query.isFetchingNextPage]); // eslint-disable-line

  const pages      = query.data?.pages ?? [];
  const calls: CallLog[] = pages[pageIdx]?.data ?? [];
  const totalFetchedPages = pages.length;
  const hasNextRemote     = query.hasNextPage;
  const isLastFetched     = pageIdx === totalFetchedPages - 1;
  const hasNext           = !isLastFetched || hasNextRemote;
  const hasPrev           = pageIdx > 0;
  const displayPage       = pageIdx + 1; // 1-based for display

  const agentName = (id: string | null) =>
    agents?.find((a) => a.agentId === id)?.name ?? "—";

  function exportCalls() {
    downloadRowsAsExcel("通话记录.xlsx", calls, [
      { header: "开始时间", value: (call) => call.startTime ?? "" },
      { header: "所属员工", value: (call) => call.ownerName || "—" },
      { header: "电话号码", value: (call) => call.callerId ?? "" },
      { header: "数字员工", value: (call) => agentName(call.agentId) },
      { header: "时长（秒）", value: (call) => call.durationSeconds ?? "" },
      { header: "通话类型", value: (call) => call.metadata?.demoCall===true?"演示电话":callDirectionLabel(call.direction) },
      { header: "状态", value: (call) => call.status },
      { header: "SIP 返回码", value: call => { const failure = callFailure(call.metadata, call.status); return failure ? failure.diagnostics?.sipStatus ?? '未记录' : ''; } },
      { header: "系统原因代码", value: call => { const failure = callFailure(call.metadata, call.status); return failure ? failure.reason || '未记录' : ''; } },
      { header: "结束说明", value: call => callFailure(call.metadata, call.status)?.message || '' },
      { header: "阅读状态", value: (call) => call.readAt === undefined ? '未提供' : call.readAt ? '已读' : '未读' },
      { header: "客户意向", value: (call) => { const result = intentById.get(call.callId); return result ? ({ interested: "有意向", unclear: "待确认", uninterested: "无意向", optout: "拒绝联系" })[result.intent] : "待确认"; } },
      { header: "微信进度", value: call => { const stage=intentById.get(call.callId)?.stage; return stage ? ({pending:"待加微信",requested:"申请已发送",added:"已加微信",sent:"已发直播链接",deferred:"暂缓联系",failed:"添加失败",closed:"已停止联系"})[stage] : "—"; } },
      { header: "电话费（估算元）", value: call => call.cost?.phoneCny ?? "待核算" },
      { header: "AI费用（估算元）", value: call => call.cost?.aiCny ?? "待核算" },
      { header: "总成本（估算元）", value: call => call.cost?.totalCny ?? "待核算" },
      { header: "已知小计（元）", value: call => call.cost?.knownCny ?? "待核算" },
      { header: "计费分钟", value: call => call.cost?.billableMinutes ?? "待核算" },
      { header: "通话编号", value: (call) => call.callId },
    ]);
  }

  const toggleCol = (key: ColKey) =>
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  async function goNext() {
    if (!isLastFetched) {
      setPageIdx((i) => i + 1);
    } else if (hasNextRemote) {
      await query.fetchNextPage();
      setPageIdx((i) => i + 1);
    }
  }
  function goPrev() {
    setPageIdx((i) => Math.max(0, i - 1));
  }

  async function confirmDelete() {
    try {
      if (!deleteTarget) return;
      await del.mutateAsync(deleteTarget.callId);
      setDeleteTarget(null);
    } catch {
      // The mutation hook displays the API error; preserve the current state for retry.
    }
  }

  const actions = (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="导出 Excel 表格"
            title="导出 Excel 表格"
            onClick={exportCalls}
            disabled={calls.length === 0}
          >
            <Download aria-hidden="true" className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="设置显示列" title={`显示列 ${visibleCols.size} / ${COLUMNS.length}`}>
                <Columns3 aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                选择显示列
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleCols.has(col.key)}
                  disabled={visibleCols.has(col.key) && visibleCols.size === 1}
                  onSelect={event => event.preventDefault()}
                  onCheckedChange={() => toggleCol(col.key)}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

  );
  const header = renderHeader ? renderHeader(actions) : actions;

  if (query.isLoading) {
    return (
      <>{header}<div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div></>
    );
  }

  if (query.isError) {
    return (
      <>{header}<EmptyState
        icon={PhoneCall}
        title="无法加载通话"
        description="请刷新通话列表，或检查网络连接后重试。"
        action={
          <Button
            variant="outline"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <Loader2 className={query.isFetching ? "animate-spin" : undefined} />
            重试
          </Button>
        }
      /></>
    );
  }

  if (!calls.length && pageIdx === 0) {
    return (
      <>{header}<EmptyState
        icon={PhoneCall}
        title="没有符合筛选条件的通话"
        description="尝试扩大日期范围，或移除筛选条件。"
      /></>
    );
  }

  return (
    <>
      {header}
      <div className="space-y-3">

        <div className="space-y-3 md:hidden">
          {calls.map((c) => (
            <div
              key={c.callId}
              className="border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left font-medium hover:underline focus-visible:outline-ring" onClick={() => setDetailSelection({ call: c, viewerKey })}>{c.callerId ?? "未知号码"}</button>
                  <p className="text-xs text-muted-foreground">{fmtStartTime(c.startTime)}</p>
                  <CallReadBadge readAt={c.readAt} />
                </div>
                <div className="space-y-1"><StatusBadge status={c.status} /><CallFailureCode metadata={c.metadata} status={c.status} /></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">所属员工</p>
                  <p className="truncate" title={c.ownerName}>{c.ownerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">数字员工</p>
                  <p className="truncate">{agentName(c.agentId)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">时长</p>
                  <p>{fmtDuration(c.durationSeconds)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">通话类型</p>
                  <div className="mt-1">{c.metadata?.demoCall===true?<Badge variant="outline">演示电话</Badge>:<DirectionCell direction={c.direction} />}</div>
                </div>
              </div>
              <div className="mt-3">{c.metadata?.demoCall===true?<span className="text-xs text-muted-foreground">演示不分析意向</span>:<CallIntentControl callId={c.callId} state={intentById.get(c.callId)} unavailable={followup.isError} loading={followup.isLoading} />}</div>
              {visibleCols.has("cost")&&<div className="mt-3"><CallCostCell cost={c.cost} onOpen={()=>setDetailSelection({call:c,viewerKey})}/></div>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetailSelection({ call: c, viewerKey })}>
                  <FileText aria-hidden="true" className="size-4" /> 查看详情
                </Button>
                <Button variant="outline" size="sm" disabled={readState.isPending || c.readAt === undefined} onClick={() => readState.mutate({ callId: c.callId, organizationId: c.organizationId, read: !c.readAt })}>
                  {c.readAt ? <Circle aria-hidden="true" className="size-4" /> : <Check aria-hidden="true" className="size-4" />}{c.readAt ? '标为未读' : '标为已读'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="size-4" /> 删除
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* ── table ── */}
        <div className="calls-compact-table hidden overflow-x-auto border bg-card md:block">
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow className="border-b bg-muted/20 hover:bg-muted/20">
                {(visibleCols.has("startTime")||visibleCols.has("direction"))&&<TableHead className="pl-4 whitespace-nowrap">时间 / 类型</TableHead>}
                {(visibleCols.has("number")||visibleCols.has("readState"))&&<TableHead className="whitespace-nowrap">号码 / 阅读</TableHead>}
                {(visibleCols.has("owner")||visibleCols.has("agent"))&&<TableHead className="whitespace-nowrap">员工 / 数字员工</TableHead>}
                {(visibleCols.has("status")||visibleCols.has("duration"))&&<TableHead className="whitespace-nowrap">状态 / 时长</TableHead>}
                {visibleCols.has("intent")&&<TableHead className="whitespace-nowrap">客户意向 / 微信进度</TableHead>}
                {visibleCols.has("cost")&&<TableHead className="whitespace-nowrap">总成本 / 电话 · AI</TableHead>}
                <TableHead className="w-16 pr-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((c) => (
                <TableRow
                  key={c.callId}
                  className="border-b transition-colors hover:bg-muted/10"
                >
                  {(visibleCols.has("startTime")||visibleCols.has("direction"))&&<TableCell className="pl-4 text-sm"><div className="calls-cell-stack">
                    {visibleCols.has("startTime")&&<span className="whitespace-nowrap">{fmtStartTime(c.startTime)}</span>}
                    {visibleCols.has("direction")&&(c.metadata?.demoCall===true?<Badge variant="outline">演示电话</Badge>:<DirectionCell direction={c.direction}/>)}
                  </div></TableCell>}
                  {(visibleCols.has("number")||visibleCols.has("readState"))&&<TableCell><div className="calls-cell-stack">
                    {visibleCols.has("number")&&<button type="button" className="text-left font-medium hover:underline focus-visible:outline-ring" aria-label={`查看 ${c.callerId ?? '未知号码'} 的通话详情`} onClick={()=>setDetailSelection({call:c,viewerKey})}>{c.callerId??'—'}</button>}
                    {visibleCols.has("readState")&&<CallReadBadge readAt={c.readAt}/>}
                  </div></TableCell>}
                  {(visibleCols.has("owner")||visibleCols.has("agent"))&&<TableCell className="max-w-[180px]"><div className="calls-cell-stack">
                    {visibleCols.has("owner")&&<span className="block max-w-full truncate" title={c.ownerName}>{c.ownerName||'—'}</span>}
                    {visibleCols.has("agent")&&<span className="block max-w-full truncate text-xs text-muted-foreground" title={agentName(c.agentId)}>{agentName(c.agentId)}</span>}
                  </div></TableCell>}
                  {(visibleCols.has("status")||visibleCols.has("duration"))&&<TableCell><div className="calls-cell-stack">
                    {visibleCols.has("status")&&<div className="flex flex-wrap items-center gap-1"><StatusBadge status={c.status}/><CallFailureCode metadata={c.metadata} status={c.status}/></div>}
                    {visibleCols.has("duration")&&<span className="text-xs tabular-nums text-muted-foreground">{fmtDuration(c.durationSeconds)}</span>}
                  </div></TableCell>}
                  {visibleCols.has("intent")&&<TableCell>{c.metadata?.demoCall===true?<span className="text-xs text-muted-foreground">演示不分析意向</span>:<CallIntentControl callId={c.callId} state={intentById.get(c.callId)} unavailable={followup.isError} loading={followup.isLoading}/>}</TableCell>}
                  {visibleCols.has("cost")&&<TableCell><CallCostCell cost={c.cost} onOpen={()=>setDetailSelection({call:c,viewerKey})}/></TableCell>}
                  <TableCell className="pr-4 text-right">
                    <div className="flex items-center justify-end gap-1"><Button variant="outline" size="sm" onClick={()=>setDetailSelection({call:c,viewerKey})}>详情</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="行操作">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setDetailSelection({ call: c, viewerKey })}>
                          <FileText aria-hidden="true" className="size-4" /> 查看详情
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={readState.isPending || c.readAt === undefined} onClick={() => readState.mutate({ callId: c.callId, organizationId: c.organizationId, read: !c.readAt })}>
                          {c.readAt ? <Circle aria-hidden="true" className="size-4" /> : <Check aria-hidden="true" className="size-4" />}{c.readAt ? '标为未读' : '标为已读'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(c)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-4" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu></div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* ── pagination bar ── */}
        {(() => {
          const allFetched     = !query.hasNextPage;
          const totalKnownPages = totalFetchedPages;

          return (
            <div className="flex flex-col gap-3 px-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-end">
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {/* rows per page */}
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap font-medium text-foreground">每页条数</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3">
                        {pageSize}
                        <ChevronRight className="size-3 rotate-90 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-24">
                      <DropdownMenuRadioGroup
                        value={String(pageSize)}
                        onValueChange={(v) => setPageSize(Number(v))}
                      >
                        {[10, 20, 50].map((n) => (
                          <DropdownMenuRadioItem key={n} value={String(n)}>
                            {n}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* page indicator */}
                <span className="whitespace-nowrap font-medium text-foreground">
                  页码 {displayPage}{allFetched ? `共${totalKnownPages}` : ""}
                </span>

                {/* nav buttons */}
                <div className="flex items-center gap-0.5">
                  <Button variant="outline" size="icon" className="size-8"
                    onClick={() => setPageIdx(0)}
                    disabled={!hasPrev || query.isFetchingNextPage}
                    aria-label="第一页"
                  >
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="size-8"
                    onClick={goPrev}
                    disabled={!hasPrev || query.isFetchingNextPage}
                    aria-label="上一页"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="size-8"
                    onClick={goNext}
                    disabled={!hasNext || query.isFetchingNextPage}
                    aria-label="下一页"
                  >
                    {query.isFetchingNextPage
                      ? <Loader2 className="size-4 animate-spin" />
                      : <ChevronRight className="size-4" />}
                  </Button>
                  <Button variant="outline" size="icon" className="size-8"
                    onClick={() => setPageIdx(totalKnownPages - 1)}
                    disabled={!allFetched || pageIdx >= totalKnownPages - 1 || query.isFetchingNextPage}
                    aria-label="最后一页"
                  >
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {detailSelection?.viewerKey === viewerKey && <CallDetailsSheet
        key={`${viewerKey}:${detailSelection.call.callId}`}
        call={detailSelection.call} onClose={() => setDetailSelection(null)}
      />}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此通话？</AlertDialogTitle>
            <AlertDialogDescription>
              删除通话会移除通话信息和文字记录，存储中的录音文件不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {del.isPending ? <><Loader2 className="animate-spin" /> 正在删除…</> : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
