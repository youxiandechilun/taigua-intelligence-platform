/*
 * 中文导读：工具管理的 AdvancedTools 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { Webhook, Plus } from "lucide-react";
import { PageHeader } from "@/src/components/common/PageHeader";
import { EmptyState } from "@/src/components/common/EmptyState";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Button } from "@/src/components/ui/button";
import { ToolCard } from "@/src/components/tools/ToolCard";
import { ToolSheet } from "@/src/components/tools/ToolSheet";
import { McpConnectionsList } from "@/src/components/tools/McpConnectionsList";
import { McpMarketplace } from "@/src/components/tools/McpMarketplace";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { useTools } from "@/src/hooks/queries/tools";

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card px-5 py-4">
      <Skeleton className="size-11 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full max-w-md" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="size-8 shrink-0 rounded-md" />
    </div>
  );
}

export function AdvancedTools() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: tools, isLoading } = useTools();

  const addButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      添加工具
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="高级工具配置"
        actions={addButton}
      />

      <Tabs defaultValue="http" className="space-y-4">
        <TabsList>
          <TabsTrigger value="http">HTTP 工具</TabsTrigger>
          <TabsTrigger value="marketplace">MCP 市场</TabsTrigger>
          <TabsTrigger value="connections">已连接的 MCP</TabsTrigger>
        </TabsList>

        <TabsContent value="http" className="mt-0">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : !tools?.length ? (
            <EmptyState
              icon={Webhook}
              title="还没有工具"
              description="配置外部接口，完成阿里云执行适配后才能用于通话。"
              action={addButton}
            />
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <ToolCard key={tool.toolId} tool={tool} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-0">
          <McpMarketplace />
        </TabsContent>

        <TabsContent value="connections" className="mt-0">
          <McpConnectionsList />
        </TabsContent>
      </Tabs>

      <ToolSheet mode="create" open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
