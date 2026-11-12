/*
 * 中文导读：数据看板的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient } from "@/src/lib/api/client";
import type { ApiEnvelope, CallLog, CallStatus, CostTotals } from "@/src/lib/api/types";

export type DashboardRange = "24h" | "7d" | "30d" | "custom";

export interface DashboardTotals {
  calls: number;
  connectedCalls: number;
  minutes: number;
  avgDurationSeconds: number;
  successRate: number;
  failedCalls: number;
  missedCalls: number;
}

export interface DashboardSeriesPoint {
  t: string;
  calls: number;
  minutes: number;
  completed: number;
  failed: number;
  missed: number;
  successRate: number;
}

export interface StatusBreakdownPoint {
  status: CallStatus;
  count: number;
}

export interface DirectionBreakdownPoint {
  direction: "inbound" | "outbound" | "unknown";
  count: number;
}

export interface AgentBucket {
  agentId: string | null;
  calls: number;
  minutes: number;
  successRate: number;
}

export interface DashboardSummary {
  costs?: CostTotals;
  ownerId?:string;
  generatedAt: string;
  timezone: string;
  operations: {
    agents: { agentId: string; name: string; avatar: string | null; isActive: boolean; isConfigured: boolean }[];
    taskCounts: Record<string, number>;
    latestTasks: { id: string; name: string; status: string; createdAt: string; syncedAt: string | null; provider?: 'ALIYUN' | 'HAOKEHU_SIP'; updatedAt?: string | null }[];
    contacts: number;
    newContacts: number;
    interested: number;
    customerScope: 'mine' | 'all';
    pending: number;
    added: number;
    sent: number;
    handoffs: number;
    optOuts: number;
    todos: number;
  };
  connection: {
    product: string;
    hasAccessKey: boolean;
    hasDashscopeKey: boolean;
    callerNumberCount: number;
    ready: boolean;
    liveEnabled: boolean;
    callbackReady: boolean;
    missing: string[];
    boundAgents: number;
  };
  range: DashboardRange;
  period: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
  };
  totals: DashboardTotals;
  deltas: DashboardTotals;
  series: DashboardSeriesPoint[];
  statusBreakdown: StatusBreakdownPoint[];
  directionBreakdown: DirectionBreakdownPoint[];
  topAgents: AgentBucket[];
  recent: CallLog[];
}

export interface DashboardSummaryParams {
  ownerId?:string;
  range: DashboardRange;
  from?: string;
  to?: string;
}

export async function getDashboardSummary(
  params: DashboardSummaryParams
): Promise<DashboardSummary> {
  const res = await apiClient.get<ApiEnvelope<DashboardSummary>>(
    "/dashboard/summary",
    { params }
  );
  return res.data.data;
}
