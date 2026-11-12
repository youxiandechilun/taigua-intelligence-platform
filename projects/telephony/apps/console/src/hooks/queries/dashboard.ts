/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getDashboardSummary,
  type DashboardSummaryParams,
} from "@/src/lib/api/resources/dashboard";
import { queryKeys } from "@/src/lib/query-keys";
import { authClient } from "@/src/lib/auth-client";

export function useDashboardSummary(params: DashboardSummaryParams) {
  const { data: session } = authClient.useSession();
  return useQuery({
    queryKey: [...queryKeys.dashboard.summary(params), session?.user.id, session?.session.activeOrganizationId],
    queryFn: () => getDashboardSummary(params),
    enabled: Boolean(session?.user.id && session?.session.activeOrganizationId),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
