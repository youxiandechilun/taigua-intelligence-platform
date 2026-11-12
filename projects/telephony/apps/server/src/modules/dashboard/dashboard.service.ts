/*
 * 中文导读：数据看板：dashboard.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { withCallCosts, sumCallCosts } from '../billing/call-costs.js';
import type { CallWithDisplayStatus } from '../calllogs/call-display-status.js';
import {grants} from '../workspace/company-policy.js';
import { CallStatus } from "../../../prisma/generated/prisma/client.js";
import * as dashboardRepository from "./dashboard.repository.js";
import { companyContext } from "../workspace/company-access.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { getConnection } from "../aliyun/aliyun.service.js";
import { crmDb } from "../crm/crm.db.js";
import { withCurrentAgentNames } from "../agent/agent-display-name.js";
import type {
  DashboardRange,
  DashboardSummaryArgs,
} from "./dashboard.schema.js";

type AnalyticsCall = CallWithDisplayStatus<Awaited<
  ReturnType<typeof dashboardRepository.listAnalyticsCalls>
>[number]>;

type Bucket = {
  t: string;
  calls: number;
  minutes: number;
  completed: number;
  failed: number;
  missed: number;
  successRate: number;
};

import { CALL_REVIEW_STATUS, withCallDisplayStatus } from '../calllogs/call-display-status.js'; const STATUSES = [
  CallStatus.COMPLETED,
  CallStatus.FAILED,
  CallStatus.NOT_ANSWERED,
  CallStatus.IN_PROGRESS,
  CallStatus.SCHEDULED,
   CallStatus.PROCESSED,
   CALL_REVIEW_STATUS,
];

function diffDays(start: Date, end: Date) {
  return Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  );
}

function rangeConfig(args: DashboardSummaryArgs) {
  const currentTime = new Date();

  if (args.range === "custom" && args.from && args.to) {
    const start = floorDay(args.from);
    const inclusiveEnd = floorDay(args.to);
    const end = new Date(inclusiveEnd);
    end.setUTCDate(end.getUTCDate() + 1);
    const queryEnd = end > currentTime ? currentTime : end;
    const days = diffDays(start, end);
    const previousStart = new Date(start);
    previousStart.setUTCDate(previousStart.getUTCDate() - days);

    return {
      now: queryEnd,
      start,
      end,
      previousStart,
      bucket: "day" as const,
      count: days,
    };
  }

  if (args.range === "24h") {
    const end = floorHour(currentTime);
    end.setUTCHours(end.getUTCHours() + 1);
    const start = new Date(end);
    start.setUTCHours(start.getUTCHours() - 24);
    const previousStart = new Date(start);
    previousStart.setUTCHours(previousStart.getUTCHours() - 24);
    return {
      now: currentTime,
      start,
      end,
      previousStart,
      bucket: "hour" as const,
      count: 24,
    };
  }

  const days = args.range === "7d" ? 7 : 30;
  const start = floorDay(currentTime);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const end = new Date(floorDay(currentTime));
  end.setUTCDate(end.getUTCDate() + 1);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return {
    now: currentTime,
    start,
    end,
    previousStart,
    bucket: "day" as const,
    count: days,
  };
}

function floorHour(date: Date) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function floorDay(date: Date) {
  const offset = 8 * 60 * 60 * 1000;
  const d = new Date(date.getTime() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - offset);
}

function bucketKey(date: Date, bucket: "hour" | "day") {
  return (bucket === "hour" ? floorHour(date) : floorDay(date)).toISOString();
}

function buildBuckets(start: Date, count: number, bucket: "hour" | "day") {
  const buckets: Bucket[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start.getTime() + i * (bucket === "hour" ? 3600000 : 86400000));
    buckets.push({
      t: d.toISOString(),
      calls: 0,
      minutes: 0,
      completed: 0,
      failed: 0,
      missed: 0,
      successRate: 0,
    });
  }
  return buckets;
}

function summarize(calls: AnalyticsCall[]) {
  const totalCalls = calls.length;
  const totalSeconds = calls.reduce(
    (sum, call) => sum + (call.durationSeconds ?? 0),
    0
  );
  const completed = calls.filter((call) => call.status === CallStatus.COMPLETED)
    .length;
  const failed = calls.filter((call) => call.status === CallStatus.FAILED).length;
  const missed = calls.filter((call) => call.status === CallStatus.NOT_ANSWERED)
    .length;
  const connectedSeconds = calls.filter(call => call.status === CallStatus.COMPLETED)
    .reduce((sum, call) => sum + (call.durationSeconds ?? 0), 0);
  const ended = completed + failed + missed;

  return {
    calls: totalCalls,
    minutes: Math.round(totalSeconds / 6) / 10,
    connectedCalls: completed,
    avgDurationSeconds: completed ? Math.round(connectedSeconds / completed) : 0,
    successRate: ended ? completed / ended : 0,
    failedCalls: failed,
    missedCalls: missed,
  };
}

function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

function buildSeries(calls: AnalyticsCall[], range: ReturnType<typeof rangeConfig>) {
  const buckets = buildBuckets(range.start, range.count, range.bucket);
  const map = new Map(buckets.map((bucket) => [bucket.t, bucket]));

  for (const call of calls) {
    if (!call.startTime) continue;
    const key = bucketKey(call.startTime, range.bucket);
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.minutes += (call.durationSeconds ?? 0) / 60;
    if (call.status === CallStatus.COMPLETED) bucket.completed += 1;
    if (call.status === CallStatus.FAILED) bucket.failed += 1;
    if (call.status === CallStatus.NOT_ANSWERED) bucket.missed += 1;
  }

  return buckets.map((bucket) => ({
    ...bucket,
    minutes: Math.round(bucket.minutes * 10) / 10,
    successRate: bucket.calls ? bucket.completed / bucket.calls : 0,
  }));
}

function buildStatusBreakdown(calls: AnalyticsCall[]) {
  return STATUSES.map((status) => ({
    status,
    count: calls.filter((call) => call.status === status).length,
  }));
}

function buildDirectionBreakdown(calls: AnalyticsCall[]) {
  const inbound = calls.filter((call) => call.direction === "inbound").length;
  const outbound = calls.filter((call) => call.direction === "outbound").length;
  const unknown = calls.length - inbound - outbound;
  return [
    { direction: "inbound", count: inbound },
    { direction: "outbound", count: outbound },
    { direction: "unknown", count: unknown },
  ];
}

function buildTopAgents(calls: AnalyticsCall[]) {
  const map = new Map<
    string | null,
    { agentId: string | null; calls: number; minutes: number; completed: number }
  >();

  for (const call of calls) {
    const bucket = map.get(call.agentId) ?? {
      agentId: call.agentId,
      calls: 0,
      minutes: 0,
      completed: 0,
    };
    bucket.calls += 1;
    bucket.minutes += Math.round((call.durationSeconds ?? 0) / 60);
    if (call.status === CallStatus.COMPLETED) bucket.completed += 1;
    map.set(call.agentId, bucket);
  }

  return Array.from(map.values())
    .map((agent) => ({
      agentId: agent.agentId,
      calls: agent.calls,
      minutes: agent.minutes,
      successRate: agent.calls ? agent.completed / agent.calls : 0,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5);
}

export const getDashboardSummary = async (args: DashboardSummaryArgs) => {
  // Company-wide operational counts use the same manager boundary as company customers.
  const access = await companyContext(args.organizationId, args.userId);
  if (!grants(access.permissions,"callLogs","read")) throw new ForbiddenError("当前角色未授权通话仪表盘。");
  const range = rangeConfig(args);
  const generatedAt = new Date();
  const [analyticsCalls, recent, operations, cloud] = await Promise.all([
    dashboardRepository.listAnalyticsCalls({
      organizationId: args.organizationId,
      viewerId:args.userId,
      ownerId:args.ownerId,
      from: range.previousStart,
      to: range.now,
    }),
    dashboardRepository.listRecentCalls(args.organizationId, range.start, range.now,args.userId,args.ownerId||'mine'),
    dashboardRepository.operationalSummary(args.organizationId, args.userId, range.start, range.now,args.ownerId||'mine'),
    getConnection(args.organizationId),
  ]);

  const displayed = await withCallDisplayStatus(crmDb, args.organizationId, [...analyticsCalls, ...recent]);
  const displayedAnalytics = displayed.slice(0, analyticsCalls.length);
  const displayedRecent = displayed.slice(analyticsCalls.length);
  const currentCalls = displayedAnalytics.filter(
    (call) => call.startTime && call.startTime >= range.start
  );
  const previousCalls = displayedAnalytics.filter(
    (call) => call.startTime && call.startTime < range.start
  );

  const costCalls = await withCallCosts(crmDb, args.organizationId, currentCalls);
  const costById = new Map(costCalls.map(c => [c.callId, c.cost]));
  const totals = summarize(currentCalls);
  const previous = summarize(previousCalls);

  return {
    generatedAt: generatedAt.toISOString(),
    ownerId:args.ownerId||'mine',
    timezone: "Asia/Shanghai",
    operations,
    connection: {
      product: cloud.product,
      hasAccessKey: cloud.hasAccessKey,
      hasDashscopeKey: cloud.hasDashscopeKey,
      callerNumberCount: cloud.callerNumbers.length,
      ready: cloud.ready,
      liveEnabled: cloud.liveEnabled,
      callbackReady: cloud.callbackReady,
      missing: cloud.missing,
      boundAgents: operations.agents.filter(agent => cloud.product === "aiccs"
        ? Boolean(cloud.communicationBindings[agent.agentId] || cloud.communicationAgentId)
        : Boolean(cloud.bindings[agent.agentId] || cloud.defaultScriptId)).length,
    },
    range: args.range,
    period: {
      from: range.start.toISOString(),
      to: range.now.toISOString(),
      previousFrom: range.previousStart.toISOString(),
      previousTo: range.start.toISOString(),
    },
    totals,
    costs: sumCallCosts(costCalls),
    deltas: {
      calls: delta(totals.calls, previous.calls),
      connectedCalls: delta(totals.connectedCalls, previous.connectedCalls),
      minutes: delta(totals.minutes, previous.minutes),
      avgDurationSeconds: delta(
        totals.avgDurationSeconds,
        previous.avgDurationSeconds
      ),
      successRate: delta(totals.successRate, previous.successRate),
      failedCalls: delta(totals.failedCalls, previous.failedCalls),
      missedCalls: delta(totals.missedCalls, previous.missedCalls),
    },
    series: buildSeries(currentCalls, range),
    statusBreakdown: buildStatusBreakdown(currentCalls),
    directionBreakdown: buildDirectionBreakdown(currentCalls),
    topAgents: buildTopAgents(currentCalls),
    recent: await withCurrentAgentNames(crmDb, args.organizationId, displayedRecent.map(call => ({...call, cost:costById.get(call.callId)}))),
  };
};
