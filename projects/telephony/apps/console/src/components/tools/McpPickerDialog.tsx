/*
 * 中文导读：工具管理的 McpPickerDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import { Loader2, PlugZap } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { useAttachMcpConnection, useMcpConnections } from "@/src/hooks/queries/mcp";
import type { AgentMcpConnection } from "@/src/lib/api/types";

export function McpPickerDialog({
  agentId,
  attachedConnections,
  open,
  onOpenChange,
}: {
  agentId: string;
  attachedConnections: AgentMcpConnection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: connections = [], isLoading } = useMcpConnections();
  const attach = useAttachMcpConnection(agentId);
  const attachedIds = new Set(attachedConnections.map((item) => item.mcpConnectionId));
  const available = connections.filter((connection) => !attachedIds.has(connection.mcpConnectionId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加 MCP 连接</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">正在加载连接…</p>
          ) : !available.length ? (
            <p className="text-sm text-muted-foreground">
              暂无可用 MCP 连接，请先在工具市场中连接服务。
            </p>
          ) : (
            available.map((connection) => (
              <div key={connection.mcpConnectionId} className="flex items-center gap-3 border p-3">
                <div className="flex size-9 shrink-0 items-center justify-center border bg-primary/10 text-primary">
                  <PlugZap className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{connection.displayName}</p>
                    <Badge variant={connection.status === "CONNECTED" ? "secondary" : "outline"}>
                      {uiLabel(connection.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {(connection.tools?.length ?? 0)} 个工具 · {connection.mcpUrl}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={connection.status !== "CONNECTED" || attach.isPending}
                  onClick={() =>
                    attach.mutate(connection.mcpConnectionId, {
                      onSuccess: () => onOpenChange(false),
                    })
                  }
                >
                  {attach.isPending && attach.variables === connection.mcpConnectionId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}
                  关联
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
