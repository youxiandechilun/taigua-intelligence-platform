/*
 * 中文导读：外呼任务的 OutboundCallsPanel 组件，封装该界面的展示与交互。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import { useMemo, useState } from "react";
import {
  Download,
  Loader2,
  MoreHorizontal,
  PhoneCall,
  PhoneOutgoing,
  RefreshCw,
  RotateCcw,
  Search,
  SquareX,
} from "lucide-react";
import { toast } from "@/src/lib/toast";

import { EmptyState } from "@/src/components/common/EmptyState";
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
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Input } from "@/src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { useAgents } from "@/src/hooks/queries/agents";
import {
  useCancelOutboundCall,
  useOutboundCall,
  useOutboundCalls,
  useRetryOutboundCall,
} from "@/src/hooks/queries/outbound";
import type { OutboundCall } from "@/src/lib/api/resources/outbound";
import type { CallStatus } from "@/src/lib/api/types";
import { downloadRowsAsExcel } from "@/src/lib/export-excel";

const STATUS_OPTIONS: Array<"all" | CallStatus> = [
  "all",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "NOT_ANSWERED",
  "PROCESSED",
];

function statusLabel(status: string) {
  return uiLabel(status);
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDuration(seconds: number | null | undefined) {
  if (!seconds) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function statusVariant(status: CallStatus) {
  if (status === "FAILED" || status === "NOT_ANSWERED") return "destructive" as const;
  if (status === "COMPLETED") return "default" as const;
  if (status === "IN_PROGRESS") return "secondary" as const;
  return "outline" as const;
}

function canCancel(call: OutboundCall) {
  return call.status === "SCHEDULED";
}

function canRetry(call: OutboundCall) {
  return call.status === "FAILED" || call.status === "NOT_ANSWERED";
}

function downloadOutboundCsv(calls: OutboundCall[], agentName: (id: string | null) => string) {
  downloadRowsAsExcel("外呼通话.xlsx", calls, [
    { header: "外呼编号", value: (call) => call.outboundId },
    { header: "状态", value: (call) => call.status },
    { header: "模式", value: (call) => call.mode },
    { header: "智能体", value: (call) => agentName(call.agentId) },
    { header: "被叫号码", value: (call) => call.phoneNumber },
    { header: "主叫号码", value: (call) => call.fromNumber },
    { header: "计划执行时间", value: (call) => call.scheduledAt ?? "" },
    { header: "创建时间", value: (call) => call.createdAt },
    {
      header: "失败原因",
      value: (call) => call.failureReason ?? call.cancellationReason ?? "",
    },
  ]);
}

function OutboundCallDetailDialog({
  call,
  onOpenChange,
}: {
  call: OutboundCall | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: detail, isLoading } = useOutboundCall(call?.outboundId);
  const shown = detail ?? call;

  return (
    <Dialog open={!!call} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>外呼通话</DialogTitle>
          <DialogDescription>
            查看被叫号码、调度状态和话术覆盖设置。
          </DialogDescription>
        </DialogHeader>

        {isLoading || !shown ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">状态</p>
                <Badge className="mt-2 capitalize" variant={statusVariant(shown.status)}>
                  {statusLabel(shown.status)}
                </Badge>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">模式</p>
                <p className="mt-1 font-medium capitalize">{uiLabel(shown.mode)}</p>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">时长</p>
                <p className="mt-1 font-medium tabular-nums">
                  {fmtDuration(shown.callLog?.durationSeconds)}
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">到</p>
                <p className="mt-1 font-mono text-xs">{shown.phoneNumber}</p>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">主叫号码</p>
                <p className="mt-1 font-mono text-xs">{shown.fromNumber}</p>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">已计划</p>
                <p className="mt-1 font-medium">{fmtDate(shown.scheduledAt)}</p>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">已更新</p>
                <p className="mt-1 font-medium">{fmtDate(shown.updatedAt)}</p>
              </div>
            </div>

            {shown.failureReason || shown.cancellationReason ? (
              <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {shown.failureReason ?? shown.cancellationReason}
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">首条消息</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {shown.firstMessage || "-"}
                </p>
              </div>
              <div className="border p-3">
                <p className="text-xs text-muted-foreground">系统提示词覆盖</p>
                <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-sm">
                  {shown.systemPrompt || "-"}
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OutboundCallsPanel() {
  const { data: agents = [] } = useAgents();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CallStatus>("all");
  const [mode, setMode] = useState<"all" | "quick" | "campaign">("all");
  const [selectedCall, setSelectedCall] = useState<OutboundCall | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OutboundCall | null>(null);
  const retryCall = useRetryOutboundCall();
  const cancelCall = useCancelOutboundCall();

  const params = useMemo(
    () => ({
      limit: 100,
      ...(status !== "all" ? { status } : {}),
      ...(mode !== "all" ? { mode } : {}),
    }),
    [mode, status]
  );
  const { data, isLoading, isError, isFetching, refetch } = useOutboundCalls(params);
  const calls = useMemo(() => data?.items ?? [], [data?.items]);

  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent.name])),
    [agents]
  );

  const filteredCalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return calls;
    return calls.filter((call) =>
      [
        call.outboundId,
        call.phoneNumber,
        call.fromNumber,
        call.status,
        call.mode,
        agentNames.get(call.agentId ?? "") ?? "-",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [agentNames, calls, search]);

  async function confirmCancel() {
    try {
      if (!cancelTarget) return;
      await cancelCall.mutateAsync(cancelTarget.outboundId, {
        onSuccess: () => setCancelTarget(null),
      });
    } catch {
      // The mutation hook displays the API error; preserve the current state for retry.
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(6)].map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={PhoneOutgoing}
        title="无法加载外呼通话"
        description="请刷新外呼列表，或检查网络连接后重试。"
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            重试
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 border bg-card p-4 xl:grid-cols-[minmax(0,1fr)_180px_160px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索通话、号码、智能体或状态"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((item) => (
              <SelectItem key={item} value={item} className="capitalize">
                {item === "all" ? "所有状态" : statusLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有模式</SelectItem>
            <SelectItem value="quick">快速</SelectItem>
            <SelectItem value="campaign">活动</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => {
            downloadOutboundCsv(filteredCalls, (id) => agentNames.get(id ?? "") ?? "-");
            toast.success("外呼导出文件已下载");
          }}
          disabled={!filteredCalls.length}
        >
          <Download className="size-4" />
          导出 Excel 表格
        </Button>
      </div>

      {!filteredCalls.length ? (
        <EmptyState
          icon={PhoneOutgoing}
          title="未找到外呼通话"
        />
      ) : (
        <div className="border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>通话</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>智能体</TableHead>
                <TableHead>已计划</TableHead>
                <TableHead>时长</TableHead>
                <TableHead className="w-12 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCalls.map((call) => (
                <TableRow key={call.outboundId}>
                  <TableCell>
                    <div className="min-w-64 space-y-1">
                      <div className="flex items-center gap-2">
                        <PhoneCall className="size-4 text-muted-foreground" />
                        <p className="font-mono text-xs">{call.phoneNumber}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        从 {call.fromNumber} · {uiLabel(call.mode)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className="capitalize" variant={statusVariant(call.status)}>
                      {statusLabel(call.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{agentNames.get(call.agentId ?? "") ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {fmtDate(call.scheduledAt)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {fmtDuration(call.callLog?.durationSeconds)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`外呼操作对象：${call.outboundId}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>通话操作</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setSelectedCall(call)}>
                          <PhoneCall className="size-4" />
                          查看详情
                        </DropdownMenuItem>
                        {canRetry(call) ? (
                          <DropdownMenuItem
                            onClick={() => retryCall.mutate(call.outboundId)}
                            disabled={retryCall.isPending}
                          >
                            <RotateCcw className="size-4" />
                            重试通话
                          </DropdownMenuItem>
                        ) : null}
                        {canCancel(call) ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setCancelTarget(call)}
                            >
                              <SquareX className="size-4" />
                              取消通话
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <OutboundCallDetailDialog
        call={selectedCall}
        onOpenChange={(open) => {
          if (!open) setSelectedCall(null);
        }}
      />

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open && !cancelCall.isPending) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消外呼通话？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将取消以下号码的计划通话： {cancelTarget?.phoneNumber}。已开始的通话无法在这里取消。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelCall.isPending}>
              保留通话
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                confirmCancel();
              }}
              disabled={cancelCall.isPending}
            >
              {cancelCall.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              取消通话
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
