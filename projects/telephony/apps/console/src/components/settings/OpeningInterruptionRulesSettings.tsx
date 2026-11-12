/*
 * 中文导读：设置中心的 OpeningInterruptionRulesSettings 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, RefreshCw, TestTube2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Badge } from "@/src/components/ui/badge";
import { Switch } from "@/src/components/ui/switch";
import { openingRulesApi, type OpeningRulesCatalog, type OpeningSpeechResult } from "@/src/lib/api/resources/opening-interruption-rules";
import { toast } from "@/src/lib/toast";
import { parseKeywordList, validateKeywordLength, keywordListsEqual } from "@/src/lib/keyword-list";

type Draft = { lockOpening: boolean; acknowledgements: string; interruptions: string; revision: string };
const draftFrom = (data: OpeningRulesCatalog): Draft => ({ lockOpening: data.rules.lockOpening, acknowledgements: data.rules.acknowledgementKeywords.join("、"), interruptions: data.rules.interruptKeywords.join("、"), revision: data.revision });
function parseKeywords(value: string) {
  const list = parseKeywordList(value);
  validateKeywordLength(list, 80, "开场白关键词");
  if (list.some(item => !/[\p{L}\p{N}]/u.test(item))) throw new Error("请填写有效词语，当前输入已保留。");
  return list;
}
const actionLabels: Record<OpeningSpeechResult["action"], string> = { continue_opening: "仅附和：继续开场白，不进入待回答列表", answer_after_opening: "实际诉求：记下内容，开场白播完再回答", interrupt_and_answer: "实际诉求：打断开场白，进入对话" };

export function OpeningInterruptionRulesSettings({ organizationId, userId, canRead, canWrite }: { organizationId: string; userId: string; canRead: boolean; canWrite: boolean }) {
  const qc = useQueryClient();
  const queryKey = ["opening-interruption-rules", userId, organizationId];
  const query = useQuery({ queryKey, queryFn: () => openingRulesApi.list(organizationId), enabled: !!organizationId && canRead, retry: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testText, setTestText] = useState("");
  const [result, setResult] = useState<OpeningSpeechResult | null>(null);
  const writable = canWrite && query.data?.canWrite === true;
  const value = draft ?? (query.data ? draftFrom(query.data) : null);
  const update = (patch: Partial<Draft>) => { if (writable && value) setDraft({ ...value, ...patch }); };
  const save = useMutation({
    mutationFn: async (next: Draft) => {
      if (!writable) throw new Error("当前账号没有维护规则的权限");
      const input = { lockOpening: next.lockOpening, acknowledgementKeywords: parseKeywords(next.acknowledgements), interruptKeywords: parseKeywords(next.interruptions) };
      await openingRulesApi.save(organizationId, input, next.revision);
      const data = await openingRulesApi.list(organizationId);
      if (data.rules.lockOpening !== input.lockOpening || !keywordListsEqual(input.acknowledgementKeywords, data.rules.acknowledgementKeywords) || !keywordListsEqual(input.interruptKeywords, data.rules.interruptKeywords)) {
        throw new Error("保存后的开场白规则与输入不一致，当前输入已保留，请核对后重试。");
      }
      return data;
    },
    onSuccess: data => { qc.setQueryData(queryKey, data); setDraft(null); setResult(null); toast.success("开场白规则已保存，后续新呼叫生效"); },
    onError: (error: Error) => toast.error(error.message || "保存失败"),
  });
  const test = useMutation({ mutationFn: (text: string) => openingRulesApi.test(organizationId, text), onSuccess: setResult, onError: (error: Error) => toast.error(error.message || "测试失败") });

  return <section aria-labelledby="opening-interruption-heading" className="rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0 flex-1"><h2 id="opening-interruption-heading" className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="size-4 text-primary" />开场白打断规则</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">控制固定预制开场白的播放方式，区分简单附和与实际问题，避免问候掐断介绍。</p></div>
      <Button variant="outline" size="sm" disabled={!canRead || query.isFetching || save.isPending} onClick={() => { if (draft) { toast.error("请先保存或取消修改"); return; } void query.refetch(); }}><RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />刷新</Button>
    </div>
    <p className="border-b bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground">客户自行挂断与语音助手拦截不受开场白锁定影响。</p>
    {!canRead ? <p className="p-5 text-sm text-muted-foreground">当前账号没有查看线路规则的权限。</p> : query.isPending ? <p role="status" className="p-5 text-sm text-muted-foreground">正在加载开场白规则…</p> : query.error ? <p role="alert" className="p-5 text-sm text-destructive">{query.error.message}</p> : value ? <form onSubmit={event => { event.preventDefault(); if (draft && writable) save.mutate(draft); }} className="space-y-5 px-5 py-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/10 p-4"><div><label htmlFor="lock-fixed-opening" className="cursor-pointer text-sm font-medium">完整播放开场白</label><p className="mt-1 text-xs leading-5 text-muted-foreground">打开：客户说话时继续播放，仅记下实际问题，播完再回答。关闭：附和继续播放，有实际诉求才打断。</p></div><Switch id="lock-fixed-opening" checked={value.lockOpening} disabled={!writable || save.isPending} onCheckedChange={lockOpening => update({ lockOpening })} /></div>
      <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm">附和与问候词<Textarea rows={4} disabled={!writable || save.isPending} value={value.acknowledgements} onChange={event => update({ acknowledgements: event.target.value })} aria-describedby="opening-ack-help" /><span id="opening-ack-help" className="text-xs leading-5 text-muted-foreground">例如：你好、嗯、喂。整句话只有这类表达时，不打断、不作为问题，也不触发 AI 回复。支持逗号、顿号或换行分隔。已填写 {parseKeywordList(value.acknowledgements).length} 个，每项最多 80 字。</span></label><label className="grid gap-2 text-sm">有效打断关键词<Textarea rows={4} disabled={!writable || save.isPending} value={value.interruptions} onChange={event => update({ interruptions: event.target.value })} aria-describedby="opening-interrupt-help" /><span id="opening-interrupt-help" className="text-xs leading-5 text-muted-foreground">例如：要不要收费、哪位、不需要、有意向。优先于附和词；未匹配的实质发言也进入对话。锁定时改为播完后回答。已填写 {parseKeywordList(value.interruptions).length} 个，每项最多 80 字。</span></label></div>
      {writable ? <div className="flex flex-wrap items-center justify-end gap-2">{draft ? <span className="mr-auto text-xs text-muted-foreground">有未保存的修改</span> : <span className="mr-auto text-xs text-muted-foreground">已保存模式：{query.data?.rules.lockOpening ? "完整播放" : "有效诉求才打断"}</span>}<Button type="button" variant="outline" disabled={!draft || save.isPending} onClick={() => setDraft(null)}>取消修改</Button><Button disabled={!draft || save.isPending}>{save.isPending ? "保存中…" : "保存开场白规则"}</Button></div> : <p className="text-xs text-muted-foreground">当前账号可查看和测试，由具有线路分配权限的管理员维护。</p>}
    </form> : null}
    {canRead && query.data ? <div className="border-t px-5 py-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><TestTube2 className="size-4 text-primary" />识别测试</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">使用已保存规则判断一句客户原话，不发起电话，不调用语音模型。</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input aria-label="测试客户在开场白期间说的话" maxLength={6000} value={testText} onChange={event => { setTestText(event.target.value); setResult(null); }} placeholder="例如：你好，要不要收费？" /><Button type="button" variant="outline" disabled={!!draft || !testText.trim() || test.isPending} onClick={() => test.mutate(testText.trim())}>{test.isPending ? "判断中…" : "测试话语"}</Button></div>{draft ? <p className="mt-2 text-xs text-muted-foreground">保存或取消修改后可测试。</p> : null}{result ? <div role="status" className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm"><Badge variant={result.substantive ? "default" : "secondary"}>{actionLabels[result.action]}</Badge>{result.keyword ? <p className="mt-2 text-xs text-muted-foreground">命中关键词：{result.keyword}</p> : null}</div> : null}</div> : null}
  </section>;
}
