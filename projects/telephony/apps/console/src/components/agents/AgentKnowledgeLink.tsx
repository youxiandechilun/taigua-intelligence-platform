/*
 * 中文导读：数字员工与话术的 AgentKnowledgeLink 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { apiClient, unwrap } from "@/src/lib/api/client";
import { Button } from "../ui/button";
import type { KnowledgeLibrary } from "../kb/knowledge-types";

export function AgentKnowledgeLink({ agentId }: { agentId: string }) {
  const { user, org } = useAliyunIdentity();
  const library = useQuery({
    queryKey: ["workspace-knowledge", user, org, "library", false],
    queryFn: () => unwrap<KnowledgeLibrary>(apiClient.get("/workspace-knowledge/library", {
      headers: { "x-workspace-id": org }, params: { trash: false },
    })),
    enabled: !!user && !!org,
    staleTime: 30_000,
    retry: false,
  });
  const available = library.data?.items.filter(item => item.kind === "note" && item.status === "ENABLED" && (!item.agentId || item.agentId === agentId));
  const shared = available?.filter(item => !item.agentId).length ?? 0;
  const assigned = available?.filter(item => item.agentId === agentId).length ?? 0;
  return <Button asChild variant="ghost" size="sm">
    <Link href={"/kb?agentId=" + encodeURIComponent(agentId)} title={available ? `公司共享 ${shared} 条，员工专用 ${assigned} 条` : "查看该员工可用的公司共享和专用知识"}>
      <BookOpen aria-hidden="true" className="size-3.5" />关联知识
      {available && <span className="rounded bg-muted px-1.5 text-[11px] tabular-nums" aria-label={`${available.length} 条可用知识`}>{available.length}</span>}
    </Link>
  </Button>;
}
