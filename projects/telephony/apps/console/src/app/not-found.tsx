/*
 * 中文导读：应用根级的未找到页面；由 Next.js 按文件路由约定加载。
 */
import Link from "next/link";
import { Button } from "@/src/components/ui/button";
import { ArrowRight, FileQuestion } from "lucide-react";

export default function NotFound() {
 return (
 <div className="flex min-h-screen items-center justify-center bg-background px-4">
 <div className="max-w-md text-center">
 <div className="mx-auto mb-6 flex size-16 items-center justify-center bg-gradient-to-br from-primary/30 to-primary/5 text-primary">
 <FileQuestion className="size-8" />
 </div>
 <h1 className="text-3xl font-semibold tracking-tight">页面不存在</h1>
 <p className="mt-2 text-sm text-muted-foreground">
 你查找的页面不存在，或已移动。
 </p>
 <div className="mt-6">
 <Button asChild>
 <Link href="/dashboard">
 前往仪表盘 <ArrowRight />
 </Link>
 </Button>
 </div>
 </div>
 </div>
 );
}
