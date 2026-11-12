/*
 * 中文导读：设置中心的 IntentRulesSettings 组件，封装该界面的展示与交互。
 */
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Settings2, Trash2, TestTube2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Badge } from "@/src/components/ui/badge";
import { Switch } from "@/src/components/ui/switch";
import { intentRulesApi, type IntentCategory, type IntentMatchMode, type IntentRecognitionRule, type IntentRuleApplyTo } from "@/src/lib/api/resources/intent-rules";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { toast } from "@/src/lib/toast";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { parseKeywordList as parseList, validateKeywordLength, keywordListsEqual } from "@/src/lib/keyword-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { OpeningInterruptionRulesSettings } from "./OpeningInterruptionRulesSettings";
import { AssistantDetectionRulesSettings } from "./AssistantDetectionRulesSettings";
import { RuleKeywordBubbles, RuleKeywordEditor } from "./RuleKeywordBubbles";

const intentLabels: Record<IntentCategory, string> = { interested: "有意向", unclear: "未明确", uninterested: "无意向", optout: "拒绝联系" };
const intentOrder: IntentCategory[] = ["optout", "uninterested", "interested", "unclear"];
const modeLabels: Record<IntentMatchMode, string> = { any: "任一关键词", all: "全部关键词", phrase: "完整词组" };
const applyLabels: Record<IntentRuleApplyTo, string> = { outbound: "普通外呼", demo: "演示模式", manual: "手动测试", assistant: "实时对话" };
const applyOptions = Object.keys(applyLabels) as IntentRuleApplyTo[];

type Draft = Omit<IntentRecognitionRule, "id" | "createdAt" | "updatedAt"> & { id?: string; positiveText: string; negativeText: string };
const emptyDraft = (): Draft => ({ name: "", intent: "interested", positiveKeywords: [], negativeKeywords: [], positiveText: "", negativeText: "", matchMode: "any", priority: 100, enabled: true, applyTo: [...applyOptions], replyHint: "", action: "" });
const listText = (values: string[]) => values.join("、");

export function IntentRulesSettings() {
  const { org, user } = useAliyunIdentity();
  return <WorkspaceIntentRulesSettings key={`${user}:${org}`} org={org} user={user} />;
}

function WorkspaceIntentRulesSettings({ org, user }: { org: string; user: string }) {
  const context = useCompanyContext();
  const access = context.data?.organizationId === org ? context.data : undefined;
  const canRead = access?.isSystemAdmin === true || access?.permissions.lines?.includes("read") === true;
  const canWrite = access?.isSystemAdmin === true || access?.permissions.lines?.includes("assign") === true;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["intent-rules", user, org], queryFn: () => intentRulesApi.list(org), enabled: !!org && canRead, retry: false });
  const [tab, setTab] = useState("opening");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [managedIntent, setManagedIntent] = useState<IntentCategory | null>(null);
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof intentRulesApi.test>> | null>(null);
  const save = useMutation({
    mutationFn: async (value: Draft) => {
      if (!canWrite) throw new Error("当前账号没有维护识别规则的权限");
      const input = { ...value, positiveKeywords: parseList(value.positiveText), negativeKeywords: parseList(value.negativeText) };
      validateKeywordLength(input.positiveKeywords, 80, "正向关键词");
      validateKeywordLength(input.negativeKeywords, 80, "排除短语");
      const saved = await intentRulesApi.save(org, input);
      const rules = await intentRulesApi.list(org);
      const persisted = rules.find(rule => rule.id === saved.id);
      if (!persisted || !keywordListsEqual(input.positiveKeywords, persisted.positiveKeywords) || !keywordListsEqual(input.negativeKeywords, persisted.negativeKeywords)) {
        throw new Error("保存后的关键词与输入不一致，当前输入已保留，请核对后重试。");
      }
      return rules;
    },
    onSuccess: (rules) => { qc.setQueryData(["intent-rules", user, org], rules); setDraft(null); setTestResult(null); toast.success("意向识别规则已完整保存"); },
    onError: (error: Error) => toast.error(error.message || "保存失败，当前输入已保留"),
  });
  const remove = useMutation({ mutationFn: (id: string) => { if (!canWrite) throw new Error("当前账号没有维护识别规则的权限"); return intentRulesApi.remove(org, id); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["intent-rules", user, org] }); setTestResult(null); toast.success("规则已删除"); }, onError: (error: Error) => toast.error(error.message || "删除失败") });
  const test = useMutation({ mutationFn: (text: string) => { if (!canRead) throw new Error("当前账号没有查看线路规则的权限"); return intentRulesApi.test(org, text); }, onSuccess: setTestResult, onError: (error: Error) => toast.error(error.message || "测试失败") });
  const rules = useMemo(() => [...(query.data ?? [])].sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100)), [query.data]);

  function updateDraft(patch: Partial<Draft>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  function toggleApply(value: IntentRuleApplyTo) { if (!draft) return; updateDraft({ applyTo: draft.applyTo.includes(value) ? draft.applyTo.filter((item) => item !== value) : [...draft.applyTo, value] }); }

  return <Tabs value={tab} onValueChange={setTab} className="gap-4">
    <TabsList aria-label="识别规则类型" variant="line" className="w-full justify-start rounded-none border-b p-0">
      <TabsTrigger value="opening">开场白</TabsTrigger><TabsTrigger value="intent">意向识别</TabsTrigger><TabsTrigger value="assistant">助手拦截</TabsTrigger>
    </TabsList>
    <TabsContent value="opening" forceMount hidden={tab!=="opening"}>
    <OpeningInterruptionRulesSettings key={`opening:${user}:${org}`} organizationId={org} userId={user} canRead={canRead} canWrite={canWrite} />
    </TabsContent>
    <TabsContent value="intent" forceMount hidden={tab!=="intent"} className="space-y-4">
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">实时意向识别</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">根据客户原话识别意向，通话结束后再由 AI 补充校正。</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={!canRead || query.isFetching}><RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />刷新</Button>{canWrite ? <Button size="sm" onClick={() => setDraft(emptyDraft())}><Plus className="size-4" />新增规则</Button> : null}</div>
      </div>

    </section>

    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-4"><h3 className="text-sm font-semibold">意向规则 <span className="ml-1 font-normal text-muted-foreground">{intentOrder.filter((intent) => rules.some((rule) => rule.intent === intent)).length} 类</span></h3><span className="text-xs text-muted-foreground">{rules.length} 条原规则</span></div>
      
      {!canRead && context.isPending ? <p className="p-5 text-sm text-muted-foreground">正在读取权限…</p> : !canRead ? <p className="p-5 text-sm text-muted-foreground">当前账号没有查看线路规则的权限。</p> : query.isPending ? <p className="p-5 text-sm text-muted-foreground">正在加载规则…</p> : query.error ? <p role="alert" className="p-5 text-sm text-destructive">{(query.error as Error).message}</p> : rules.length ? <div className="divide-y">{intentOrder.map((intent) => {
        const group = rules.filter((rule) => rule.intent === intent);
        if (!group.length) return null;
        const active = group.filter((rule) => rule.enabled).length;
        const count = new Set(group.flatMap((rule) => rule.positiveKeywords)).size;
        return <div key={intent} className="px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">{intentLabels[intent]}</h4><Badge variant={active ? "default" : "secondary"}>{active ? "启用中" : "已停用"}</Badge><span className="text-xs text-muted-foreground">{group.length} 条原规则 · {count} 个关键词 · {active}/{group.length} 条启用</span></div><Button type="button" size="sm" variant="outline" onClick={() => setManagedIntent(intent)}><Settings2 className="size-4" />管理规则</Button></div><RuleKeywordBubbles sources={group.map((rule) => ({ id: rule.id, name: rule.name, enabled: rule.enabled, keywords: rule.positiveKeywords }))} /></div>;
      })}</div> : <div className="p-10 text-center text-sm text-muted-foreground">还没有规则。先新增一条关键词规则，通话中即可实时命中。</div>}
    </section>

    {managedIntent ? <Dialog open onOpenChange={(open) => { if (!open) setManagedIntent(null); }}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{intentLabels[managedIntent]} · 管理规则</DialogTitle><DialogDescription>各条规则的匹配方式、优先级和排除词分别保留。</DialogDescription></DialogHeader><div className="divide-y">{rules.filter((rule) => rule.intent === managedIntent).map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{rule.name}</span><Badge variant={rule.enabled ? "default" : "secondary"}>{rule.enabled ? "启用" : "停用"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{rule.positiveKeywords.length} 个关键词 · {modeLabels[rule.matchMode]} · 优先级 {rule.priority} · {rule.negativeKeywords.length} 个排除词</p></div>{canWrite ? <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label={`编辑${rule.name}`} onClick={() => { setManagedIntent(null); setDraft({ ...rule, positiveText: listText(rule.positiveKeywords), negativeText: listText(rule.negativeKeywords) }); }}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" className="hover:text-destructive" aria-label={`删除${rule.name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`删除规则“${rule.name}”？`)) remove.mutate(rule.id); }}><Trash2 className="size-4" /></Button></div> : null}</div>)}</div></DialogContent></Dialog> : null}

    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2"><TestTube2 className="size-4 text-primary" /><h3 className="text-sm font-semibold">识别测试</h3></div>
      <p className="mt-1 text-sm text-muted-foreground">使用已保存规则判断客户原话；“嗯、好、可以”等简短肯定在实际通话中还会结合前文。</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={testText} disabled={!canRead} onChange={(event) => { setTestText(event.target.value); setTestResult(null); }} placeholder="例如：可以，晚上七点给我打电话" onKeyDown={(event) => { if (event.key === "Enter" && canRead && !draft && testText.trim() && !test.isPending) test.mutate(testText.trim()); }} /><Button variant="outline" disabled={!canRead || !!draft || !testText.trim() || test.isPending} onClick={() => test.mutate(testText.trim())}>{test.isPending ? "测试中…" : "测试命中"}</Button></div>
      {testResult ? <div className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm"><div className="flex flex-wrap gap-2"><Badge variant={testResult.matched ? "default" : "secondary"}>{testResult.matched ? `命中：${testResult.intent ? intentLabels[testResult.intent] : "已命中"}` : "未命中"}</Badge>{testResult.rules.map((rule) => <Badge key={rule.id} variant="outline">{rule.name}</Badge>)}</div>{testResult.evidence?.length ? <p className="mt-2 text-xs text-muted-foreground">依据：{testResult.evidence.join("；")}</p> : null}</div> : null}
    </section>

    {draft && canWrite ? <Dialog open onOpenChange={open=>{if(!open&&!save.isPending)setDraft(null);}}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!save.isPending}><DialogHeader><DialogTitle>{draft.id?"编辑意向规则":"新增意向规则"}</DialogTitle><DialogDescription>保存后对后续新呼叫生效。</DialogDescription></DialogHeader>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">启用规则</span>
        <Switch aria-label="启用意向规则" checked={draft.enabled} disabled={save.isPending} onCheckedChange={(checked) => updateDraft({ enabled: checked })} />
      </div>
      <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); if (!draft.name.trim() || draft.positiveKeywords.length === 0 || draft.applyTo.length === 0) { toast.error("请填写名称、至少一个关键词并选择生效范围"); return; } save.mutate(draft); }}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">规则名称<Input required disabled={save.isPending} maxLength={120} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例如：客户明确接受" /></label>
          <label className="grid gap-2 text-sm">意向类别<select disabled={save.isPending} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.intent} onChange={(event) => updateDraft({ intent: event.target.value as IntentCategory })}>{Object.entries(intentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <RuleKeywordEditor label="正向关键词 / 同义表达" disabled={save.isPending} value={draft.positiveText} onChange={(value) => updateDraft({ positiveText: value, positiveKeywords: parseList(value) })} maxLength={80} placeholder="可以、好的、发我看看" />
          <RuleKeywordEditor label="否定词 / 排除短语" disabled={save.isPending} value={draft.negativeText} onChange={(value) => updateDraft({ negativeText: value, negativeKeywords: parseList(value) })} maxLength={80} placeholder="不用、不需要、别打" />
        </div>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm text-muted-foreground">高级设置：匹配方式、优先级与生效范围</summary><div className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">匹配模式<select disabled={save.isPending} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.matchMode} onChange={(event) => updateDraft({ matchMode: event.target.value as IntentMatchMode })}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="grid gap-2 text-sm">优先级（越大越优先）<Input disabled={save.isPending} type="number" min={0} max={1000} step={1} value={draft.priority} onChange={(event) => updateDraft({ priority: Math.min(1000, Math.max(0, Math.trunc(Number(event.target.value) || 0))) })} /></label>
        </div>
        <div><p className="mb-2 text-sm">生效范围</p><div className="flex flex-wrap gap-2">{applyOptions.map((value) => <Button key={value} disabled={save.isPending} type="button" size="sm" variant={draft.applyTo.includes(value) ? "default" : "outline"} onClick={() => toggleApply(value)}>{applyLabels[value]}</Button>)}</div></div>
        </div></details>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setDraft(null)}>取消</Button><Button disabled={save.isPending}>{save.isPending ? "保存中…" : "保存规则"}</Button></div>
      </form>
    </DialogContent></Dialog> : null}
    <details className="text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer">匹配说明</summary><p>先检查否定与排除短语，再按优先级匹配。“要不要收费”这类询问可设为未明确；简短附和需结合前文确认意向。</p></details>
    </TabsContent>
    <TabsContent value="assistant" forceMount hidden={tab!=="assistant"}>
    <AssistantDetectionRulesSettings key={`${user}:${org}`} organizationId={org} userId={user} canRead={canRead} canWrite={canWrite} />
    </TabsContent>
  </Tabs>;
}
