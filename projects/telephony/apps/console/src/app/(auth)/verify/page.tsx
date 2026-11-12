/*
 * 中文导读：verify的路由页面；由 Next.js 按文件路由约定加载。
 */
import { Mail } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { invitationPath } from "@/src/lib/links";
import Link from "next/link";

export default async function VerifyAccount({
  searchParams,
}: {
  searchParams: Promise<{ invitationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const invitationId = typeof params.invitationId === "string" ? params.invitationId : "";

  return (
    <main className="min-h-screen flex flex-col justify-center items-center bg-background px-4 py-10 sm:px-6 md:px-10">
      <div className="w-full max-w-md bg-card border shadow-lg py-10 px-5 sm:px-8">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="bg-primary/10 p-4">
            <Mail className="h-10 w-10 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">请查看邮箱</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            如果该邮箱可以注册新账号，请查看收件箱和垃圾邮件中的验证链接，打开链接完成注册。
          </p>
          <div className="w-full border-t pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              已有账号？请使用现有密码登录，或在下方重置密码。
            </p>
            <div className="grid gap-3">
              <Button asChild className="min-h-11">
                <Link href={invitationPath(invitationId, "/login")}>登录</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <Link href={invitationPath(invitationId, "/forgot-password")}>重置密码</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
