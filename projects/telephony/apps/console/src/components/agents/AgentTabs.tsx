/*
 * 中文导读：数字员工与话术的 AgentTabs 组件，封装该界面的展示与交互。
 */
"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AudioLines,
  BookOpen,
  Bot,
  ClipboardCheck,
  Settings,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import { BehaviorTab } from "./tabs/BehaviorTab";
import { KnowledgeTab } from "./tabs/KnowledgeTab";
import { AnalysisTab } from "./tabs/AnalysisTab";
import { AliyunAgentPanel } from "../aliyun/AgentPanel";
import { AgentRuntime } from "../aliyun/AgentRuntime";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
const tabs = [
  { id: "behavior", label: "话术编辑", Icon: Bot },
  { id: "knowledge", label: "业务知识", Icon: BookOpen },
  { id: "voice", label: "通话设置", Icon: AudioLines },
  { id: "analysis", label: "通话结果与跟进", Icon: ClipboardCheck },
  { id: "runtime", label: "运行设置", Icon: Settings },
];
export function AgentTabs({ agentId }: { agentId: string }) {
  const params = useSearchParams(),
    pathname = usePathname(),
    router = useRouter();
  const { org } = useAliyunIdentity();
  let current = params.get("tab") || "behavior";
  if (["webhooks", "limits", "advanced", "tools"].includes(current))
    current = "runtime";
  if (!tabs.some((t) => t.id === current)) current = "behavior";
  return (
    <Tabs
      key={org + agentId}
      value={current}
      onValueChange={(v) => {
        const next = new URLSearchParams(params);
        next.set("tab", v);
        router.replace(`${pathname}?${next}`, { scroll: false });
      }}
      className="min-w-0"
      title="网页保存准备稿；实际电话使用阿里云已发布并生效的版本。"
    >
      <TabsList className="h-auto w-full justify-start overflow-x-auto bg-transparent border-b rounded-none p-0">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.id}
            value={t.id}
            className="h-12 flex-none gap-2 rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            <t.Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.9} />
            <span className="whitespace-nowrap">{t.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent
        forceMount
        value="behavior"
        className="mt-6 data-[state=inactive]:hidden"
      >
        <BehaviorTab agentId={agentId} />
      </TabsContent>
      <TabsContent value="knowledge" className="mt-6">
        <KnowledgeTab agentId={agentId} />
      </TabsContent>
      <TabsContent value="voice" className="mt-6">
        <AliyunAgentPanel agentId={agentId} />
      </TabsContent>
      <TabsContent value="analysis" className="mt-6">
        <AnalysisTab agentId={agentId} />
      </TabsContent>
      <TabsContent value="runtime" className="mt-6">
        <AgentRuntime agentId={agentId} />
      </TabsContent>
    </Tabs>
  );
}
