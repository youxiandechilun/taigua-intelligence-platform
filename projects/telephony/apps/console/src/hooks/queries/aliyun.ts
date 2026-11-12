/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/src/lib/auth-client";
import { aliyunApi } from "@/src/lib/api/resources/aliyun";
export function useAliyunIdentity() {
  const { data: session } = authClient.useSession();
  return {
    org: session?.session.activeOrganizationId || "",
    user: session?.user.id || "",
  };
}
export function useAliyunConfig() {
  const { org, user } = useAliyunIdentity();
  return useQuery({
    queryKey: ["aliyun", "connection", user, org],
    queryFn: () => aliyunApi.configFor(org),
    enabled: !!org,
    staleTime: 30000,
  });
}
export function useAliyunTasks() {
  const { org, user } = useAliyunIdentity();
  return useQuery({
    queryKey: ["aliyun", "tasks", user, org],
    queryFn: () => aliyunApi.tasksFor(org),
    enabled: !!org,
    staleTime: 15000,
    refetchInterval: 15000,
  });
}
export function useAliyunAgentStatus(id: string) {
  const { org, user } = useAliyunIdentity();
  return useQuery({
    queryKey: ["aliyun", "agent-status", user, org, id],
    queryFn: () => aliyunApi.agentStatus(id, org),
    enabled: !!org && !!id,
    refetchInterval: 15000,
  });
}
export function useAliyunAgentCloud(id: string) {
  const { org, user } = useAliyunIdentity();
  return useQuery({
    queryKey: ["aliyun", "agent-cloud", user, org, id],
    queryFn: () => aliyunApi.agentCloud(id, org),
    enabled: false,
    retry: false,
  });
}

export function useAliyunAgentResults(id: string) {
  const { org, user } = useAliyunIdentity();
  return useQuery({
    queryKey: ["aliyun", "agent-results", user, org, id],
    queryFn: () => aliyunApi.agentResults(id, org),
    enabled: !!org && !!id,
    refetchInterval: 15000,
    retry: false,
  });
}
