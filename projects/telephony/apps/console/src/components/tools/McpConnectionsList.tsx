/*
 * 中文导读：工具管理的 McpConnectionsList 组件，封装该界面的展示与交互。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import { AlertCircle, ExternalLink, Loader2, RefreshCw, ServerCrash, Trash2 } from "lucide-react";
import { McpToolBadges } from "@/src/components/tools/McpToolBadges";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog";
import {
  useDisconnectMcpConnection,
  useMcpConnections,
  useOpenMcpSetup,
  useRefreshMcpConnection,
} from "@/src/hooks/queries/mcp";
import type { McpConnectionStatus } from "@/src/lib/api/types";

const STATUS_CLASS: Record<McpConnectionStatus, string> = {
  CONNECTED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  AUTH_REQUIRED: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  INPUT_REQUIRED: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ERROR: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  DISCONNECTED: "bg-muted text-muted-foreground",
};

const hasMissingGoogleDriveScope = (metadata?: Record<string, unknown> | null) =>
  metadata?.scopeIssue === "missing_google_drive_scope";

export function McpConnectionsList() {
  const { data: connections = [], isLoading } = useMcpConnections();
  const refresh = useRefreshMcpConnection();
  const disconnect = useDisconnectMcpConnection();
  const openMcpSetup = useOpenMcpSetup();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
    );
  }

  if (!connections.length) {
    return (
      <EmptyState
        icon={ServerCrash}
        title="没有 MCP 连接"
      />
    );
  }

  return (
    <div className="space-y-3">
      {connections.map((connection) => {
        const missingGoogleDriveScope = hasMissingGoogleDriveScope(connection.metadata);
        return (
          <div key={connection.mcpConnectionId} className="border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{connection.displayName}</p>
                  <Badge className={STATUS_CLASS[connection.status]}>
                    {missingGoogleDriveScope ? "尚未授予云端硬盘访问权限" : uiLabel(connection.status)}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{connection.mcpUrl}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(connection.tools?.length ?? 0)} 个工具已同步
                  {connection.lastSyncedAt ? `— 最近同步时间${new Date(connection.lastSyncedAt).toLocaleString("zh-CN")}` : ""}
                </p>
                {missingGoogleDriveScope && (
                  <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                    请在 Google 授权页面勾选云端硬盘访问权限后继续。
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {connection.setupUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openMcpSetup(connection.setupUrl as string, connection.mcpConnectionId)}
                  >
                    <ExternalLink className="size-4" />
                    {missingGoogleDriveScope ? "重新授权" : "设置"}
                  </Button>
                )}
                {!connection.setupUrl && ["ERROR", "DISCONNECTED"].includes(connection.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={refresh.isPending && refresh.variables === connection.mcpConnectionId}
                    onClick={() => {
                      refresh.mutate(connection.mcpConnectionId, {
                        onSuccess: (updated) => {
                          if (updated.setupUrl) {
                            openMcpSetup(updated.setupUrl, updated.mcpConnectionId);
                          }
                        },
                      });
                    }}
                  >
                    {refresh.isPending && refresh.variables === connection.mcpConnectionId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <AlertCircle className="size-4" />
                    )}
                    {missingGoogleDriveScope ? "重新授权" : "重试设置"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refresh.isPending && refresh.variables === connection.mcpConnectionId}
                  onClick={() => refresh.mutate(connection.mcpConnectionId)}
                >
                  {refresh.isPending && refresh.variables === connection.mcpConnectionId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  刷新
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={disconnect.isPending && disconnect.variables === connection.mcpConnectionId}
                    >
                      {disconnect.isPending && disconnect.variables === connection.mcpConnectionId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      断开连接
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>断开 MCP 连接？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作将移除 <span className="font-medium">{connection.displayName}</span> ，并解除其与所有智能体的关联。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => disconnect.mutate(connection.mcpConnectionId)}
                      >
                        断开连接
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <McpToolBadges tools={connection.tools} />
          </div>
        );
      })}
    </div>
  );
}
