/*
 * 中文导读：数字员工关联知识库的界面。
 */
"use client";

import { WorkspaceKnowledge } from "../kb/WorkspaceKnowledge";

export function AgentKnowledgePanel({ agentId }: { agentId: string }) {
  return <section className="space-y-4" aria-label="员工业务知识">
    <p className="text-sm leading-6 text-muted-foreground">这里管理企业共享和适用于当前员工的业务资料。开场白、沟通步骤及异议回应在“话术设计”中设置。</p>
    <WorkspaceKnowledge agentId={agentId} compact title="业务资料" />
  </section>;
}
