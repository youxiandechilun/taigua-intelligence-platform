/*
 * 中文导读：login的路由页面；由 Next.js 按文件路由约定加载。
 */
import { LoginForm } from "@/src/components/forms/auth/login-form";
import Link from "next/link";
import LoginBg from "@/src/components/login-bg";
import LoginLogo from "@/src/components/login-logo";
import { LANDING_URL } from "@/src/lib/links";
import { ThemeModeSelect } from "@/src/components/theme-mode-select";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitationId?: string | string[] }>;
}) {
  const { invitationId } = await searchParams;
  
  return (
    <div className="taigua-login relative min-h-svh lg:grid lg:grid-cols-2 bg-background">
      <div className="absolute right-4 top-4 z-20 md:right-10 md:top-10"><ThemeModeSelect /></div>
      {/* Left side - Login Form */}
      <div className="flex min-h-svh flex-col gap-4 p-6 pt-16 sm:pt-6 md:p-10 h-full relative overflow-hidden">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link
            href={LANDING_URL}
            className="flex items-center gap-2 font-medium z-10"
          >
            
            <LoginLogo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs z-10">
            <LoginForm invitationId={typeof invitationId === "string" ? invitationId : ""} />
          </div>
        </div>
      </div>

      {/* Right side - Bot Illustration */}
      <div className=" hidden lg:flex items-center justify-center h-full overflow-hidden">
        <LoginBg />
      </div>
    </div>
  );
}
