/*
 * 中文导读：通话记录的 CallReviewPanel 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { useAnalyzeCall } from "@/src/hooks/queries/calls";
import type { CallLog } from "@/src/lib/api/types";

function reviewItems(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    return typeof row.identifier === "string" && typeof row.value === "string"
      ? [{ title: row.identifier, content: row.value, evidence: typeof row.description === "string" ? row.description : "" }]
      : [];
  });
}

export function CallReviewPanel({ call, loading, failed, onRetry }: { call: CallLog; loading: boolean; failed: boolean; onRetry: () => void }) {
  const analyze = useAnalyzeCall();
  if(call.metadata?.demoCall===true)return <p className="rounded-md border p-4 text-sm text-muted-foreground">演示电话保留录音和问答记录，不进行客户意向分析。</p>;
  const items = reviewItems(call.dataEvaluation);
  const analysis = call.analysis;
  const busy = analyze.isPending || ["QUEUED", "RUNNING"].includes(analysis?.status ?? "");
  const statuses: Record<string, string> = { QUEUED: "等待分析", RUNNING: "分析中", DISABLED: "通话分析未开启", NO_TRANSCRIPT: "暂无文字记录", FAILED: "上次分析失败，可重试", NOT_STARTED: "尚未生成 AI 复盘" };
  return <section aria-label="复盘建议" className="rounded-xl border bg-background p-4">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">复盘建议</h3>
      <span className="text-xs text-muted-foreground">{analysis?.evaluatedBy === "AI" ? "AI 文字评估" : analysis?.evaluatedBy === "TRANSCRIPT" ? "文字巡检" : ""}</span>
    </header>
    {loading && !items.length ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载复盘</p>
      : failed ? <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="size-3.5" />重新加载复盘</Button>
        : items.length ? <div className="space-y-4">{items.map((item, index) => <div key={index}>
          <h4 className="text-sm font-medium leading-6">{item.title}</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{item.content}</p>
          {item.evidence && <details className="mt-1 text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer">查看依据</summary><p className="mt-1 whitespace-pre-wrap break-words">{item.evidence}</p></details>}
        </div>)}</div> : <p role="status" className="text-sm text-muted-foreground">{statuses[analysis?.status ?? ""] ?? "暂无复盘结果"}</p>}
    {busy && items.length > 0 && <p role="status" className="mt-3 text-sm text-muted-foreground">正在更新复盘</p>}
    {analysis?.canGenerate && analysis.enabled && <Button variant="outline" size="sm" className="mt-4 w-full" disabled={busy} onClick={() => analyze.mutate(call.callId)}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{busy ? "分析中" : items.length ? "更新 AI 复盘" : "生成 AI 复盘"}
    </Button>}
    {analysis?.canGenerate && !analysis.enabled && <Link href="/automation?view=company" className="mt-3 inline-block text-sm text-primary hover:underline">开启通话整理</Link>}
  </section>;
}
