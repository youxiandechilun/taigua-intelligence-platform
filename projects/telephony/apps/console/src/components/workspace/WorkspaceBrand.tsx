/*
 * 中文导读：工作区与权限的 WorkspaceBrand 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Building2 } from "lucide-react";
import { useWorkspaceProfile } from "@/src/lib/api/resources/workspace";

const DEFAULT_TITLE = "泰卦数字员工";

const TAIGUA_LOGOS = [
  "/brand/taigua-logo.png",
  "/brand/taigua-logo-transparent.png",
  "/brand/taigua-logo-dark.webp",
];

function TaiguaWorkspaceLogo({ name }: { name: string }) {
  const className = "block h-auto max-h-12 w-full min-w-0 max-w-full shrink object-contain object-center group-data-[collapsible=icon]:size-8";
  return (
    <>
      <Image src="/brand/taigua-logo-transparent.png" alt={`${name}品牌标志`} width={1848} height={266} unoptimized className={`${className} dark:hidden`} />
      <Image src="/brand/taigua-logo-dark.webp" alt={`${name}品牌标志`} width={1848} height={266} unoptimized className={`${className} hidden dark:block`} />
    </>
  );
}

export function WorkspaceBrand() {
  const { data } = useWorkspaceProfile();
  if (!data) {
    return <div aria-hidden="true" className="h-8 w-full group-data-[collapsible=icon]:size-8" />;
  }
  if (TAIGUA_LOGOS.includes(data.logo || "")) {
    return <TaiguaWorkspaceLogo name={data.brandName || "泰卦传媒"} />;
  }
  if (data.logo) {
    return <Image src={data.logo} alt={data.brandName + " Logo"} width={800} height={240} unoptimized className="block h-auto max-h-12 w-full min-w-0 max-w-full shrink object-contain object-center group-data-[collapsible=icon]:size-8" />;
  }
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      <Building2 className="size-6 shrink-0 text-primary" />
      <span className="truncate text-lg font-semibold group-data-[collapsible=icon]:hidden">{data.brandName || DEFAULT_TITLE}</span>
    </div>
  );
}

export function WorkspaceTitle() {
  const { data } = useWorkspaceProfile();
  const name = data?.brandName;
  const path = usePathname();
  useEffect(() => {
    document.title = name ? `${name} · 数字员工` : DEFAULT_TITLE;
    return () => { document.title = DEFAULT_TITLE; };
  }, [name, path]);
  return null;
}
