/*
 * 中文导读：数字员工与话术的 BehaviorTab 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  MessageSquare,
  Plus,
  Save,
  Trash2, RefreshCw } from "lucide-react";
import {
  playbookApi,
  type ConversationPlaybook,
  type PlaybookView,
} from "@/src/lib/api/resources/playbook";
import { queryKeys } from "@/src/lib/query-keys";
import { toast } from "@/src/lib/toast";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { AgentPreviewPanel } from "@/src/components/agents/AgentPreviewPanel";

const parts = [
  { id: "opening", title: "开场白", hint: "身份介绍、联系目的" },
  { id: "flow", title: "沟通流程", hint: "提问、追问与结束" },
  { id: "faq", title: "常见问答", hint: "业务、价格与合作条件" },
  { id: "objections", title: "异议处理", hint: "客户顾虑与拒绝" },
  { id: "handoff", title: "人工接管", hint: "触发规则与告知话术" },
] as const;
type Part = (typeof parts)[number]["id"];

function TextField({
  label,
  value,
  onChange,
  max = 4000,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  rows?: number;
  hint?: string;
}) {
  return (
    <label title={hint} className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        rows={rows}
        className="font-normal leading-relaxed"
      />
    </label>
  );
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validate(p: ConversationPlaybook) {
  if (!p.identity.trim() || !p.purpose.trim() || p.opening.trim().length < 5)
    return "请填写身份、联系目的和至少 5 个字的开场白。";
  if (
    p.flow.some((r) => !r.title.trim() || !r.instruction.trim())
  )
    return "请补齐每个沟通步骤的名称和话术。";
  if (p.faq.some((r) => !r.question.trim() || !r.answer.trim()))
    return "请补齐常见问答的问题与回答，或删除空条目。";
  if (p.objections.some((r) => !r.trigger.trim() || !r.response.trim()))
    return "请补齐异议处理的触发情况与回应，或删除空条目。";
  if (
    p.handoff.enabled &&
    (!p.handoff.rules.trim() || !p.handoff.response.trim())
  )
    return "启用人工接管后，请填写触发规则和告知话术。";
  return null;
}

export function BehaviorTab({ agentId }: { agentId: string }) {
  const view = useQuery({
    queryKey: ["agents", "playbook", agentId],
    queryFn: () => playbookApi.get(agentId),
    refetchOnWindowFocus: false,
  });
  if (view.isPending)
    return <p className="p-6 text-sm text-muted-foreground">正在加载话术…</p>;
  if (view.isError)
    return (
      <div className="space-y-3 p-6">
        <p role="alert">{view.error.message}</p>
        <Button variant="outline" onClick={() => view.refetch()}><RefreshCw aria-hidden="true" className="size-4" />
          重新加载
        </Button>
      </div>
    );
  return <PlaybookEditor key={agentId} agentId={agentId} initial={view.data} />;
}

function PlaybookEditor({
  agentId,
  initial,
}: {
  agentId: string;
  initial: PlaybookView;
}) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.playbook);
  const [values, setValues] = useState(initial.placeholders);
  const [part, setPart] = useState<Part>("opening");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved.playbook) ||
    JSON.stringify(values) !== JSON.stringify(saved.placeholders);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = useMutation({
    mutationFn: () =>
      playbookApi.save(agentId, {
        playbook: draft,
        placeholders: values,
        expectedUpdatedAt: saved.updatedAt,
      }),
    onSuccess: (data) => {
      const next = { ...data, agentName: saved.agentName };
      setSaved(next);
      setDraft(data.playbook);
      setValues(data.placeholders);
      setError("");
      qc.setQueryData(["agents", "playbook", agentId], next);
      qc.invalidateQueries({ queryKey: queryKeys.agents.config(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agents.list() });
      toast.success("五项话术已保存，可用于百炼试聊");
    },
    onError: (e: Error) => setError(e.message),
  });
  const preview = useMutation({
    mutationFn: () => playbookApi.preview(agentId, draft),
    onSuccess: (data) => {
      setPreviewText(data.compiledPrompt);
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });
  const reload = useMutation({
    mutationFn: () => playbookApi.get(agentId),
    onSuccess: (data) => {
      setSaved(data);
      setDraft(data.playbook);
      setValues(data.placeholders);
      setError("");
      qc.setQueryData(["agents", "playbook", agentId], data);
    },
    onError: (e: Error) => setError(e.message),
  });
  const busy = save.isPending || preview.isPending || reload.isPending;
  const variableNames = [
    ...new Set(
      Array.from(
        JSON.stringify(draft).matchAll(
          /\{\{\s*([A-Za-z_][\w.]*|[\p{L}\p{N}_]+)\s*\}\}/gu,
        ),
        (m) => m[1]!,
      ),
    ),
  ];
  function patch(update: Partial<ConversationPlaybook>) {
    setDraft((d) => ({ ...d, ...update }));
  }
  function move(index: number, direction: number) {
    const flow = [...draft.flow];
    [flow[index], flow[index + direction]] = [
      flow[index + direction]!,
      flow[index]!,
    ];
    patch({ flow });
  }
  async function saveAndChat() {
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await save.mutateAsync();
      setChatOpen(true);
    } catch {
      /* Error is displayed by the mutation. */
    }
  }
  const selected = parts.find((p) => p.id === part)!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {saved.agentName || "智能体"}的话术
          </h2>
          
        </div>
        <span
          className={`border px-3 py-1.5 text-xs ${dirty ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-muted/30"}`}
        >
          {dirty
            ? "有未保存修改"
            : saved.saved
              ? "工作区话术已保存"
              : "模板待保存"}
        </span>
      </div>
      <div className="grid gap-0 border bg-card lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav
          aria-label="话术编辑项"
          className="flex overflow-x-auto border-b bg-muted/15 p-2 lg:flex-col lg:border-b-0 lg:border-r"
        >
          {parts.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={part === p.id}
              onClick={() => setPart(p.id)}
              title={p.hint}
              className={`min-w-32 px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${part === p.id ? "bg-primary/10 text-primary" : "hover:bg-muted/60"}`}
            >
              <span className="font-semibold">
                {i + 1}. {p.title}
              </span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 p-4 sm:p-6">
          <div className="mb-5 border-b pb-4">
            <h3 className="font-semibold">{selected.title}</h3>
          </div>
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
            {part === "opening" && (
              <>
                <label className="block space-y-2 text-sm font-medium">
                  助手身份
                  <Input
                    value={draft.identity}
                    maxLength={300}
                    onChange={(e) => patch({ identity: e.target.value })}
                  />
                </label>
                <TextField
                  label="联系目的"
                  value={draft.purpose}
                  max={1000}
                  rows={2}
                  onChange={(purpose) => patch({ purpose })}
                />
                <TextField
                  label="开场白"
                  value={draft.opening}
                  rows={5}
                  onChange={(opening) => patch({ opening })}
                  hint="示例：您好，我是本公司的 AI 商务助手，想了解贵公司的合作需求，现在方便简单沟通吗？"
                />
              </>
            )}
            {part === "flow" && (
              <>
                
                {draft.flow.map((r, i) => (
                  <div key={r.id} className="space-y-3 border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        步骤 {i + 1}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`步骤 ${i + 1} 上移`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`步骤 ${i + 1} 下移`}
                          disabled={i === draft.flow.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`删除步骤 ${i + 1}`}
                          onClick={() =>
                            patch({
                              flow: draft.flow.filter((x) => x.id !== r.id),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <label className="block space-y-2 text-sm">
                      步骤名称
                      <Input
                        value={r.title}
                        maxLength={100}
                        onChange={(e) =>
                          patch({
                            flow: draft.flow.map((x) =>
                              x.id === r.id
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <TextField
                      label="话术与追问要求"
                      value={r.instruction}
                      onChange={(instruction) =>
                        patch({
                          flow: draft.flow.map((x) =>
                            x.id === r.id ? { ...x, instruction } : x,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.flow.length >= 30}
                  onClick={() =>
                    patch({
                      flow: [
                        ...draft.flow,
                        { id: crypto.randomUUID(), title: "", instruction: "" },
                      ],
                    })
                  }
                >
                  <Plus />
                  添加沟通步骤
                </Button>
              </>
            )}
            {part === "faq" && (
              <>
                {draft.faq.length === 0 && (null)}
                {draft.faq.map((r, i) => (
                  <div key={r.id} className="space-y-3 border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        问答 {i + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除问答 ${i + 1}`}
                        onClick={() =>
                          patch({ faq: draft.faq.filter((x) => x.id !== r.id) })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <TextField
                      label="客户问题"
                      value={r.question}
                      rows={2}
                      max={1000}
                      onChange={(question) =>
                        patch({
                          faq: draft.faq.map((x) =>
                            x.id === r.id ? { ...x, question } : x,
                          ),
                        })
                      }
                    />
                    <TextField
                      label="回答话术或回答要求"
                      value={r.answer}
                      max={6000}
                      onChange={(answer) =>
                        patch({
                          faq: draft.faq.map((x) =>
                            x.id === r.id ? { ...x, answer } : x,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.faq.length >= 100}
                  onClick={() =>
                    patch({
                      faq: [
                        ...draft.faq,
                        { id: crypto.randomUUID(), question: "", answer: "" },
                      ],
                    })
                  }
                >
                  <Plus />
                  添加常见问答
                </Button>
              </>
            )}
            {part === "objections" && (
              <>
                {draft.objections.length === 0 && (null)}
                {draft.objections.map((r, i) => (
                  <div key={r.id} className="space-y-3 border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        异议 {i + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除异议 ${i + 1}`}
                        onClick={() =>
                          patch({
                            objections: draft.objections.filter(
                              (x) => x.id !== r.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <TextField
                      label="客户说法或触发情况"
                      value={r.trigger}
                      rows={2}
                      max={1000}
                      onChange={(trigger) =>
                        patch({
                          objections: draft.objections.map((x) =>
                            x.id === r.id ? { ...x, trigger } : x,
                          ),
                        })
                      }
                    />
                    <TextField
                      label="回应话术与后续处理"
                      value={r.response}
                      onChange={(response) =>
                        patch({
                          objections: draft.objections.map((x) =>
                            x.id === r.id ? { ...x, response } : x,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.objections.length >= 50}
                  onClick={() =>
                    patch({
                      objections: [
                        ...draft.objections,
                        { id: crypto.randomUUID(), trigger: "", response: "" },
                      ],
                    })
                  }
                >
                  <Plus />
                  添加异议处理
                </Button>
              </>
            )}
            {part === "handoff" && (
              <>
                <label className="flex items-center gap-3 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-blue-600"
                    checked={draft.handoff.enabled}
                    onChange={(e) =>
                      patch({
                        handoff: {
                          ...draft.handoff,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  启用人工接管规则
                </label>
                <TextField
                  label="触发规则"
                  value={draft.handoff.rules}
                  max={6000}
                  rows={5}
                  onChange={(rules) =>
                    patch({ handoff: { ...draft.handoff, rules } })
                  }
                  hint="例如：客户要求人工、投诉、资料无法回答、特殊报价或合同审批。"
                />
                <TextField
                  label="告知客户的话术"
                  value={draft.handoff.response}
                  max={2000}
                  onChange={(response) =>
                    patch({ handoff: { ...draft.handoff, response } })
                  }
                />
                <label className="block space-y-2 text-sm font-medium">
                  跟进岗位或联系方式
                  <Input
                    value={draft.handoff.target}
                    maxLength={300}
                    onChange={(e) =>
                      patch({
                        handoff: { ...draft.handoff, target: e.target.value },
                      })
                    }
                  />
                </label>
                <p className="border-l-2 border-primary bg-primary/5 p-3 text-sm">
                  此处设置 AI
                  何时交给人工处理。真实电话转接还需要在阿里云配置转接目标并发布。
                </p>
              </>
            )}
          </fieldset>
        </div>
      </div>
      <details className="border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          基础设定与已有话术（完整保留）
        </summary>
        <fieldset disabled={busy} className="mt-4">
          <TextField
            label="基础话术"
            value={draft.baseInstructions}
            max={30000}
            rows={9}
            onChange={(baseInstructions) => patch({ baseInstructions })}
            hint="保留原有公司背景和回答约束。若与五项编辑内容冲突，请在这里同步修改。"
          />
        </fieldset>
      </details>
      {variableNames.length > 0 && (
        <details className="border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            动态变量备用值 · {variableNames.length} 个
          </summary>
          <fieldset disabled={busy} className="mt-4 grid gap-4 sm:grid-cols-2">
            {variableNames.map((name) => (
              <label className="space-y-2 text-sm" key={name}>
                <span>{`{{${name}}}`}</span>
                <Input
                  value={values[name] ?? ""}
                  maxLength={4000}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [name]: e.target.value }))
                  }
                />
              </label>
            ))}
          </fieldset>
        </details>
      )}
      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border bg-background/95 p-4 shadow-sm backdrop-blur" aria-label="话术操作栏">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm("重新加载会丢弃未保存修改，是否继续？")
              )
                reload.mutate();
            }}
          ><RefreshCw aria-hidden="true" className="size-4" />
            重新加载
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              download(
                `${saved.agentName || "智能体"}-话术草稿.json`,
                JSON.stringify(
                  { playbook: draft, placeholders: values },
                  null,
                  2,
                ),
                "application/json;charset=utf-8",
              )
            }
          >
            <Download />
            下载草稿
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              const problem = validate(draft);
              if (problem) setError(problem);
              else preview.mutate();
            }}
          >
            <Eye />
            完整话术
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={saveAndChat}>
            <MessageSquare />
            保存并试聊
          </Button>
          <Button
            disabled={busy || (!dirty && saved.saved)}
            onClick={() => {
              const problem = validate(draft);
              if (problem) setError(problem);
              else save.mutate();
            }}
          >
            <Save />
            {save.isPending ? "保存中…" : "保存话术"}
          </Button>
        </div>
      </div>
      <Dialog
        open={previewText !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewText(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>完整话术预览</DialogTitle>
            <DialogDescription>
              由当前五项编辑内容合并生成，预览不会保存或发布。
            </DialogDescription>
          </DialogHeader>
          <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap border bg-muted/20 p-4 text-sm leading-relaxed">
            {previewText}
          </pre>
          <Button
            variant="outline"
            onClick={() =>
              download(
                `${saved.agentName || "智能体"}-完整话术.txt`,
                previewText || "",
                "text/plain;charset=utf-8",
              )
            }
          >
            <Download />
            下载完整话术
          </Button>
        </DialogContent>
      </Dialog>
      <AgentPreviewPanel
        key={chatOpen ? `chat-${saved.updatedAt}` : "closed"}
        agentId={agentId}
        agentName={saved.agentName || "智能体"}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
    </div>
  );
}
