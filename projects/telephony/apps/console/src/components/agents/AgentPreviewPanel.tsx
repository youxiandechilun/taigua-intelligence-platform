/*
 * 中文导读：数字员工与话术的 AgentPreviewPanel 组件，封装该界面的展示与交互。
 */
"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { aliyunApi } from "@/src/lib/api/resources/aliyun";
import { learningApi } from "@/src/lib/api/resources/learning";
import { personalPlaybookApi, type ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { scriptOpening } from "./studio/flow-model";
import { Button } from "@/src/components/ui/button";
import { Textarea } from "@/src/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import { toast } from "@/src/lib/toast";
import { useAgentConfig } from "@/src/hooks/queries/agents";
function Preview({
  agentId,
  agentName,
  open,
  onOpenChange,
  playbook, placeholders: draftPlaceholders, personal = false,
}: {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbook?: ConversationPlaybook;
  placeholders?: Record<string, string>;
  personal?: boolean;
}) {
  const { org, user } = useAliyunIdentity();
  const config = useQuery({queryKey:['preview-connection',user,org],queryFn:()=>aliyunApi.configFor(org),enabled:!!org&&!playbook,retry:false});
  const capabilities = useQuery({queryKey:["employee-learning",user,org,agentId,"capabilities",personal],queryFn:()=>personal?personalPlaybookApi.capabilities(agentId,org):learningApi.capabilities(agentId,org),enabled:!!org&&!!playbook,retry:false});
  const available = playbook ? capabilities.data?.analysisAvailable === true : config.data?.hasDashscopeKey === true;
  const [input, setInput] = useState("");
  const agentConfig = useAgentConfig(playbook ? '' : agentId);
  const placeholders =
    draftPlaceholders ?? (
      agentConfig.data?.variables as {
        placeholders?: Record<string, string>;
      } | null
    )?.placeholders ?? {};
  const opening = (playbook ? scriptOpening(playbook) : agentConfig.data?.firstMessage || "").replace(
    /\{\{\s*([A-Za-z_][\w.]*|[\p{L}\p{N}_]+)\s*\}\}/gu,
    (token, name: string) => placeholders[name]?.trim() || (playbook ? "（待确认）" : token),
  );
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const chat = useMutation({
    mutationFn: (history: typeof messages) =>
      playbook ? personal ? personalPlaybookApi.rehearse(agentId,history,playbook,draftPlaceholders||{},org) : learningApi.rehearse(agentId, org, history, playbook, draftPlaceholders) : aliyunApi.rehearse(agentId, history),
    onSuccess: (data) => {
      setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
      setInput("");
    },
    onError: (e: Error) => {
      setMessages((m) => m.slice(0, -1));
      toast.error(e.message);
    },
  });
  function send() {
    if (!input.trim() || chat.isPending) return;
    const history = [
      ...messages.slice(-18),
      { role: "user" as const, content: input.trim() },
    ];
    setMessages(history);
    chat.mutate(history);
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle title={playbook ? "演练当前培训草稿，使用所选文字模型" : "模拟客户提问，检查已保存的沟通话术"}>{agentName} · 文字演练</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-4 py-2">
          {!available && <p className="text-sm text-muted-foreground">{capabilities.isPending&&playbook?"正在检查演练模型…":capabilities.error?.message||"文字演练暂不可用，请联系管理员。"}</p>}
          {opening && (
            <div className="border bg-primary/5 p-3 text-sm">
              <p className="mb-1 font-medium">数字员工开场白</p>
              <p className="whitespace-pre-wrap">{opening}</p>
            </div>
          )}
          {messages.length ? (
            messages.map((m, i) => (
              <div
                key={i}
                className={`border p-3 text-sm ${m.role === "user" ? "bg-muted/30" : "bg-primary/5"}`}
              >
                <p className="font-medium mb-1">
                  {m.role === "user" ? "客户" : "数字员工"}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">开始输入客户问题</p>
          )}
          {chat.isPending && (
            <p className="text-sm text-muted-foreground">数字员工正在回答…</p>
          )}
        </div>
        <div className="border-t p-4 space-y-3">
          <label className="text-sm">
            客户问题
            <Textarea
              className="mt-2"
              rows={3}
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              disabled={chat.isPending}
            />
          </label>
          <div className="flex justify-between">
            <Button
              variant="ghost"
              onClick={() => setMessages([])}
              disabled={chat.isPending}
            >
              清空对话
            </Button>
            <Button
              disabled={
                !input.trim() || chat.isPending || !available
              }
              onClick={send}
            >
              {chat.isPending ? "回答中…" : "发送问题"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AgentPreviewPanel(props: Parameters<typeof Preview>[0]) { return <Preview key={props.agentId} {...props} />; }
