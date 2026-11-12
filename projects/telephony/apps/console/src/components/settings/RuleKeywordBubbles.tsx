/*
 * 中文导读：设置中心的 RuleKeywordBubbles 组件，封装该界面的展示与交互。
 */
"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { parseKeywordList } from "@/src/lib/keyword-list";
import { toast } from "@/src/lib/toast";

type KeywordSource = { id: string; name: string; enabled: boolean; keywords: string[] };

export function RuleKeywordBubbles({ sources }: { sources: KeywordSource[] }) {
  const terms = new Map<string, { names: string[]; enabled: boolean }>();
  for (const source of sources) {
    for (const keyword of source.keywords) {
      const current = terms.get(keyword) ?? { names: [], enabled: false };
      current.names.push(`${source.name}${source.enabled ? "" : "（已停用）"}`);
      current.enabled ||= source.enabled;
      terms.set(keyword, current);
    }
  }
  const entries = [...terms.entries()];
  const bubbles = (items: typeof entries) => items.map(([keyword, info]) => <span key={keyword} title={`来源：${info.names.join("、")}`} className={`inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs leading-5 ${info.enabled ? "border-border bg-muted/40 text-foreground" : "border-dashed border-border bg-muted/20 text-muted-foreground"}`}><span className="break-all">{keyword}</span>{!info.enabled ? <span className="shrink-0">（停用）</span> : null}</span>);

  if (!entries.length) return <p className="mt-3 text-xs text-muted-foreground">暂无关键词</p>;
  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">{bubbles(entries.slice(0, 12))}</div>
    {entries.length > 12 ? <details className="group mt-2"><summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs text-primary [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">查看全部 {entries.length} 个关键词</span><span className="hidden group-open:inline">收起</span><ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary><div className="mt-2 flex flex-wrap gap-2">{bubbles(entries.slice(12))}</div></details> : null}
  </div>;
}

export function RuleKeywordEditor({ label, value, onChange, disabled, maxLength, placeholder }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; maxLength: number; placeholder: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState("");
  const words = parseKeywordList(value);

  function addPending() {
    const additions = parseKeywordList(pending);
    if (!additions.length) {
      setPending("");
      inputRef.current?.setCustomValidity("");
      return;
    }
    if (additions.some((word) => word.length > maxLength)) {
      toast.error(`每个关键词最多 ${maxLength} 字`);
      return;
    }
    onChange([...new Set([...words, ...additions])].join("、"));
    setPending("");
    inputRef.current?.setCustomValidity("");
    inputRef.current?.focus();
  }

  return <div className="grid min-w-0 gap-2 text-sm">
    <label htmlFor={inputId} className="font-medium">{label}</label>
    <div className="max-h-40 overflow-y-auto rounded-md border border-input bg-background p-2">
      <div className="flex flex-wrap gap-2">{words.length ? words.map((word) => <span key={word} className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs leading-5"><span className="break-all">{word}</span><button type="button" disabled={disabled} aria-label={`移除${word}`} title={`移除${word}`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" onClick={() => onChange(words.filter((item) => item !== word).join("、"))}><X className="size-3" /></button></span>) : <span className="text-xs text-muted-foreground">暂无关键词</span>}</div>
    </div>
    <div className="flex gap-2"><Input id={inputId} ref={inputRef} value={pending} disabled={disabled} placeholder="输入后回车添加，支持多个词" onChange={(event) => { setPending(event.target.value); event.currentTarget.setCustomValidity(event.target.value.trim() ? "请先按回车或点击添加关键词" : ""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addPending(); } }} /><Button type="button" variant="outline" disabled={disabled} onClick={addPending}><Plus className="size-4" />添加</Button></div>
    <span className="text-xs text-muted-foreground">已填写 {words.length} 个；每项最多 {maxLength} 字。</span>
    <details className="rounded-md border border-border p-2"><summary className="cursor-pointer text-xs text-muted-foreground">批量编辑</summary><Textarea aria-label={`${label}批量编辑`} className="mt-2" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></details>
  </div>;
}
