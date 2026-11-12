/*
 * 中文导读：设置中心的 AssistantDetectionRulesSettings 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Settings2, ShieldCheck, TestTube2, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Badge } from "@/src/components/ui/badge";
import { Switch } from "@/src/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/src/components/ui/alert-dialog";
import { assistantDetectionRulesApi, type AssistantDetectionRule, type AssistantDetectionTestResult, type AssistantDetectionMatchMode } from "@/src/lib/api/resources/assistant-detection-rules";
import { toast } from "@/src/lib/toast";
import { parseKeywordList as parseList, validateKeywordLength, keywordListsEqual } from "@/src/lib/keyword-list";
import { RuleKeywordBubbles, RuleKeywordEditor } from "./RuleKeywordBubbles";

type RuleDraft = { baseRules: AssistantDetectionRule[]; baseRevision: string; id?: string; name: string; keywords: string; negativeKeywords: string; enabled: boolean; matchMode: AssistantDetectionMatchMode };
const modeLabels: Record<AssistantDetectionMatchMode, string> = { semantic: "语义确认", keyword: "关键词直接拦截" };
type Diagnostic = NonNullable<AssistantDetectionTestResult["diagnostics"]>[number];

function diagnosticText(item: Diagnostic) {
  if (item.status === "matched") return `已命中关键词“${item.keyword ?? ""}”，符合当前规则的拦截条件。`;
  if (item.status === "semantic_not_confirmed") return `已命中关键词“${item.keyword}”，但未通过自动代接语义确认，继续通话。需要见词就拦截时，可将这条规则改为“关键词直接拦截”。`;
  if (item.status === "excluded") return `已命中关键词“${item.keyword}”，同时命中排除短语“${item.negativeKeyword}”，本条规则不拦截。`;
  if (item.status === "disabled") return `已命中关键词“${item.keyword}”，但本条规则已停用。`;
  return "未匹配到本条规则的关键词。";
}

export function AssistantDetectionRulesSettings({ organizationId, userId, canRead, canWrite }: { organizationId: string; userId: string; canRead: boolean; canWrite: boolean }) {
  const qc = useQueryClient();
  const queryKey = ["assistant-detection-rules", userId, organizationId];
  const query = useQuery({ queryKey, queryFn: () => assistantDetectionRulesApi.list(organizationId), enabled: !!organizationId && canRead, retry: false });
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [managing, setManaging] = useState(false);
  const [removing, setRemoving] = useState<{rule:AssistantDetectionRule;rules:AssistantDetectionRule[];revision:string} | null>(null);
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<AssistantDetectionTestResult | null>(null);
  const writable = canWrite && query.data?.canWrite === true;
  const rules = query.data?.rules ?? [];
  const save = useMutation({
    mutationFn: async ({next, revision}: {next: AssistantDetectionRule[];revision:string}) => {
      const payload = next.map(rule => ({ ...rule, matchMode: rule.matchMode ?? "semantic" as const }));
      for (const rule of payload) {
        validateKeywordLength(rule.keywords, 120, "拦截关键词");
        validateKeywordLength(rule.negativeKeywords, 120, "排除短语");
      }
      await assistantDetectionRulesApi.save(organizationId, payload, revision);
      const data = await assistantDetectionRulesApi.list(organizationId);
      if (data.rules.length !== payload.length || payload.some(rule => {
        const stored = data.rules.find(item => item.id === rule.id);
        return !stored || stored.name !== rule.name || stored.enabled !== rule.enabled || (stored.matchMode ?? "semantic") !== rule.matchMode || !keywordListsEqual(rule.keywords, stored.keywords) || !keywordListsEqual(rule.negativeKeywords, stored.negativeKeywords);
      })) throw new Error("保存后的规则与输入不一致，当前输入已保留，请核对后重试。");
      return data;
    },
    onSuccess: (data) => { qc.setQueryData(queryKey, data); setDraft(null); setRemoving(null); setTestResult(null); toast.success("语音助手拦截规则已完整保存"); },
    onError: (error: Error) => toast.error(error.message || "保存失败"),
  });
  const test = useMutation({ mutationFn: (text: string) => assistantDetectionRulesApi.test(organizationId, text), onSuccess: setTestResult, onError: (error: Error) => toast.error(error.message || "测试失败") });

  function edit(rule: AssistantDetectionRule) { setTestResult(null); setDraft({ baseRules: structuredClone(rules), baseRevision: query.data!.revision, id: rule.id, name: rule.name, keywords: rule.keywords.join("、"), negativeKeywords: rule.negativeKeywords.join("、"), enabled: rule.enabled, matchMode: rule.matchMode ?? "semantic" }); }
  function saveDraft() {
    if (!draft || !writable) return;
    const keywords = parseList(draft.keywords);
    if (!draft.name.trim() || !keywords.length) { toast.error("请填写规则名称和至少一个拦截关键词"); return; }
    const rule: AssistantDetectionRule = { id: draft.id ?? crypto.randomUUID(), name: draft.name.trim(), keywords, negativeKeywords: parseList(draft.negativeKeywords), enabled: draft.enabled, matchMode: draft.matchMode };
    save.mutate({next: draft.id ? draft.baseRules.map((item) => item.id === rule.id ? rule : item) : [...draft.baseRules, rule], revision: draft.baseRevision});
  }
  const matchedRules = testResult?.rules?.length ? testResult.rules : testResult?.rule ? [testResult.rule] : [];
  const evidence = Array.isArray(testResult?.evidence) ? testResult.evidence.join("；") : testResult?.evidence;
  const diagnostics = testResult?.diagnostics?.filter(item => item.status !== "no_keyword") ?? [];

  return <section aria-labelledby="assistant-detection-heading" className="rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0 flex-1"><h2 id="assistant-detection-heading" className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" />语音助手拦截</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">识别智能代接与语音信箱，命中后结束通话，不计为意向客户。</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!canRead || query.isFetching} onClick={() => { setTestResult(null); void query.refetch(); }}><RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />刷新</Button>{writable ? <Button size="sm" onClick={() => { setTestResult(null); setDraft({ baseRules: structuredClone(rules), baseRevision: query.data!.revision, name: "", keywords: "", negativeKeywords: "", enabled: true, matchMode: "semantic" }); }}><Plus className="size-4" />新增拦截规则</Button> : null}</div>
    </div>
    {!canRead ? <p className="p-5 text-sm text-muted-foreground">当前账号没有查看线路规则的权限。</p> : query.isPending ? <p className="p-5 text-sm text-muted-foreground">正在加载拦截规则…</p> : query.error ? <p role="alert" className="p-5 text-sm text-destructive">{query.error.message}</p> : rules.length ? <div className="px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">语音助手和语音信箱</h3><Badge variant={rules.some((rule) => rule.enabled) ? "default" : "secondary"}>{rules.some((rule) => rule.enabled) ? "启用中" : "已停用"}</Badge><span className="text-xs text-muted-foreground">{rules.length} 条原规则 · {new Set(rules.flatMap((rule) => rule.keywords)).size} 个关键词 · {rules.filter((rule) => rule.enabled).length}/{rules.length} 条启用</span></div><Button type="button" size="sm" variant="outline" onClick={() => setManaging(true)}><Settings2 className="size-4" />管理规则</Button></div><RuleKeywordBubbles sources={rules.map((rule) => ({ id: rule.id, name: rule.name, enabled: rule.enabled, keywords: rule.keywords }))} /></div> : <p className="p-5 text-sm text-muted-foreground">还没有拦截规则，可添加智能代接和语音信箱的提示语。</p>}
    {managing ? <Dialog open onOpenChange={(open) => { if (!open) setManaging(false); }}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>语音助手拦截 · 管理规则</DialogTitle><DialogDescription>各条规则的匹配方式和排除短语分别保留。</DialogDescription></DialogHeader><div className="divide-y">{rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{rule.name}</span><Badge variant={rule.enabled ? "default" : "secondary"}>{rule.enabled ? "启用" : "停用"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{rule.keywords.length} 个关键词 · {modeLabels[rule.matchMode ?? "semantic"]} · {rule.negativeKeywords.length} 个排除词</p></div>{writable ? <div className="flex items-center gap-1"><Switch aria-label={`${rule.enabled ? "停用" : "启用"}${rule.name}`} checked={rule.enabled} disabled={save.isPending || !!draft} onCheckedChange={(enabled) => save.mutate({next:rules.map((item) => item.id === rule.id ? { ...item, enabled } : item),revision:query.data!.revision})} /><Button size="icon" variant="ghost" aria-label={`编辑${rule.name}`} disabled={save.isPending} onClick={() => { setManaging(false); edit(rule); }}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" className="hover:text-destructive" aria-label={`删除${rule.name}`} disabled={save.isPending} onClick={() => { setManaging(false); setRemoving({rule,rules:structuredClone(rules),revision:query.data!.revision}); }}><Trash2 className="size-4" /></Button></div> : null}</div>)}</div></DialogContent></Dialog> : null}
    {!query.isPending && !query.error && canRead && !writable ? <p className="border-t px-5 py-3 text-xs text-muted-foreground">当前账号可查看和测试，由具有线路分配权限的管理员维护规则。</p> : null}
    {save.isError && <p role="alert" className="border-t px-5 py-3 text-sm text-destructive">{save.error.message} 可刷新查看最新规则，当前草稿不会被清空。</p>}
    {draft && writable ? <Dialog open onOpenChange={open=>{if(!open&&!save.isPending)setDraft(null);}}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!save.isPending}><DialogHeader><DialogTitle>{draft.id?"编辑拦截规则":"新增拦截规则"}</DialogTitle><DialogDescription>命中条件与排除词按本条规则保存。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveDraft(); }}>
      <div className="flex items-center justify-between gap-3"><span className="text-sm">规则状态</span><label className="flex items-center gap-2 text-xs text-muted-foreground">启用<Switch checked={draft.enabled} disabled={save.isPending} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /></label></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm">规则名称<Input required disabled={save.isPending} maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：手机智能代接提示" /></label>
        <label className="grid gap-2 text-sm">匹配方式
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={save.isPending} value={draft.matchMode} onChange={event => setDraft({ ...draft, matchMode: event.target.value as AssistantDetectionMatchMode })} aria-describedby="assistant-match-mode-help">
            <option value="semantic">语义确认（推荐）</option>
            <option value="keyword">关键词直接拦截</option>
          </select>
        </label>
      </div>
      <p id="assistant-match-mode-help" className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">{draft.matchMode === "keyword" ? "客户转写包含任一拦截词就直接挂断，不再要求自动代接语义。排除短语仍优先。例如配置“机主”也会命中“我是机主本人”，可把真人表达加入本条规则的排除短语。" : "命中关键词后，还需符合自动代接播报语义。仅说“机主”“助手”等短词不会挂断；测试结果会说明未拦截原因。"}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <RuleKeywordEditor label="拦截关键词 / 提示词组" disabled={save.isPending} value={draft.keywords} onChange={(value) => setDraft({ ...draft, keywords: value })} maxLength={120} placeholder="智能代接、请在嘟声后留言&#10;支持逗号、顿号或换行分隔" />
        <RuleKeywordEditor label="真人表达 / 排除短语" disabled={save.isPending} value={draft.negativeKeywords} onChange={(value) => setDraft({ ...draft, negativeKeywords: value })} maxLength={120} placeholder="我是本人、不用语音助手" />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">多个关键词用逗号、顿号或换行分隔。“A.*B”表示两个词组按顺序出现；不支持其他正则表达式，“或”的条件请拆成多个关键词。排除短语仅作用于本条规则。</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setDraft(null)}>取消</Button><Button disabled={save.isPending}>{save.isPending ? "保存中…" : "保存拦截规则"}</Button></div>
    </form></DialogContent></Dialog> : null}
    <div className="border-t px-5 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><TestTube2 className="size-4 text-primary" />识别测试</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">使用已保存规则判断客户原话，显示关键词和匹配方式；不发起电话，不调用语音模型。</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input aria-label="测试语音助手接听提示或客户原话" maxLength={6000} value={testText} disabled={!canRead} onChange={(event) => { setTestText(event.target.value); setTestResult(null); }} placeholder="例如：您好，我是机主的智能助理" onKeyDown={(event) => { if (event.key === "Enter" && canRead && !draft && testText.trim() && !test.isPending) test.mutate(testText.trim()); }} />
        <Button type="button" variant="outline" disabled={!canRead || !!draft || !testText.trim() || test.isPending} onClick={() => test.mutate(testText.trim())}>{test.isPending ? "测试中…" : "测试拦截"}</Button>
      </div>
      {draft ? <p className="mt-2 text-xs text-muted-foreground">保存或取消修改后，可测试已保存的规则。</p> : null}
      {testResult ? <div role="status" className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm">
        <div className="flex flex-wrap gap-2"><Badge variant={testResult.matched ? "destructive" : "secondary"}>{testResult.matched ? "命中拦截，将挂断" : "未触发拦截"}</Badge>{matchedRules.map((rule) => <Badge key={`${rule.id}:${rule.keyword ?? ""}`} variant="outline">{rule.name}</Badge>)}</div>
        {evidence ? <p className="mt-2 break-words text-xs text-muted-foreground">命中依据：{evidence}</p> : null}
        {diagnostics.length ? <ul className="mt-3 space-y-2">{diagnostics.map(item => <li key={item.id} className="break-words text-xs leading-5"><span className="font-medium">{item.name} · {modeLabels[item.matchMode]}：</span>{diagnosticText(item)}</li>)}</ul> : !testResult.matched ? <p className="mt-2 text-xs text-muted-foreground">未匹配到已保存规则中的关键词。</p> : null}
      </div> : null}
    </div>
    <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open && !save.isPending) setRemoving(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除拦截规则？</AlertDialogTitle><AlertDialogDescription>删除“{removing?.rule.name}”后，后续新呼叫不再使用这条规则识别智能代接。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={save.isPending}>取消</AlertDialogCancel><AlertDialogAction disabled={!writable || save.isPending} onClick={(event) => { event.preventDefault(); if (removing && writable) save.mutate({next:removing.rules.filter((rule) => rule.id !== removing.rule.id),revision:removing.revision}); }}>{save.isPending ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
