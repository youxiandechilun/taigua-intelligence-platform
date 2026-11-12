/*
 * 中文导读：数据看板的 BreakdownCharts 组件，封装该界面的展示与交互。
 */
"use client";
import Link from "next/link";
import { PhoneCall, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Skeleton } from "@/src/components/ui/skeleton";
import { dashboardCallsHref } from "@/src/components/dashboard/call-filter-links";
import { uiLabel } from "@/src/lib/locale";
import type { CallStatus } from "@/src/lib/api/types";
import type {
  DashboardRange,
  DashboardSummary,
} from "@/src/lib/api/resources/dashboard";

const statuses: { key: CallStatus; label: string; color: string }[] = [
  { key: "COMPLETED", label: "已接通", color: "bg-primary" },
  { key: "NOT_ANSWERED", label: "未接通", color: "bg-amber-500" },
  { key: "FAILED", label: "失败", color: "bg-rose-400" },
  { key: "IN_PROGRESS", label: "进行中", color: "bg-slate-400" },
  { key: "NEEDS_REVIEW", label: "结果待核对", color: "bg-amber-500" },
];
export function BreakdownCharts({
  summary,
  range,
  loading,
  customFrom,
  customTo,
}: {
  summary?: DashboardSummary;
  range: DashboardRange;
  loading?: boolean;
  customFrom?: string;
  customTo?: string;
}) {
  if (loading)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    );
  const total = summary?.totals.calls ?? 0;
  const statusRows = [
    ...statuses,
    ...(summary?.statusBreakdown ?? [])
      .filter((item) => !statuses.some((status) => status.key === item.status))
      .map((item) => ({
        key: item.status,
        label: uiLabel(item.status),
        color: "bg-slate-400",
      })),
  ];
  const directions = [
    {
      key: "outbound",
      label: "呼出",
      icon: PhoneOutgoing,
      color: "bg-primary",
    },
    {
      key: "inbound",
      label: "呼入",
      icon: PhoneIncoming,
      color: "bg-slate-400",
    },
    ...(summary?.directionBreakdown.some(
      (item) => item.direction === "unknown" && item.count > 0,
    )
      ? [
          {
            key: "unknown",
            label: "未分类",
            icon: PhoneCall,
            color: "bg-slate-300",
          },
        ]
      : []),
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border bg-card" aria-label="通话结果分布">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-sm font-semibold">通话结果</h2>
          <span className="text-xs text-muted-foreground">共 {total} 次</span>
        </div>
        <div className="space-y-3 px-5 py-4">
          {statusRows.map((item) => {
            const count =
              summary?.statusBreakdown.find((row) => row.status === item.key)
                ?.count ?? 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <Link
                key={item.key}
                href={dashboardCallsHref({
                  range,
                  ownerId:summary?.ownerId,
                  status: item.key,
                  from: customFrom,
                  to: customTo,
                })}
                className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-primary"
              >
                <span className="text-xs">{item.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${item.color}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums">
                  {count}{" "}
                  <span className="text-muted-foreground">/ {pct}%</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
      <section
        className="rounded-xl border bg-card"
        aria-label="呼入与呼出分布"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-sm font-semibold">呼入 / 呼出</h2>
          <Link
            href={dashboardCallsHref({ range, ownerId:summary?.ownerId,from: customFrom, to: customTo })}
            className="text-xs text-primary hover:underline"
          >
            查看记录
          </Link>
        </div>
        <div className="space-y-4 px-5 py-4">
          {directions.map((item) => {
            const count =
              summary?.directionBreakdown.find(
                (row) => row.direction === item.key,
              )?.count ?? 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={item.key}>
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <item.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{item.label}</span>
                  <span className="tabular-nums">
                    {count} 次{" "}
                    <span className="ml-2 text-muted-foreground">{pct}%</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {total ? "按实际通话方向统计" : "暂无通话记录，通话完成后自动统计"}
          </p>
        </div>
      </section>
    </div>
  );
}
