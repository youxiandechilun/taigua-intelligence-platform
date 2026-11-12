/*
 * 中文导读：共享基础能力的 logo1 组件，封装该界面的展示与交互。
 */
"use client";
import Image from "next/image";
import { DEFAULT_LOGIN_SLOGAN, usePlatformBranding } from "@/src/lib/api/resources/platform-branding";

export default function Logo() {
  const { data } = usePlatformBranding();
  return (
    <span className="flex flex-col items-start gap-2">
      <Image src="/brand/taigua-logo-transparent.png" alt="泰卦传媒" width={1848} height={266} className="h-auto w-64 max-w-full dark:hidden" />
      <Image src="/brand/taigua-logo-dark.webp" alt="泰卦传媒" width={1848} height={266} unoptimized className="hidden h-auto w-64 max-w-full dark:block" />
      <span className="max-w-sm text-sm font-medium leading-6 text-stone-500 dark:text-stone-400">{data?.loginSlogan ?? DEFAULT_LOGIN_SLOGAN}</span>
    </span>
  );
}
