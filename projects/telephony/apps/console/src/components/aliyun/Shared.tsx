/*
 * 中文导读：阿里云连接的 Shared 组件，封装该界面的展示与交互。
 */
"use client";
import { businessMessage } from "@/src/lib/business-copy";
import Link from "next/link";
import { Cloud, CheckCircle2, CircleAlert } from "lucide-react";
import { useAliyunConfig } from "@/src/hooks/queries/aliyun";
import { Button } from "@/src/components/ui/button";
export function ConnectionStatus() {
  const config = useAliyunConfig();
  return <div className="flex flex-wrap items-center justify-between gap-4 border bg-card p-4">
    <div className="flex items-start gap-3"><Cloud className="mt-1 size-5 text-primary" /><div>
      <p className="font-medium">阿里云 AI 通话</p>
      <p className="mt-1 text-sm text-muted-foreground">{config.isLoading ? "读取配置中…" : config.error ? config.error.message : config.data?.ready ? `连接参数已齐全 · ${config.data.liveEnabled ? "真实外呼已启用" : "真实外呼已关闭"}` : `待配置：${config.data?.missing.join("、") ?? "请打开配置页"}`}</p>
    </div></div>
    <Button asChild variant="outline"><Link href="/settings/aliyun">配置阿里云</Link></Button>
  </div>;
}
export function Notice({ children, success = false }: { children: React.ReactNode; success?: boolean }) {
  return <div role="status" className={`flex items-start gap-2 border p-3 text-sm ${success ? "border-primary/15 bg-primary/5 text-primary" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"}`}>
    {success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}{typeof children === "string" ? businessMessage(children) : children}
  </div>;
}
