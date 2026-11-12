/*
 * 中文导读：看板中的近期通话列表。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  MoreHorizontal,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { EmptyState } from "@/src/components/common/EmptyState";
import type { DashboardSummary } from "@/src/lib/api/resources/dashboard";
import { useAgents } from "@/src/hooks/queries/agents";
import type { Agent, CallLog, CallStatus } from "@/src/lib/api/types";

const linkFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function statusVariant(
  status: CallStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
    case "IN_PROGRESS":
      return "default";
    case "FAILED":
    case "NOT_ANSWERED":
    case "SCHEDULED":
    case "PROCESSED":
      return "secondary";
    default:
      return "outline";
  }
}

function statusClass(status: CallStatus) {
  switch (status) {
    case "NEEDS_REVIEW":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "COMPLETED":
      return "border-green-400/20 bg-green-400/8 text-green-400/80";
    case "FAILED":
    case "NOT_ANSWERED":
      return "border-border bg-muted/40 text-muted-foreground";
    case "IN_PROGRESS":
      return "border-sky-500/20 bg-sky-500/10 text-sky-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function formatAbsoluteTimestamp(iso: string | null) {
  if (!iso) return "未记录开始时间";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "时间格式无效";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "未知";
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (h)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatStatus(status: string) {
  return uiLabel(status);
}

function metadataText(call: CallLog, key: "fromNumber" | "toNumber") {
  const value = call.metadata?.[key];
  return typeof value === "string" && value.trim().length ? value : null;
}

function callParties(call: CallLog) {
  const fromNumber = metadataText(call, "fromNumber");
  const toNumber = metadataText(call, "toNumber");

  if (call.direction === "inbound") {
    return {
      caller: fromNumber ?? call.callerId ?? "未知来电",
      callee: toNumber ?? "未知接听方",
    };
  }

  if (call.direction === "outbound") {
    return {
      caller: fromNumber ?? "未知来电",
      callee: toNumber ?? call.callerId ?? "未知接听方",
    };
  }

  return {
    caller: fromNumber ?? call.callerId ?? "未知来电",
    callee: toNumber ?? "未知接听方",
  };
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function primaryNumber(call: CallLog, parties: ReturnType<typeof callParties>) {
  if (call.direction === "outbound") return parties.callee;
  return parties.caller;
}

function directionClasses(direction: CallLog["direction"]) {
  if (direction === "inbound" || direction === "outbound") {
    return "border-border bg-muted/40 text-muted-foreground";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function resolveAgentLabel({
  call,
  agents,
  agentsLoading,
  agentsError,
}: {
  call: CallLog;
  agents?: Agent[];
  agentsLoading: boolean;
  agentsError: boolean;
}) {
  if (!call.agentId) return "未分配";
  if (agentsLoading) return "正在查找数字员工";
  if (agentsError) return "无法获取数字员工名称";
  return (
    agents?.find((agent) => agent.agentId === call.agentId)?.name ??
    "未知数字员工"
  );
}

function CallTimestamp({ call }: { call: CallLog }) {
  return call.startTime ? (
    <time dateTime={call.startTime}>
      {formatAbsoluteTimestamp(call.startTime)}
    </time>
  ) : (
    <span>未记录开始时间</span>
  );
}

export function RecentCallsTable({
  summary,
  loading,
}: {
  summary?: DashboardSummary;
  loading?: boolean;
}) {
  const {
    data: agents,
    isLoading: agentsLoading,
    isError: agentsError,
  } = useAgents();
  const hasAgentLookupGap =
    agentsError && Boolean(summary?.recent.some((call) => call.agentId));

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            最近通话记录
          </h3>
          
        </div>
        <Link
          href={'/calls?ownerId='+encodeURIComponent(summary?.ownerId||'mine')}
          className={`inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline ${linkFocusClass}`}
        >
          查看通话记录 <ArrowRight className="size-3" />
        </Link>
      </div>
      {hasAgentLookupGap ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 border-b bg-muted/40 px-5 py-3 text-xs text-muted-foreground"
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            <span className="font-semibold">通话数据不完整：</span>{" "}
            已加载最近通话，但未能获取数字员工名称。请打开通话详情查看完整记录。
          </span>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-2 p-5">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !summary?.recent.length ? (
        <EmptyState
          icon={PhoneCall}
          title="还没有通话记录"
          className="border-0"
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="sm">
                <Link href="/outbound">查看外呼任务</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="divide-y md:divide-y-0">
          <ul className="divide-y md:hidden">
            {summary.recent.map((call) => {
              const parties = callParties(call);
              const agentLabel = resolveAgentLabel({
                call,
                agents,
                agentsLoading,
                agentsError,
              });

              return (
                <li key={call.callId}>
                  <Link
                    href={`/calls/${call.callId}`}
                    aria-label={`打开通话详情${call.callId}: ${parties.caller}至${parties.callee}`}
                    className={`group block px-5 py-4 transition-colors hover:bg-muted/40 ${linkFocusClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          <CallTimestamp call={call} />
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-foreground">
                          {parties.caller}
                        </p>
                      </div>
                      <Badge
                        variant={statusVariant(call.status)}
                        className={`w-fit shrink-0 capitalize ${statusClass(call.status)}`}
                      >
                        {formatStatus(call.status)}
                      </Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">接听方</dt>
                        <dd className="truncate font-medium text-foreground">
                          {parties.callee}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">数字员工</dt>
                        <dd className="truncate font-medium text-foreground">
                          {agentLabel}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">时长</dt>
                        <dd className="font-medium text-foreground">
                          {formatDuration(call.durationSeconds)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">方向</dt>
                        <dd className="font-medium capitalize text-foreground">
                          {uiLabel(call.direction ?? "unknown")}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[720px] border-collapse">
              <TableCaption className="sr-only">
                最近通话记录：包括准确时间、电话号码、数字员工、时长、方向、状态和操作。
              </TableCaption>
              <TableHeader>
                <TableRow className="border-b bg-background/70 hover:bg-background/70">
                  <TableHead className="h-11 pl-5 text-xs font-semibold text-foreground">
                    开始时间
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-foreground">
                    号码
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-foreground">
                    数字员工
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-foreground">
                    时长
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-foreground">
                    方向
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-foreground">
                    状态
                  </TableHead>
                  <TableHead className="pr-5 text-right text-xs font-semibold text-foreground">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.recent.map((call) => {
                  const parties = callParties(call);
                  const agentLabel = resolveAgentLabel({
                    call,
                    agents,
                    agentsLoading,
                    agentsError,
                  });
                  const number = primaryNumber(call, parties);
                  const DirectionIcon =
                    call.direction === "inbound"
                      ? PhoneIncoming
                      : PhoneOutgoing;

                  return (
                    <TableRow
                      key={call.callId}
                      className="border-b border-border/70 bg-card transition-colors hover:bg-muted/25"
                    >
                      <TableCell className="h-13 pl-5 align-middle text-sm text-muted-foreground">
                        <CallTimestamp call={call} />
                      </TableCell>
                      <TableCell className="align-middle">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {number}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-[220px] align-middle">
                        <p className="truncate text-sm text-muted-foreground">
                          {agentLabel}
                        </p>
                        <span className="sr-only">
                          {call.agentId
                            ? `编号${shortId(call.agentId)}`
                            : "未分配数字员工"}
                        </span>
                      </TableCell>
                      <TableCell className="align-middle text-sm font-semibold tabular-nums text-foreground">
                        {formatDuration(call.durationSeconds)}
                      </TableCell>
                      <TableCell className="align-middle">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium capitalize ${directionClasses(call.direction)}`}
                        >
                          <DirectionIcon
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          {uiLabel(call.direction ?? "unknown")}
                        </span>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Badge
                          variant={statusVariant(call.status)}
                          className={`w-fit shrink-0 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusClass(call.status)}`}
                        >
                          {uiLabel(call.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5 text-right align-middle">
                        <Link
                          href={`/calls/${call.callId}`}
                          aria-label={`打开通话详情${call.callId}: ${parties.caller}至${parties.callee}`}
                          className={`inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${linkFocusClass}`}
                        >
                          <MoreHorizontal
                            className="size-4"
                            aria-hidden="true"
                          />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
