/*
 * 中文导读：应用外壳与导航的 Topbar 组件，封装该界面的展示与交互。
 */
"use client";

import { DashboardAnnouncement } from "@/src/components/dashboard/DashboardAnnouncement";
import { Separator } from "@/src/components/ui/separator";
import { SidebarTrigger } from "@/src/components/ui/sidebar";
import { Breadcrumbs } from "@/src/components/shell/Breadcrumbs";
import { usePageActionsSlot } from "@/src/components/shell/PageActionsSlot";
import {ImpersonationBanner} from './AccountSwitcher';
import {VoiceOperationsBanner} from '@/src/components/telephony/VoiceOperationsBanner';

export function Topbar() {
  const { slot } = usePageActionsSlot();

  return (
    <><ImpersonationBanner/><header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear">
      <div className="flex min-w-0 w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumbs />
        <DashboardAnnouncement />
        <div className="ml-auto flex shrink-0 items-center gap-2">{slot}</div>
      </div>
    </header><VoiceOperationsBanner/></>
  );
}
