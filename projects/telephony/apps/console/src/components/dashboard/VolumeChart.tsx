/*
 * 中文导读：数据看板的 VolumeChart 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { useId } from "react";
import { PhoneCall } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/src/components/ui/chart";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import type {
  DashboardRange,
  DashboardSeriesPoint,
  DashboardSummary,
} from "@/src/lib/api/resources/dashboard";

const config = {
  calls: {
    label: "通话",
    color: "#b4424b",
  },
  minutes: {
    label: "分钟",
    color: "#64748b",
  },
  failed: {
    label: "失败",
    color: "#d88991",
  },
} satisfies ChartConfig;

const tooltipCursor = {
  stroke: "var(--border)",
  strokeWidth: 1,
  strokeDasharray: "3 4",
};

function TrendDot({ cx, cy, value, points, stroke }: DotItemDotProps) {
  const sample = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof sample !== "number" || (sample === 0 && points.length > 1)) {
    return <g />;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={2.5}
      fill="var(--card)"
      stroke={stroke}
      strokeWidth={1.5}
    />
  );
}

function TrendTooltip({
  active,
  payload,
  range,
}: Pick<TooltipContentProps<number, string>, "active" | "payload"> & {
  range: DashboardRange;
}) {
  const point = payload?.[0]?.payload as DashboardSeriesPoint | undefined;
  if (!active || !point) return null;

  const date = new Date(point.t).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(range === "24h"
      ? ({ hour: "2-digit", minute: "2-digit" } as const)
      : {}),
    timeZone: "Asia/Shanghai",
  });

  return (
    <div className="min-w-44 rounded-xl border border-border/60 bg-popover px-3.5 py-3 text-xs text-popover-foreground shadow-lg shadow-black/5">
      <p className="mb-2.5 border-b border-border/50 pb-2.5 font-medium">
        {date}
      </p>
      <dl className="space-y-2">
        {[
          {
            label: "通话数量",
            value: point.calls,
            unit: "次",
            color: config.calls.color,
          },
          {
            label: "失败通话",
            value: point.failed,
            unit: "次",
            color: config.failed.color,
          },
          {
            label: "通话时长",
            value: point.minutes,
            unit: "分钟",
            color: config.minutes.color,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-6"
          >
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </dt>
            <dd className="font-medium tabular-nums">
              {item.value.toLocaleString("zh-CN")}
              <span className="ml-1 font-normal text-muted-foreground">
                {item.unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatTick(iso: string, range: DashboardRange) {
  const d = new Date(iso);
  if (range === "24h") {
    return d.toLocaleTimeString("zh-CN", {
      hour: "numeric",
      timeZone: "Asia/Shanghai",
    });
  }
  return d.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  });
}

function totalFor(
  data: DashboardSeriesPoint[],
  key: keyof DashboardSeriesPoint,
) {
  return data.reduce((sum, point) => {
    const value = point[key];
    return typeof value === "number" ? sum + value : sum;
  }, 0);
}

export function VolumeChart({
  summary,
  range,
  loading,
}: {
  summary?: DashboardSummary;
  range: DashboardRange;
  loading?: boolean;
}) {
  const titleId = useId();
  const chartId = titleId.replace(/:/g, "");
  const callsGradientId = `calls-${chartId}`;
  const minutesGradientId = `minutes-${chartId}`;
  const summaryId = useId();
  const bucketUnit = range === "24h" ? "小时" : "天";

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const data = summary?.series ?? [];
  const peak = data.reduce((max, point) => Math.max(max, point.calls), 0);
  const calls = totalFor(data, "calls");
  const minutes = totalFor(data, "minutes");
  const failedCalls = totalFor(data, "failed");

  return (
    <div
      className="overflow-hidden rounded-xl border bg-card"
      aria-labelledby={titleId}
    >
      <div className="flex flex-col gap-4 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            通话趋势
          </h3>
          <p id={summaryId} className="sr-only">
            通话量与时长，按{bucketUnit}统计
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border/60 text-xs sm:min-w-80">
          <div className="pr-4 sm:px-5">
            <dt className="text-muted-foreground">总通话</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {calls.toLocaleString("zh-CN")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                次
              </span>
            </dd>
          </div>
          <div className="px-4 sm:px-5">
            <dt className="text-muted-foreground">总时长</dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {minutes.toLocaleString("zh-CN")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                分钟
              </span>
            </dd>
          </div>
          <div className="pl-4 sm:pl-5">
            <dt className="text-muted-foreground">
              {range === "24h" ? "小时" : "日"}峰值
            </dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">
              {peak.toLocaleString("zh-CN")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                次
              </span>
            </dd>
          </div>
        </dl>
      </div>
      {data.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="此范围内还没有通话"
          className="m-5 h-80 bg-background/40"
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="sm">
                <Link href="/outbound">查看外呼任务</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/numbers">关联号码</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 px-4 pt-5 pb-3 sm:px-5">
            <section aria-label="通话数量趋势" className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">
                  通话数量
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    / 次
                  </span>
                </span>
                <ul
                  className="flex gap-4 text-muted-foreground"
                  aria-label="通话数量图例"
                >
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-px w-4"
                      style={{ backgroundColor: config.calls.color }}
                    />
                    通话
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="w-4 border-t border-dashed"
                      style={{ borderColor: config.failed.color }}
                    />
                    失败
                  </li>
                </ul>
              </div>
              <ChartContainer
                config={config}
                className="h-40 w-full aspect-auto [&_.recharts-surface]:focus-visible:outline-2 [&_.recharts-surface]:focus-visible:outline-offset-2 [&_.recharts-surface]:focus-visible:outline-ring"
                role="group"
                aria-label="通话数量和失败通话随时间的变化"
                aria-describedby={summaryId}
              >
                <ComposedChart
                  accessibilityLayer
                  data={data}
                  margin={{ top: 10, right: 8, left: 0, bottom: 6 }}
                >
                  <defs>
                    <linearGradient
                      id={callsGradientId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--color-calls)"
                        stopOpacity={0.1}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-calls)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 6"
                    className="stroke-border/50"
                    vertical={false}
                  />
                  <XAxis dataKey="t" hide padding={{ left: 8, right: 8 }} />
                  <YAxis
                    stroke="currentColor"
                    className="text-xs text-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    width={34}
                    tick={{ fontSize: 11 }}
                    tickCount={4}
                    allowDecimals={false}
                    domain={[
                      0,
                      (max: number) => Math.max(4, Math.ceil(max * 1.15)),
                    ]}
                  />
                  <ChartTooltip
                    cursor={tooltipCursor}
                    isAnimationActive={false}
                    content={({ active, payload }) => (
                      <TrendTooltip
                        active={active}
                        payload={payload}
                        range={range}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    name="通话数量"
                    stroke="var(--color-calls)"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={`url(#${callsGradientId})`}
                    dot={TrendDot}
                    activeDot={{
                      r: 4,
                      fill: "var(--color-calls)",
                      stroke: "var(--card)",
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="failed"
                    name="失败通话"
                    stroke="var(--color-failed)"
                    strokeWidth={1.2}
                    strokeDasharray="3 5"
                    strokeLinecap="round"
                    dot={failedCalls > 0 ? TrendDot : false}
                    activeDot={
                      failedCalls > 0
                        ? {
                            r: 3,
                            fill: "var(--color-failed)",
                            stroke: "var(--card)",
                            strokeWidth: 1.5,
                          }
                        : false
                    }
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            </section>
            <section
              aria-label="通话时长趋势"
              className="min-w-0 border-t border-border/50 pt-4"
            >
              <div className="mb-2 text-xs">
                <span className="font-medium text-foreground">
                  通话时长
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    / 分钟
                  </span>
                </span>
              </div>
              <ChartContainer
                config={config}
                className="h-36 w-full aspect-auto [&_.recharts-surface]:focus-visible:outline-2 [&_.recharts-surface]:focus-visible:outline-offset-2 [&_.recharts-surface]:focus-visible:outline-ring"
                role="group"
                aria-label="通话分钟数随时间的变化"
                aria-describedby={summaryId}
              >
                <ComposedChart
                  accessibilityLayer
                  data={data}
                  margin={{ top: 10, right: 8, left: 0, bottom: 8 }}
                >
                  <defs>
                    <linearGradient
                      id={minutesGradientId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--color-minutes)"
                        stopOpacity={0.09}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-minutes)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 6"
                    className="stroke-border/50"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => formatTick(v, range)}
                    stroke="currentColor"
                    className="text-xs text-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    padding={{ left: 8, right: 8 }}
                    tick={{ fontSize: 11 }}
                    tickMargin={10}
                    minTickGap={28}
                  />
                  <YAxis
                    stroke="currentColor"
                    className="text-xs text-muted-foreground"
                    tickLine={false}
                    axisLine={false}
                    width={34}
                    tick={{ fontSize: 11 }}
                    tickCount={4}
                    domain={[
                      0,
                      (max: number) => Math.max(4, Math.ceil(max * 1.15)),
                    ]}
                  />
                  <ChartTooltip
                    cursor={tooltipCursor}
                    isAnimationActive={false}
                    content={({ active, payload }) => (
                      <TrendTooltip
                        active={active}
                        payload={payload}
                        range={range}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    name="通话分钟数"
                    stroke="var(--color-minutes)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={`url(#${minutesGradientId})`}
                    dot={TrendDot}
                    activeDot={{
                      r: 4,
                      fill: "var(--color-minutes)",
                      stroke: "var(--card)",
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            </section>
          </div>
          <div className="sr-only">
            <table aria-describedby={summaryId}>
              <caption>通话趋势统计表</caption>
              <thead>
                <tr>
                  <th scope="col">{bucketUnit}</th>
                  <th scope="col">通话</th>
                  <th scope="col">分钟</th>
                  <th scope="col">失败通话</th>
                </tr>
              </thead>
              <tbody>
                {data.map((point) => (
                  <tr key={point.t}>
                    <th scope="row">{formatTick(point.t, range)}</th>
                    <td>{point.calls}</td>
                    <td>{point.minutes}</td>
                    <td>{point.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
