/*
 * 中文导读：数字员工工作台的界面组织。
 */
"use client";
import {AgentAvailabilityControl} from "./AgentAvailabilityControl";
import {useCompanyContext} from "@/src/lib/api/resources/company";
import { AgentSyncSettings } from "./AgentSyncSettings";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Bot, LayoutGrid, List, Search, Pencil, AudioLines, Settings2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { EmptyState } from "@/src/components/common/EmptyState";
import type { Agent } from "@/src/lib/api/types";
import { AgentSortProvider, AgentSortHandle, useAgentSortItem, useAgentOrder } from "./AgentSorting";
import { AgentTestCallButton } from "./AgentTestCallButton";
import { AgentIdentity } from "./AgentIdentity";
import { AgentsTable } from "./AgentsTable";
import { agentSections, agentSectionHref } from "@/src/lib/agent-sections";

function AgentCard({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const sortProps = useAgentSortItem(agent.agentId);
  const summary = agent.studioSummary;
  return (
    <article {...sortProps} className="agent-sort-item group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40">
      <AgentSortHandle id={agent.agentId} name={agent.name} subtle />
      <div className="flex flex-1 items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <AgentIdentity agent={agent} large editable={false} description={summary?.description} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2"><AgentSyncSettings agentId={agent.agentId} agentName={agent.name}/>
          <AgentAvailabilityControl agent={agent}/>
        </div>
      </div>
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto px-5 pb-3 text-xs text-muted-foreground" aria-label="业务用途与数据">
        {(summary?.tags || ["业务沟通"]).map(tag => <span key={tag} className="shrink-0 whitespace-nowrap rounded-md bg-muted/50 px-2 py-1">{tag}</span>)}
        {canManage&&<span className="shrink-0 whitespace-nowrap rounded-md bg-muted/50 px-2 py-1">补充资料 {agent.knowledgeSourcesCount}</span>}
        <span className="shrink-0 whitespace-nowrap rounded-md bg-muted/50 px-2 py-1">通话记录 {agent.callLogsCount}</span>
      </div>
      <div className="mt-auto grid divide-x border-t text-xs" style={{gridTemplateColumns:`repeat(${agentSections.length+1}, minmax(0, 1fr))`}}>
        {agentSections.map(section => { const Icon = section.value === 'basic' ? Settings2 : section.value === 'script' ? Pencil : AudioLines; return <Link key={section.value} href={agentSectionHref(agent.agentId, section.value)} aria-label={`${section.label}：${agent.name}`} className="flex min-h-9 items-center justify-center gap-1.5 px-1 py-2 text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"><Icon aria-hidden="true" className="size-3.5"/>{section.label}</Link>; })}
        <AgentTestCallButton agentId={agent.agentId} agentName={agent.name} disabled={!agent.isActive} className="flex min-h-9 items-center justify-center gap-1.5 px-1 py-2 text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"/>
      </div>
    </article>
  );
}

export function AgentStudio({ agents, canManage = false, actions }: { agents: Agent[]; canManage?: boolean; actions?: ReactNode }) {
  const company=useCompanyContext();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "paused">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const { ordered, move, ready } = useAgentOrder(agents);
  const keyword = search.trim().toLocaleLowerCase();
  const visible = ordered.filter(agent => `${agent.name} ${agent.studioSummary?.description || ""} ${agent.studioSummary?.tags.join(" ") || ""}`.toLocaleLowerCase().includes(keyword) &&
    (filter === "all" || (filter === "enabled" ? agent.isActive : !agent.isActive)));
  const filters = [{ value: "all", label: "全部" }, { value: "enabled", label: "已启用" }, { value: "paused", label: "已暂停" }] as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b pb-4">
        <h1 className="whitespace-nowrap text-2xl font-semibold tracking-tight">数字员工</h1>
        <div aria-label="数字员工统计" className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>数字员工 <strong className="ml-1 text-sm font-semibold text-foreground">{agents.length}</strong></span>
          <span>已发布 <strong className="ml-1 text-sm font-semibold text-foreground">{agents.filter(agent=>agent.release?.version).length}</strong></span>
          <span>通话记录 <strong className="ml-1 text-sm font-semibold text-foreground">{agents.reduce((total,agent)=>total+agent.callLogsCount,0)}</strong></span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5" role="group" aria-label="数字员工状态筛选">
            {filters.filter(item=>company.data?.canCreateAgents||item.value!=="paused").map(item=><Button key={item.value} variant={filter===item.value?"secondary":"ghost"} size="sm" aria-pressed={filter===item.value} className={"h-8 px-2 text-xs "+(filter===item.value?"bg-primary/5 text-primary hover:bg-primary/10":"text-muted-foreground")} onClick={()=>setFilter(item.value)}>{item.label}</Button>)}
          </div>
          <div className="relative w-44 min-w-32 flex-1"><Search aria-hidden="true" className="absolute left-2.5 top-2 size-3.5 text-muted-foreground"/><Input className="h-8 pl-8 text-xs" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索姓名、岗位或职责" aria-label="搜索数字员工"/></div>
          {canManage&&<div className="flex gap-0.5 rounded-md border p-0.5" role="group" aria-label="显示方式">
            <Button size="icon" variant="ghost" className={`size-6 ${view==="grid"?"bg-primary/5 text-primary":"text-muted-foreground"}`} aria-label="卡片视图" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><LayoutGrid className="size-3.5"/></Button>
            <Button size="icon" variant="ghost" className={`size-6 ${view==="list"?"bg-primary/5 text-primary":"text-muted-foreground"}`} aria-label="列表视图" aria-pressed={view==="list"} onClick={()=>setView("list")}><List className="size-3.5"/></Button>
          </div>}
          {actions}
        </div>
      </header>
      <AgentSortProvider ids={visible.map(agent => agent.agentId)} disabled={!ready} onMove={(from, to) => move(from, to, visible.map(agent => agent.agentId))}>
      {!visible.length ? <EmptyState icon={Bot} title={agents.length ? "没有符合条件的数字员工" : company.data?.canCreateAgents ? "创建你的第一个数字员工" : "暂无可用的数字员工"} description={agents.length ? "可以调整搜索条件。" : company.data?.canCreateAgents ? "点击右上角新建数字员工，选择人物形象并配置沟通话术。" : "请联系公司管理员配置数字员工。"} className="rounded-xl" /> : view === "list" && canManage ? <AgentsTable agents={visible} isLoading={false} canManage={false} /> : <div className="grid auto-rows-auto gap-5 md:grid-cols-2 2xl:grid-cols-3">{visible.map(agent => <AgentCard key={agent.agentId} agent={agent} canManage={canManage} />)}</div>}
      </AgentSortProvider>
    </div>
  );
}
