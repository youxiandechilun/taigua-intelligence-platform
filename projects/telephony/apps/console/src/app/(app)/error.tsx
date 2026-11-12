/*
 * 中文导读：应用根级的错误边界；由 Next.js 按文件路由约定加载。
 */
"use client";

import { Button } from "@/src/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { userMessage } from "@/src/lib/locale";

export default function AppError({
 error,
 reset,
}: {
 error: Error & { digest?: string };
 reset: () => void;
}) {
 return (
 <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
 <div className="max-w-md border bg-card p-8 text-center">
 <div className="mx-auto mb-5 flex size-12 items-center justify-center bg-destructive/10 text-destructive">
 <AlertTriangle className="size-6" />
 </div>
 <h2 className="text-lg font-semibold">出了点问题</h2>
 <p className="mt-2 text-sm text-muted-foreground">
 {error.message ? userMessage(error.message) : "页面暂时无法显示，请重试。"}
 </p>
 {error.digest ? (
 <p className="mt-2 font-mono text-xs text-muted-foreground">
 {error.digest}
 </p>
 ) : null}
 <div className="mt-6 flex items-center justify-center gap-2">
 <Button onClick={reset}>
 <RotateCcw /> 重试
 </Button>
 </div>
 </div>
 </div>
 );
}
