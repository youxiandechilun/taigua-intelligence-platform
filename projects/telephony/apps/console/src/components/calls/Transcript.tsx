/*
 * 中文导读：通话记录的 Transcript 组件，封装该界面的展示与交互。
 */
"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { cn } from "@/src/lib/utils";
import { useTranscript } from "@/src/hooks/queries/calls";

export function Transcript({ callId, compact = false }: { callId: string; compact?: boolean }) {
  const q = useTranscript(callId);
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border bg-background p-6 text-sm text-muted-foreground shadow-sm">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MessageCircle className="size-5" />
        </div>
        <p className="font-medium text-foreground">暂无文字记录</p>
        <p className="mt-1">此通话尚无对话消息。</p>
      </div>
    );
  }

  return (
    <div className={compact ? "min-w-0" : "space-y-3"}>
      {rows.map((r) => {
        const isAgent = r.speaker === "agent" || r.speaker === "assistant";
        const timestamp = new Date(r.timestamp).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "numeric", minute: "2-digit" });
        if (compact) {
          return (
            <div key={r.callTransId} className="min-w-0 border-b border-border/70 py-3 first:pt-0 last:border-0 last:pb-0">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className={cn("flex items-center gap-2 text-xs font-medium", isAgent ? "text-primary" : "text-muted-foreground")}>
                  <span className={cn("size-1.5 rounded-full", isAgent ? "bg-primary" : "bg-slate-400")} aria-hidden="true" />
                  {isAgent ? "数字员工" : "客户"}
                </span>
                <time dateTime={r.timestamp} className="shrink-0 text-xs tabular-nums text-muted-foreground">{timestamp}</time>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{r.messageText}</p>
            </div>
          );
        }
        return (
          <div
            key={r.callTransId}
            className={cn("group flex", isAgent ? "justify-start" : "justify-end")}
          >
            <div
              className={cn(
                "max-w-[88%] rounded-2xl border px-4 py-3 shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5 sm:max-w-[76%]",
                isAgent
                  ? "rounded-tl-md bg-background text-foreground"
                  : "rounded-tr-md border-blue-600/20 bg-blue-600 text-white"
              )}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
                {isAgent ? "数字员工" : "客户"}
              </p>
              <p className="text-sm leading-6">{r.messageText}</p>
              <p className={cn("mt-2 text-right text-xs", isAgent ? "text-muted-foreground" : "text-white/70")}>
                {timestamp}
              </p>
            </div>
          </div>
        );
      })}

      {q.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? (
              <>
                <Loader2 className="animate-spin" /> 加载中…
              </>
            ) : (
              "加载更多"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
