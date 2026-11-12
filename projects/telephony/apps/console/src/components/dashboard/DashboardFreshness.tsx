/*
 * 中文导读：看板数据更新时间与刷新状态。
 */
"use client";

import { useEffect, useState } from "react";
import { Clock3, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import type { DashboardSummary } from "@/src/lib/api/resources/dashboard";

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
};

function formatDateTime(value?: string | number) {
  if (!value) return "暂不可用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂不可用";
  return date.toLocaleString("zh-CN", DATE_TIME_FORMAT);
}

export function DashboardFreshness({
  summary,
  loading,
  dataUpdatedAt,
  isFetching,
  isStale,
  onRefresh,
}: {
  summary?: DashboardSummary;
  loading?: boolean;
  dataUpdatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  onRefresh: () => void;
}) {
  const [isOnline, setIsOnline] = useState(true);
  const hasData = Boolean(summary);
  const showStale = hasData && isStale && !isFetching;

  useEffect(() => {
    function syncOnlineState() {
      setIsOnline(navigator.onLine);
    }

    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);

    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  return (
    <section
      aria-busy={isFetching}
      aria-live="polite"
      className="rounded-lg border bg-card p-3 shadow-sm ring-1 ring-border/60"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md border bg-muted/35 px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              统计期间
            </p>
            <p className="mt-1 text-foreground">
              {loading || !summary
                ? "正在加载所选期间"
                : `${formatDateTime(summary.period.from)}至${formatDateTime(
                    summary.period.to
                  )}`}
            </p>
          </div>
          <div className="rounded-md border bg-muted/35 px-4 py-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              最近更新时间
            </p>
            <p className="mt-1 inline-flex items-center gap-2 text-foreground">
              <Clock3 className="size-4 text-muted-foreground" />
              {dataUpdatedAt ? formatDateTime(dataUpdatedAt) : "尚未更新"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          disabled={isFetching || !isOnline}
          aria-label="刷新仪表盘"
          className="h-10 w-full rounded-md bg-background sm:w-fit"
        >
          <RefreshCw className={isFetching ? "animate-spin" : undefined} />
          {isFetching ? "正在刷新" : "刷新仪表盘"}
        </Button>
      </div>
      {!isOnline ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          <WifiOff className="mt-0.5 size-3.5 shrink-0" />
          <span>
            网络已断开。{" "}
            {hasData
              ? "网络恢复前，显示上次加载的仪表盘数据。"
              : "请恢复网络连接以加载仪表盘。"}
          </span>
        </div>
      ) : showStale ? (
        <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          仪表盘数据可能已过期，请刷新查看最新通话活动。
        </div>
      ) : null}
    </section>
  );
}
