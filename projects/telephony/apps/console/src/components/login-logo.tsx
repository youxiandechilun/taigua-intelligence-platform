/*
 * 中文导读：共享基础能力的 login-logo 组件，封装该界面的展示与交互。
 */
"use client";

import Image from "next/image";
import { DEFAULT_LOGIN_SLOGAN, usePlatformBranding } from "@/src/lib/api/resources/platform-branding";

export default function LoginLogo() {
  const { data } = usePlatformBranding();

  return (
    <span className="flex max-w-full flex-col items-start gap-2">
      <span className="inline-flex max-w-full dark:rounded-sm dark:bg-white dark:p-2">
        <Image
          src="/brand/taigua-login-20261028.png"
          alt="TAIKUA · 泰卦"
          width={2226}
          height={228}
          unoptimized
          className="h-auto w-72 max-w-full sm:w-80"
        />
      </span>
      <span className="max-w-sm text-sm font-medium leading-6 text-stone-500 dark:text-stone-400">{data?.loginSlogan ?? DEFAULT_LOGIN_SLOGAN}</span>
    </span>
  );
}
