/*
 * 中文导读：自动化流程的 AutomationLoading 组件，封装该界面的展示与交互。
 */
import { Loader2, Workflow } from "lucide-react";

export function AutomationLoading() {
  return <main className="flex w-full min-w-0 flex-col gap-4" aria-busy="true">
    <h1 className="flex items-center gap-2 text-2xl font-semibold"><Workflow className="size-6 text-primary" />自动化</h1>
    <div className="flex gap-2 border-b pb-3" aria-hidden="true">{[96, 88, 88, 100].map((width, index) => <span key={index} style={{ width }} className="h-9 rounded-md bg-muted motion-safe:animate-pulse" />)}</div>
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border bg-card" role="status">
      <Loader2 className="size-6 text-primary motion-safe:animate-spin" />
      <p className="text-sm font-medium">正在加载自动化…</p>
    </div>
  </main>;
}
