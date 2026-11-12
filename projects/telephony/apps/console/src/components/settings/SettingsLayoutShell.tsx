/*
 * 中文导读：设置中心的 SettingsLayoutShell 组件，封装该界面的展示与交互。
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, PhoneCall, Cloud, SlidersHorizontal, Building2, Megaphone, Monitor, Palette, UsersRound, ShieldCheck, BrainCircuit, AudioLines, Plug, KeyRound, MessageCircle, ChartNoAxesCombined } from "lucide-react";
import { PageHeader } from "@/src/components/common/PageHeader";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { settingsGroup, visibleSettingsTabs, type SettingsAccess } from "@/src/lib/settings-navigation";
const tabIcons={phone:PhoneCall,cloud:Cloud,rules:SlidersHorizontal,building:Building2,notice:Megaphone,screen:Monitor,palette:Palette,users:UsersRound,shield:ShieldCheck,model:BrainCircuit,voice:AudioLines,plug:Plug,key:KeyRound,message:MessageCircle,chart:ChartNoAxesCombined};

export function SettingsLayoutShell({ children, initialAccess }: { children: ReactNode; initialAccess: SettingsAccess }) {
  const pathname = usePathname();
  const context = useCompanyContext();
  const group = settingsGroup(pathname);
  const tabs = group ? visibleSettingsTabs(group, context.data ?? initialAccess) : [];
  return (
    <div className="w-full min-w-0 space-y-5">
      {pathname !== "/settings" && <Link href="/settings" className="inline-flex items-center gap-2 rounded text-xs text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-3.5" />返回设置中心</Link>}
      {group && <>
        {!group.pageOwnHeading && <PageHeader title={group.title} />}
        {tabs.length > 1 && <nav aria-label={group.title + "设置分类"} className="flex flex-wrap gap-x-1 gap-y-1 border-b">
          {tabs.map(tab => {
            const Icon=tab.icon?tabIcons[tab.icon]:null;
            return <Link key={tab.href} href={tab.href} prefetch={false} aria-current={pathname === tab.href ? "page" : undefined} className={"relative inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (pathname === tab.href ? "border-primary bg-primary/5 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>{Icon&&<Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.6}/>}<span>{tab.label}</span></Link>;
          })}
        </nav>}
      </>}
      {children}
    </div>
  );
}
