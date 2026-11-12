/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";
import { mcpApi, type ConnectMcpInput, type McpCatalogParams } from "@/src/lib/api/resources/mcp";
import { queryKeys } from "@/src/lib/query-keys";

const isSafeSetupUrl = (setupUrl: string) => {
  try {
    const url = new URL(setupUrl);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

const openSetupAndPoll = (
  setupUrl: string,
  mcpConnectionId: string,
  qc: ReturnType<typeof useQueryClient>
) => {
  if (!isSafeSetupUrl(setupUrl)) {
    toast.error("设置网址无效，或使用了不支持的协议。");
    return;
  }

  window.open(setupUrl, "_blank", "noopener,noreferrer");
  toast.info("请在新标签页中完成设置，泰卦电销智能体 将自动刷新。");
  let attempts = 0;
  const maxAttempts = 24;
  const intervalId = window.setInterval(refresh, 5000);
  async function refresh() {
    attempts += 1;
    try {
      const connection = await mcpApi.refresh(mcpConnectionId);
      qc.invalidateQueries({ queryKey: queryKeys.mcp.all });
      qc.invalidateQueries({ queryKey: queryKeys.mcp.connections() });
      if (connection.status === "CONNECTED") {
        window.clearInterval(intervalId);
        window.removeEventListener("focus", refresh);
        toast.success(`${connection.displayName}已连接`);
      }
    } catch {
      // Keep polling while Smithery is still settling after OAuth.
    }

    if (attempts >= maxAttempts) {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    }
  }

  window.addEventListener("focus", refresh);
};

export function useMcpCatalog(params: McpCatalogParams = {}) {
  return useQuery({
    queryKey: queryKeys.mcp.catalog(params),
    queryFn: () => mcpApi.catalog(params),
    retry: false,
  });
}

export function useMcpConnections() {
  return useQuery({
    queryKey: queryKeys.mcp.connections(),
    queryFn: () => mcpApi.connections(),
  });
}

export function useAgentMcpConnections(agentId: string) {
  return useQuery({
    queryKey: queryKeys.mcp.agentConnections(agentId),
    queryFn: () => mcpApi.agentConnections(agentId),
    enabled: !!agentId,
  });
}

export function useConnectMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectMcpInput) => mcpApi.connect(input),
    onSuccess: (connection) => {
      qc.invalidateQueries({ queryKey: queryKeys.mcp.all });
      qc.invalidateQueries({ queryKey: queryKeys.mcp.connections() });
      if (connection.setupUrl) {
        toast.info("需要完成设置，请点击“设置”按钮继续。");
        return;
      }
      toast.success("MCP 连接已创建");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法连接 MCP 服务");
    },
  });
}

export function useOpenMcpSetup() {
  const qc = useQueryClient();
  return (setupUrl: string, mcpConnectionId: string) => {
    if (typeof window === "undefined") return;
    openSetupAndPoll(setupUrl, mcpConnectionId, qc);
  };
}

export function useRefreshMcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mcpConnectionId: string) => mcpApi.refresh(mcpConnectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcp.connections() });
      qc.invalidateQueries({ queryKey: queryKeys.mcp.all });
    },
    onError: (err: Error) => toast.error(err.message || "无法刷新 MCP 连接"),
  });
}

export function useDisconnectMcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mcpConnectionId: string) => mcpApi.disconnect(mcpConnectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcp.all });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      toast.success("MCP 连接已断开");
    },
    onError: (err: Error) => toast.error(err.message || "无法断开 MCP 连接"),
  });
}

export function useAttachMcpConnection(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mcpConnectionId: string) => mcpApi.attach(mcpConnectionId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcp.agentConnections(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.mcp.connections() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => toast.error(err.message || "无法关联 MCP 连接"),
  });
}

export function useDetachMcpConnection(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mcpConnectionId: string) => mcpApi.detach(mcpConnectionId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcp.agentConnections(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.mcp.connections() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => toast.error(err.message || "无法解除 MCP 关联"),
  });
}
