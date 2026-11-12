/*
 * 中文导读：数字员工与话术的 AnalysisTab 组件，封装该界面的展示与交互。
 */
"use client";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAliyunAgentResults } from "@/src/hooks/queries/aliyun";
import { Button } from "@/src/components/ui/button";
const labels: Record<string, string> = {
  COMPLETED: "已接通",
  FAILED: "失败",
  NOT_ANSWERED: "未接通",
  IN_PROGRESS: "通话中",
  SCHEDULED: "待拨打",
  SUCCESS: "已整理",
  QUEUED: "等待整理",
  RUNNING: "整理中",
  NOT_STARTED: "尚未整理",
};
export function AnalysisTab({ agentId, compact=false }: { agentId: string; compact?:boolean }) {
  const q = useAliyunAgentResults(agentId),
    s = q.data;
  if (!s)
    return <p>{q.error ? "通话数据加载失败，请刷新" : "正在加载通话结果…"}</p>;
  return (
    <section className={compact?"space-y-5":"space-y-5 rounded-lg border bg-card p-5"}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold">本员工通话结果</h2>
          <p className="text-sm text-muted-foreground mt-2">
            共 {s.callsCount} 次通话 · 接通 {s.completed} 次 · 通话整理
            {s.summaryEnabled ? "已开启" : "未开启"}
          </p>
        </div>
        <Button variant="outline" onClick={() => void q.refetch()}><RefreshCw aria-hidden="true" className="size-4" />
          刷新结果
        </Button>
      </header>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/automation?view=company">通话整理与跟进待办</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/calls?agentId=${agentId}`}>查看本员工全部通话</Link>
        </Button>
      </div>
      {s.recent.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b text-muted-foreground">
                {[
                  "客户电话",
                  "通话时间",
                  "结果",
                  "时长",
                  "文字 / 录音",
                  "AI 整理",
                  "详情",
                ].map((t) => (
                  <th className="p-3 whitespace-nowrap font-medium" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.recent.map((c) => (
                <tr className="border-b" key={c.id}>
                  <td className="p-3">{c.phone || "未提供"}</td>
                  <td className="p-3 whitespace-nowrap">
                    {c.time
                      ? new Date(c.time).toLocaleString("zh-CN")
                      : "未提供"}
                  </td>
                  <td className="p-3">{labels[c.status] || "状态待确认"}</td>
                  <td className="p-3">{c.duration} 秒</td>
                  <td className="p-3">
                    {c.hasTranscript ? "有文字" : "无文字"} /{" "}
                    {c.hasRecording ? "有录音" : "无录音"}
                  </td>
                  <td className="p-3">
                    {c.summary === "FAILED"
                      ? "整理失败"
                      : labels[c.summary] || "状态待确认"}
                    {c.summaryError ? (
                      <p className="text-xs text-destructive max-w-48">
                        {c.summaryError}
                      </p>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/calls/${c.id}`}
                      className="text-primary hover:underline"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h3 className="font-medium">尚无本员工的通话记录</h3>
          
        </div>
      )}
      
    </section>
  );
}
