/*
 * 中文导读：应用根级的页面布局；由 Next.js 按文件路由约定加载。
 */
import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/src/providers/theme-provider";
import { QueryProvider } from "@/src/providers/query-provider";
import { TooltipProvider } from "@/src/components/ui/tooltip";

export const metadata: Metadata = {
  title: "泰卦数字员工",
  description:
    "泰卦数字员工，支持独立工作区的企业电销与客户沟通管理。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className="h-full antialiased font-sans"
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <QueryProvider>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </QueryProvider>
          <Toaster richColors closeButton containerAriaLabel="通知" />
        </ThemeProvider>
      </body>
    </html>
  );
}
