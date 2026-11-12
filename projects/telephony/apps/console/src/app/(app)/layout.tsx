/*
 * 中文导读：应用根级的页面布局；由 Next.js 按文件路由约定加载。
 */
import {FeatureAreaGate,OutboundToolsGate} from "@/src/components/shell/FeatureAreaGate";
import { WorkspaceTitle } from "@/src/components/workspace/WorkspaceBrand";
import { cookies } from "next/headers";

import {
  SidebarInset,
  SidebarProvider,
} from "@/src/components/ui/sidebar";
import { AppSidebar } from "@/src/components/shell/AppSidebar";
import { Topbar } from "@/src/components/shell/Topbar";
import { PageActionsProvider } from "@/src/components/shell/PageActionsSlot";

import { requireSession,requireCompanyAccess } from "@/src/lib/server-session";
import { FloatingManualPhone } from "@/src/components/telephony/FloatingManualPhone";
import { LiveCallsProvider } from "@/src/providers/live-calls-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const company=await requireCompanyAccess();

  const cookieStore = await cookies();
  const sidebarState = cookieStore.get("sidebar_state")?.value;
  const defaultOpen = sidebarState !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <WorkspaceTitle />
      <AppSidebar
        activeOrgId={session.activeOrganizationId}
        systemAdmin={session.userRole.split(",").includes("admin")}
        user={{
          name: session.userName,
          email: session.userEmail,
          image: session.userImage,
        }}
      />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <PageActionsProvider>
          {company.canManage?<LiveCallsProvider
            key={session.activeOrganizationId}
            organizationId={session.activeOrganizationId}
          >
            <Topbar />
            <div data-app-content className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6 [&:has([data-live-call-dock])]:pb-24"><FeatureAreaGate>{children}</FeatureAreaGate></div>

          </LiveCallsProvider>:<><Topbar/><div data-app-content className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6"><FeatureAreaGate>{children}</FeatureAreaGate></div></>}
        </PageActionsProvider>
      </SidebarInset>
      <OutboundToolsGate><FloatingManualPhone /></OutboundToolsGate>
    </SidebarProvider>
  );
}
