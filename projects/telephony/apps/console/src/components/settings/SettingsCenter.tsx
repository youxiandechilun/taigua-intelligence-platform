/*
 * 中文导读：设置中心的 SettingsCenter 组件，封装该界面的展示与交互。
 */
"use client";

import Link from "next/link";
import { ArrowRight, UserRound, Building2, UsersRound, ChartNoAxesCombined, MessageCircle, PhoneCall, BrainCircuit, ShieldCheck, Palette, Plug, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/src/components/common/PageHeader";
import { Button } from "@/src/components/ui/button";
import { visibleSettingsGroups } from "@/src/lib/settings-navigation";
import type { CompanyContext } from "@/src/lib/api/resources/company";

const icons: Record<string,LucideIcon>={phone:PhoneCall,building:Building2,users:UsersRound,model:BrainCircuit,shield:ShieldCheck,message:MessageCircle,chart:ChartNoAxesCombined,palette:Palette,plug:Plug};
const sections=['业务配置','公司与人员','平台维护'] as const;

export function SettingsCenter({ access }: { access: CompanyContext }) {
  const groups=visibleSettingsGroups(access);
  return <main className="min-w-0 space-y-6">
    <PageHeader title="设置中心" actions={<Button asChild size="sm" variant="outline"><Link href="/settings/profile"><UserRound className="size-4" />个人资料</Link></Button>} />
    <div className="max-w-5xl space-y-6">
      {sections.map(section=>{
        const items=groups.filter(group=>group.section===section);
        if(!items.length)return null;
        return <section key={section} aria-label={section}>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">{section}</h2>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {items.map(group=>{
              const first=group.tabs[0]!;
              const Icon=icons[first.icon||'']||Plug;
              return <Link key={first.href} href={first.href} prefetch={false} className="group flex min-w-0 items-center gap-3 px-4 py-3.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <Icon aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7}/>
                <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{group.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{group.description}</p></div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </Link>;
            })}
          </div>
        </section>;
      })}
    </div>
  </main>;
}
