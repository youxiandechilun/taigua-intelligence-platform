/*
 * 中文导读：数据看板关键指标卡片。
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  PhoneCall,
  TrendingDown,
  TrendingUp,
  Timer,
  Voicemail,
} from "lucide-react";
import { StatCard } from "@/src/components/common/StatCard";
import { dashboardCallsHref } from "@/src/components/dashboard/call-filter-links";
import type {
  DashboardRange,
  DashboardSummary,
} from "@/src/lib/api/resources/dashboard";

const PREVIOUS_PERIOD_LABELS: Record<DashboardSummary["range"], string> = {
  "24h": "之前的 24 小时",
  "7d": "之前的 7 天",
  "30d": "之前的 30 天",
  custom: "之前的自定义期间",
};

const PERIOD_BOUNDARY_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  timeZone: "UTC",
});

type DeltaUnit = "call" | "minute" | "duration" | "percentage point";

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  if (!wholeSeconds) return "0 秒";
  const m = Math.floor(wholeSeconds / 60);
  const s = wholeSeconds % 60;
  if (!m) return `${s} 秒`;
  if (!s) return `${m} 分钟`;
  return `${m} 分钟 ${s} 秒`;
}

function formatPeriodBoundary(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return PERIOD_BOUNDARY_FORMAT.format(date);
}

function formatPreviousPeriodLabel(summary?: DashboardSummary) {
  if (!summary) return "所选对比期间";
  return PREVIOUS_PERIOD_LABELS[summary.range];
}

function formatPreviousPeriodWindow(summary?: DashboardSummary) {
  if (!summary) return null;

  const previousFrom = formatPeriodBoundary(summary.period.previousFrom);
  const previousTo = formatPeriodBoundary(summary.period.previousTo);

  if (!previousFrom || !previousTo) return null;
  return `${previousFrom}至${previousTo} UTC`;
}

function normalizeDeltaValue(value: number | undefined, unit: DeltaUnit) {
  const n = value ?? 0;
  const amount =
    unit === "percentage point" && Math.abs(n) <= 1 ? n * 100 : n;

  return Math.abs(amount) < 0.05 ? 0 : amount;
}

function formatDeltaAmount(value: number) {
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  });
}

function formatDurationDeltaCopy(value: number | undefined) {
  const amount = normalizeDeltaValue(value, "duration");
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${formatDuration(Math.abs(amount))}`;
}

function formatDeltaUnitLabel(
  value: number,
  unit: Exclude<DeltaUnit, "duration">
) {
  if (unit === "percentage point") return "个百分点";
  return unit === "call" ? "次通话" : "分钟";
}

function formatDeltaCopy(value: number | undefined, unit: DeltaUnit) {
  if (unit === "duration") return formatDurationDeltaCopy(value);

  const amount = normalizeDeltaValue(value, unit);
  const sign = amount > 0 ? "+" : "";
  const unitLabel = formatDeltaUnitLabel(amount, unit);

  return `${sign}${formatDeltaAmount(amount)} ${unitLabel}`;
}

function Trend({
  value,
  unit,
  comparisonLabel,
  comparisonTitle,
  inverse = false,
}: {
  value?: number;
  unit: DeltaUnit;
  comparisonLabel: string;
  comparisonTitle?: string | null;
  inverse?: boolean;
}) {
  const n = normalizeDeltaValue(value, unit);
  const positive = n >= 0;
  const good = inverse ? n <= 0 : n >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const deltaCopy = formatDeltaCopy(value, unit);
  const trendCopy = `${deltaCopy}对比${comparisonLabel}`;
  const accessibleCopy = comparisonTitle
    ? `${trendCopy} (${comparisonTitle})`
    : trendCopy;

  return (
    <span
      title={comparisonTitle ?? undefined}
      aria-label={accessibleCopy}
      className={
        good
          ? "flex max-w-full items-start gap-1 text-green-400/80"
          : "flex max-w-full items-start gap-1 text-red-400/80"
      }
    >
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span>{trendCopy}</span>
    </span>
  );
}

function InvestigationHint({
  action,
  children,
}: {
  action: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      <span className="inline-flex items-center gap-1 text-blue-400">
        {action} <ArrowRight className="size-3" />
      </span>
    </div>
  );
}

const drilldownLinkClass =
  "block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function KpiCards({
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
  const totals = summary?.totals;
  const deltas = summary?.deltas;
  const previousPeriodLabel = formatPreviousPeriodLabel(summary);
  const previousPeriodWindow = formatPreviousPeriodWindow(summary);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            周期变化
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
            关键指标趋势
          </h2>
        </div>
      </div>
      <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="通话总数"
          value={totals?.calls.toLocaleString("zh-CN") ?? "0"}
          eyebrow="所有呼入和呼出活动"
          helper={
            deltas ? (
              <Trend
                value={deltas.calls}
                unit="call"
                comparisonLabel={previousPeriodLabel}
                comparisonTitle={previousPeriodWindow}
              />
            ) : undefined
          }
          icon={PhoneCall}
          loading={loading}
          tone="info"
          className="h-full"
        />
        <StatCard
          label="已用分钟数"
          value={totals?.minutes.toLocaleString("zh-CN") ?? "0"}
          eyebrow="已接通对话时长"
          helper={
            deltas ? (
              <Trend
                value={deltas.minutes}
                unit="minute"
                comparisonLabel={previousPeriodLabel}
                comparisonTitle={previousPeriodWindow}
              />
            ) : undefined
          }
          icon={Clock}
          loading={loading}
          tone="neutral"
          className="h-full"
        />
        <StatCard
          label="平均时长"
          value={formatDuration(totals?.avgDurationSeconds ?? 0)}
          eyebrow="每次已完成对话"
          helper={
            deltas ? (
              <Trend
                value={deltas.avgDurationSeconds}
                unit="duration"
                comparisonLabel={previousPeriodLabel}
                comparisonTitle={previousPeriodWindow}
              />
            ) : undefined
          }
          icon={Timer}
          loading={loading}
          tone="neutral"
          className="h-full"
        />
        <StatCard
          label="成功率"
          value={`${Math.round((totals?.successRate ?? 0) * 100)}%`}
          eyebrow="已完成通话占总通话的比例"
          helper={
            deltas ? (
              <Trend
                value={deltas.successRate}
                unit="percentage point"
                comparisonLabel={previousPeriodLabel}
                comparisonTitle={previousPeriodWindow}
              />
            ) : undefined
          }
          icon={CheckCircle2}
          loading={loading}
          tone="success"
          className="h-full"
        />
        <Link
          href={dashboardCallsHref({ range, status: "FAILED", from: customFrom, to: customTo })}
          className={drilldownLinkClass}
          aria-label="查看仪表盘所选期间的失败通话"
        >
          <StatCard
            label="失败"
            value={totals?.failedCalls.toLocaleString("zh-CN") ?? "0"}
            helper={
              <InvestigationHint action="查看失败通话">
                {deltas ? (
                  <Trend
                    value={deltas.failedCalls}
                    unit="call"
                    comparisonLabel={previousPeriodLabel}
                    comparisonTitle={previousPeriodWindow}
                    inverse
                  />
                ) : null}
              </InvestigationHint>
            }
            icon={AlertTriangle}
            loading={loading}
            tone={(totals?.failedCalls ?? 0) > 0 ? "danger" : "neutral"}
            className="h-full"
          />
        </Link>
        <Link
          href={dashboardCallsHref({ range, status: "NOT_ANSWERED", from: customFrom, to: customTo })}
          className={drilldownLinkClass}
          aria-label="查看仪表盘所选期间的未接通话"
        >
          <StatCard
            label="未接"
            value={totals?.missedCalls.toLocaleString("zh-CN") ?? "0"}
            helper={
              <InvestigationHint action="查看未接通话">
                {deltas ? (
                  <Trend
                    value={deltas.missedCalls}
                    unit="call"
                    comparisonLabel={previousPeriodLabel}
                    comparisonTitle={previousPeriodWindow}
                    inverse
                  />
                ) : null}
              </InvestigationHint>
            }
            icon={Voicemail}
            loading={loading}
            tone={(totals?.missedCalls ?? 0) > 0 ? "warning" : "neutral"}
            className="h-full"
          />
        </Link>
      </div>
    </section>
  );
}
