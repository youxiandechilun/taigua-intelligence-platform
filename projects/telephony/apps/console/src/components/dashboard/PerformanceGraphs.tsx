/*
 * 中文导读：数据看板的 PerformanceGraphs 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/src/components/ui/chart";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import { dashboardCallsHref } from "@/src/components/dashboard/call-filter-links";
import type {
  DashboardRange,
  DashboardSeriesPoint,
  DashboardSummary,
} from "@/src/lib/api/resources/dashboard";

const successConfig = {
  successRate: { label: "成功率", color: "var(--chart-1)" },
} satisfies ChartConfig;

const exceptionConfig = {
  failed: { label: "失败", color: "var(--destructive)" },
  missed: { label: "未接", color: "var(--chart-3)" },
} satisfies ChartConfig;

const efficiencyConfig = {
  calls: { label: "通话", color: "var(--chart-1)" },
  minutesPerCall: { label: "每次通话分钟数", color: "var(--chart-2)" },
} satisfies ChartConfig;

function formatTick(iso: string, range: DashboardRange) {
  const date = new Date(iso);
  if (range === "24h") return date.toLocaleTimeString("zh-CN", { hour: "numeric" });
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatSuccess(value: number) {
  return `${Math.round(value)}%`;
}

function buildGraphData(series: DashboardSeriesPoint[]) {
  return series.map((point) => ({
    ...point,
    successRate: Math.round(point.successRate * 100),
    exceptions: point.failed + point.missed,
    minutesPerCall: point.calls
      ? Number((point.minutes / point.calls).toFixed(1))
      : 0,
  }));
}

function GraphCard({
  eyebrow,
  title,
  description,
  metric,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  metric: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
      <div className="flex items-start justify-between gap-4 border-b bg-muted/20 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        <div className="shrink-0 rounded-lg border bg-background px-3 py-2 text-right shadow-xs">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {metric}
          </p>
          <p className="text-xs text-muted-foreground">当前</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function PerformanceGraphs({
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
  const successSummaryId = useId();
  const exceptionSummaryId = useId();
  const efficiencySummaryId = useId();

  if (loading) {
    return (
      <div className="grid gap-4 xl:grid-cols-3">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="rounded-lg border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-2 h-4 w-52" />
            <Skeleton className="mt-5 h-56 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const data = buildGraphData(summary?.series ?? []);
  const latest = data[data.length - 1];
  const totalExceptions = data.reduce((sum, point) => sum + point.exceptions, 0);
  const avgMinutesPerCall = data.length
    ? data.reduce((sum, point) => sum + point.minutesPerCall, 0) / data.length
    : 0;

  if (!data.length) {
    return (
      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <EmptyState
          icon={BarChart3}
          title="还没有表现图表数据"
          className="border-0 bg-background/40"
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="sm">
                <Link href="/outbound">发起测试通话</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/numbers">关联号码</Link>
              </Button>
            </div>
          }
        />
      </section>
    );
  }

  return (
    <div
      className="grid gap-4 xl:grid-cols-3"
      aria-label="表现分析图表"
    >
      <GraphCard
        eyebrow="通话质量"
        title="成功率趋势"
        metric={latest ? `${latest.successRate}%` : "0%"}
      >
        <ChartContainer
          config={successConfig}
          className="h-64 w-full p-5"
          role="group"
          aria-label="成功率趋势图"
        >
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 16, left: 4, bottom: 20 }}
            aria-describedby={successSummaryId}
          >
            <defs>
              <linearGradient
                id="dashboard-success-fill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="var(--color-successRate)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-successRate)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} className="stroke-border" />
            <XAxis
              dataKey="t"
              tickFormatter={(value) => formatTick(value, range)}
              tickLine={false}
              axisLine={false}
              className="text-xs text-muted-foreground"
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={formatSuccess}
              tickLine={false}
              axisLine={false}
              width={42}
              className="text-xs text-muted-foreground"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatTick(String(value), range)}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="successRate"
              name="Success rate"
              stroke="var(--color-successRate)"
              strokeWidth={2}
              fill="url(#dashboard-success-fill)"
              isAnimationActive
            />
          </AreaChart>
        </ChartContainer>
        <div className="sr-only">
          <p id={successSummaryId}>
            仪表盘所选期间的成功率趋势。
          </p>
          <table aria-describedby={successSummaryId}>
            <caption>成功率趋势表</caption>
            <thead>
              <tr>
                <th scope="col">时间分段</th>
                <th scope="col">成功率</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.t}>
                  <th scope="row">{formatTick(point.t, range)}</th>
                  <td>{point.successRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GraphCard>

      <GraphCard
        eyebrow="风险情况"
        title="异常压力"
        metric={totalExceptions.toLocaleString("zh-CN")}
      >
        <ChartContainer
          config={exceptionConfig}
          className="h-64 w-full p-5"
          role="group"
          aria-label="异常通话堆叠柱图"
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 16, left: 4, bottom: 20 }}
            aria-describedby={exceptionSummaryId}
          >
            <CartesianGrid vertical={false} className="stroke-border" />
            <XAxis
              dataKey="t"
              tickFormatter={(value) => formatTick(value, range)}
              tickLine={false}
              axisLine={false}
              className="text-xs text-muted-foreground"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={34}
              className="text-xs text-muted-foreground"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatTick(String(value), range)}
                />
              }
            />
            <Bar
              dataKey="failed"
              name="Failed"
              stackId="exceptions"
              fill="var(--color-failed)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="missed"
              name="Missed"
              stackId="exceptions"
              fill="var(--color-missed)"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
        <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-3 text-destructive" />
            失败与未接通话分段
          </span>
          <Link
            href={dashboardCallsHref({ range, status: "FAILED", from: customFrom, to: customTo })}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            查看失败通话 <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="sr-only">
          <p id={exceptionSummaryId}>
            失败和未接通话数量随时间的变化。
          </p>
          <table aria-describedby={exceptionSummaryId}>
            <caption>异常通话统计表</caption>
            <thead>
              <tr>
                <th scope="col">时间分段</th>
                <th scope="col">失败通话</th>
                <th scope="col">未接通话</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.t}>
                  <th scope="row">{formatTick(point.t, range)}</th>
                  <td>{point.failed}</td>
                  <td>{point.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GraphCard>

      <GraphCard
        eyebrow="通话效率"
        title="对话效率"
        metric={`${avgMinutesPerCall.toFixed(1)}m`}
      >
        <ChartContainer
          config={efficiencyConfig}
          className="h-64 w-full p-5"
          role="group"
          aria-label="通话效率折线图"
        >
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 16, left: 4, bottom: 20 }}
            aria-describedby={efficiencySummaryId}
          >
            <CartesianGrid vertical={false} className="stroke-border" />
            <XAxis
              dataKey="t"
              tickFormatter={(value) => formatTick(value, range)}
              tickLine={false}
              axisLine={false}
              className="text-xs text-muted-foreground"
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={34}
              className="text-xs text-muted-foreground"
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={42}
              className="text-xs text-muted-foreground"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatTick(String(value), range)}
                />
              }
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="calls"
              name="Calls"
              stroke="var(--color-calls)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="minutesPerCall"
              name="Minutes per call"
              stroke="var(--color-minutesPerCall)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
            />
          </LineChart>
        </ChartContainer>
        <div className="sr-only">
          
          <table aria-describedby={efficiencySummaryId}>
            <caption>通话效率统计表</caption>
            <thead>
              <tr>
                <th scope="col">时间分段</th>
                <th scope="col">通话</th>
                <th scope="col">每次通话分钟数</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.t}>
                  <th scope="row">{formatTick(point.t, range)}</th>
                  <td>{point.calls}</td>
                  <td>{point.minutesPerCall}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GraphCard>
    </div>
  );
}
