/*
 * 中文导读：数字员工与话术的 AgentAvailabilityControl 组件，封装该界面的展示与交互。
 */
"use client";
import {useCompanyContext} from "@/src/lib/api/resources/company";
import {useUpdateAgent} from "@/src/hooks/queries/agents";
import {Button} from "../ui/button";
import {Pause, Play, Loader2} from "lucide-react";
import {toast} from "@/src/lib/toast";
import type {Agent} from "@/src/lib/api/types";

export function AgentAvailabilityControl({agent}:{agent:Agent}) {
  const company=useCompanyContext();
  const update=useUpdateAgent(agent.agentId);
  const active=agent.release?.isActive??agent.isActive;
  if(!company.data?.canCreateAgents)return <span className="text-xs text-muted-foreground">已启用</span>;
  return <div className="flex items-center gap-2" onClick={e=>e.stopPropagation()}>
    <span className={`text-xs ${active?'text-primary':'text-muted-foreground'}`}>{active?'已启用':'已暂停'}</span>
    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={update.isPending} aria-label={`${active?'暂停使用':'启用'}：${agent.name}`} onClick={()=>update.mutate({isActive:!active},{onSuccess:()=>toast.success(active?'已暂停，其他账号将隐藏该数字员工':'已启用，已授权账号可以使用')})}>
      {update.isPending?<Loader2 className="size-3 animate-spin"/>:active?<Pause className="size-3"/>:<Play className="size-3"/>}{active?'暂停使用':'启用'}
    </Button>
  </div>;
}
