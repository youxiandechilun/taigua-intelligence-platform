/*
 * 中文导读：共享基础能力：query-cache.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { QueryClient } from "@tanstack/react-query";

type SessionIdentity = {
  user?: { id?: string | null } | null;
  session?: { activeOrganizationId?: string | null } | null;
} | null;

export function queryCacheIdentity(
  session: SessionIdentity | undefined,
  isPending: boolean,
) {
  if (isPending) return "pending";
  const userId = session?.user?.id;
  if (!userId) return "anonymous";
  return `user:${userId}:org:${session?.session?.activeOrganizationId ?? "none"}`;
}

export function clearIdentityCache(queryClient: QueryClient) {
  queryClient.clear();
}
