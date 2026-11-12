/*
 * 中文导读：数字员工与话术的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import { Bot, RefreshCw } from "lucide-react";
import { PageHeader } from "@/src/components/common/PageHeader";
import { EmptyState } from "@/src/components/common/EmptyState";
import { Button } from "@/src/components/ui/button";
import { AgentStudio } from "@/src/components/agents/AgentStudio";
import { AgentsTable } from "@/src/components/agents/AgentsTable";
import { NewAgentDialog } from "@/src/components/agents/NewAgentDialog";
import { useAgents } from "@/src/hooks/queries/agents";
import { useCompanyContext } from "@/src/lib/api/resources/company";

export default function AgentsPage() {
  const company = useCompanyContext();
  const canManage = company.data?.permissions.agentConfiguration?.includes('update')===true||company.data?.permissions.agentConfiguration?.includes('publish')===true;
  const {
    data: agents = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useAgents();

  return (
    <div className="flex flex-1 flex-col gap-6">
      {(isError||isLoading)&&<PageHeader
        title="数字员工"
        actions={company.data?.canCreateAgents===true ? <NewAgentDialog /> : undefined}
      />}

      {isError ? (
        <EmptyState
          icon={Bot}
          title="无法加载数字员工"
          description="请刷新数字员工列表，或检查网络连接后重试。"
          action={
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : undefined} />
              重试
            </Button>
          }
        />
      ) : !isLoading ? (
        <AgentStudio agents={agents} canManage={canManage} actions={company.data?.canCreateAgents===true?<NewAgentDialog/>:undefined} />
      ) : (
        <AgentsTable agents={agents} isLoading={isLoading} canManage={canManage} />
      )}
    </div>
  );
}
