/*
 * 中文导读：数据看板的页面辅助代码；由 Next.js 按文件路由约定加载。
 */
"use client";
import Link from "next/link";
import {CostSummary} from "@/src/components/calls/CallCosts";
import {DataAccountFilter} from "@/src/components/shared/DataAccountFilter";
import {ModelUsageAlerts} from "@/src/components/dashboard/ModelUsageAlerts";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Users,
  PhoneOutgoing,
  MessageCircle,
  Clock3,
  Headset,
  ClipboardList,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Timer,
  Percent,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { RangeSwitcher } from "@/src/components/dashboard/RangeSwitcher";
import { VolumeChart } from "@/src/components/dashboard/VolumeChart";
import { RecentCallsTable } from "@/src/components/dashboard/RecentCallsTable";
import { BreakdownCharts } from "@/src/components/dashboard/BreakdownCharts";
import { useDashboardSummary } from "@/src/hooks/queries/dashboard";
import { dashboardCallsHref } from "@/src/components/dashboard/call-filter-links";
import { getApiErrorStateCopy } from "@/src/lib/api-error-state";
import type { DashboardRange } from "@/src/lib/api/resources/dashboard";
const taskLabels: Record<string, string> = {
  DRAFT: "草稿",
  UPLOADING: "上传中",
  UPLOADED: "已上传待启动",
  SUBMITTING: "启动处理中",
  SUBMITTED: "已提交",
  RUNNING: "执行中",
  PAUSED: "已暂停",
  COMPLETED: "已结束",
  STOPPED: "已停止",
  NEEDS_REVIEW: "待核对",
  FAILED: "失败",
};
const dateInput = (date: Date) =>
  new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const panel = "rounded-xl border bg-card";
const action =
  "text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export default function DashboardContent() {
  const [defaultDates] = useState(() => {
    const today = new Date();
    return {
      from: dateInput(new Date(today.getTime() - 6 * 86400000)),
      to: dateInput(today),
    };
  });
  const params = useSearchParams(),
    requested = params.get("range");
  const range: DashboardRange =
    requested === "24h" || requested === "30d" || requested === "custom"
      ? requested
      : "7d";
  const validDate = (value: string | null, fallback: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  const from =
    range === "custom"
      ? validDate(
          params.get("from"),
          defaultDates.from,
        )
      : undefined;
  const to =
    range === "custom"
      ? validDate(params.get("to"), defaultDates.to)
      : undefined;
  const { data, error, isError, isPending, isFetching, refetch } =
    useDashboardSummary({ range, from, to,ownerId:params.get('ownerId')||'mine' });
  const op = data?.operations;
  const customerScope = op?.customerScope || 'mine';
  const customerScopeLabel = customerScope === 'all' ? '全部客户' : '我的客户';
  const outboundHref='/outbound?ownerId='+encodeURIComponent(params.get('ownerId')||'mine');
  const customersHref = `/crm/companies?scope=${customerScope}`;
  const running = ["SUBMITTED", "RUNNING"].reduce(
    (n, s) => n + (op?.taskCounts[s] ?? 0),
    0,
  );
  const reviews = ["NEEDS_REVIEW", "FAILED", "SUBMITTING", "UPLOADING"].reduce(
    (n, s) => n + (op?.taskCounts[s] ?? 0),
    0,
  );
  const callLink = (status?: "COMPLETED" | "FAILED" | "NOT_ANSWERED") =>
    dashboardCallsHref({
      ownerId:params.get('ownerId')||'mine',
      range,
      from: data?.period.from ?? from,
      to: data
        ? new Date(new Date(data.period.to).getTime() - 1).toISOString()
        : to,
      status,
    });
  const cards = [
    {
      label: "通话总量",
      value: data?.totals.calls ?? 0,
      hint: "所选期间的通话记录",
      href: callLink(),
      icon: PhoneCall,
    },
    {
      label: "已接通",
      value: data?.totals.connectedCalls ?? 0,
      hint: "客户已接听的通话",
      href: callLink("COMPLETED"),
      icon: PhoneOutgoing,
    },
    {
      label: "接通率",
      value: data?.totals.calls
        ? `${Math.round(data.totals.successRate * 100)}%`
        : "—",
      hint: "已接通 / 已结束通话",
      href: callLink(),
      icon: Percent,
    },
    {
      label: "通话时长",
      value: data?.totals.minutes ?? 0,
      hint: "累计通话分钟",
      href: callLink(),
      icon: Clock3,
    },
    {
      label: "未接通",
      value: data?.totals.missedCalls ?? 0,
      hint: "客户未接听的通话",
      href: callLink("NOT_ANSWERED"),
      icon: PhoneMissed,
    },
    {
      label: "失败通话",
      value: data?.totals.failedCalls ?? 0,
      hint: "拨打失败的通话",
      href: callLink("FAILED"),
      icon: PhoneOff,
    },
  ];
  const errorCopy = isError
    ? getApiErrorStateCopy(error, { resourceName: "仪表盘" })
    : null;
  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 title="按北京时间统计" className="text-xl font-semibold tracking-tight">通话概览</h1>

        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataAccountFilter/>
          <ModelUsageAlerts/>
          <RangeSwitcher
            key={`${range}-${from}-${to}`}
            current={range}
            customFrom={from}
            customTo={to}
            loading={isFetching}
          />
        </div>
      </header>
      {isError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">
            {data ? "刷新未成功，以下为上次数据" : errorCopy?.title}
          </p>
          <p className="mt-1 text-muted-foreground">{errorCopy?.description}</p>
        </div>
      )}
      {!data && !isPending ? (
        <Button variant="outline" onClick={() => void refetch()}>
          重新加载
        </Button>
      ) : (
        <>
          <section
            aria-label="通话核心指标"
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
          >
            {cards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                title={card.hint}
                className={`${panel} px-4 py-4 transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">
                    {card.label}
                  </span>
                  <card.icon className="size-4 text-primary/70" />
                </div>
                {data ? (
                  <p className="mt-3 text-2xl font-semibold tabular-nums">
                    {card.value}
                    {card.label === "通话时长" && <span className="ml-1 text-xs font-normal text-muted-foreground">分钟</span>}
                  </p>
                ) : (
                  <Skeleton className="my-3 h-8 w-16" />
                )}

              </Link>
            ))}
          </section>
          <CostSummary costs={data?.costs}/>
          <VolumeChart summary={data} range={range} loading={!data} />
          <BreakdownCharts
            summary={data}
            range={range}
            customFrom={data?.period.from ?? from}
            customTo={
              data
                ? new Date(new Date(data.period.to).getTime() - 1).toISOString()
                : to
            }
            loading={!data}
          />
          <RecentCallsTable summary={data} loading={!data} />
          <section className={panel} aria-label="需要处理">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">需要处理</h2>
                
              </div>
              <Link href={customersHref} className={action}>
                查看客户库
              </Link>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y md:grid-cols-4 md:divide-y-0">
              {[
                {
                  title: "人工接管",
                  count: op?.handoffs,
                  detail: "等待人工",
                  href: "/tools?tab=handoff&view=company&filter=pending",
                  icon: Headset,
                },
                {
                  title: "有意向客户",
                  count: op?.interested,
                  detail: customerScopeLabel,
                  href: `${customersHref}&intent=interested`,
                  icon: Users,
                },
                {
                  title: "自动化待办",
                  count: op?.todos,
                  detail: "当前账号",
                  href: "/automation",
                  icon: ClipboardList,
                },
                {
                  title: "任务待核对",
                  count: reviews,
                  detail: "失败或处理中",
                  href: outboundHref,
                  icon: PhoneOutgoing,
                },
              ].map((row) => (
                <Link
                  key={row.title}
                  href={row.href}
                  className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <row.icon className="size-4 shrink-0 text-primary/75" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {row.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {row.detail}
                    </span>
                  </span>
                  <strong className="text-xl tabular-nums">
                    {data ? (row.count ?? 0) : "—"}
                  </strong>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              已登记拒绝联系 {data ? op?.optOuts : "—"}{" "}
              条；不计入待加微信和人工接管。
            </p>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={panel}>
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-sm font-semibold">最近外呼任务</h2>
                <Link href={outboundHref} className={action}>
                  管理任务
                </Link>
              </div>
              <div className="divide-y px-5">
                {!data ? (
                  <Skeleton className="my-4 h-24" />
                ) : !op?.latestTasks.length ? (
                  <div className="py-6">
                    <p className="text-sm text-muted-foreground">
                      尚未创建外呼任务。
                    </p>
                    <Link
                      href={outboundHref}
                      className={`mt-3 inline-block ${action}`}
                    >
                      创建外呼任务
                    </Link>
                  </div>
                ) : (
                  op.latestTasks.map((task) => (
                    <Link
                      key={`${task.provider || 'ALIYUN'}-${task.id}`}
                      href={outboundHref}
                      className="flex items-start justify-between gap-3 py-3 hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {task.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {displayTime(task.createdAt)} ·{" "}
                          {task.provider === 'HAOKEHU_SIP'
                            ? task.updatedAt ? `最近更新 ${displayTime(task.updatedAt)}` : '—'
                            : task.syncedAt
                            ? `结果同步 ${displayTime(task.syncedAt)}`
                            : "尚无结果同步"}
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs">
                        {taskLabels[task.status] || "未知状态"}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </section>
            <section className={panel}>
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h2 className="text-sm font-semibold">业务入口</h2>
                <Link href="/agents" className={action}>
                  管理数字员工
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5">
                {[
                  {
                    label: "执行中任务",
                    value: running,
                    href: outboundHref,
                    icon: PhoneOutgoing,
                  },
                  {
                    label: "平均通话时长",
                    value: `${data?.totals.avgDurationSeconds ?? 0} 秒`,
                    href: callLink(),
                    icon: Timer,
                  },
                  {
                    label: `客户库 · ${customerScopeLabel}`,
                    value: op?.contacts ?? 0,
                    href: customersHref,
                    icon: Users,
                  },
                  {
                    label: `已加微信 · ${customerScopeLabel}`,
                    value: op?.added ?? 0,
                    href: `${customersHref}&intent=interested&wechatAdded=true`,
                    icon: MessageCircle,
                  },
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-3 hover:bg-muted/60"
                  >
                    <item.icon className="size-4 text-muted-foreground" />
                    <span className="flex-1 text-xs text-muted-foreground">
                      {item.label}
                    </span>
                    <strong className="text-sm tabular-nums">
                      {data ? item.value : "—"}
                    </strong>
                  </Link>
                ))}
              </div>
            </section>
          </div>
          {data && (
            <p className="text-right text-xs text-muted-foreground">
              数据更新于 {displayTime(data.generatedAt)} · 每分钟刷新
            </p>
          )}
        </>
      )}
    </div>
  );
}
