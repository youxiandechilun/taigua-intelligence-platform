/*
 * 中文导读：设置中心 / 组织与成员的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { ChevronDown, Building2, Megaphone, Monitor, ListOrdered } from "lucide-react";
import { requireCompanyAccess } from "@/src/lib/server-session";
import { WorkspaceSettings } from "@/src/components/workspace/WorkspaceSettings";
import { AnnouncementManager } from "@/src/components/workspace/AnnouncementManager";
import {NavigationSettings} from "@/src/components/settings/NavigationSettings";
import { PlatformBrandingSettings } from "@/src/components/settings/PlatformBrandingSettings";

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const [access, params] = await Promise.all([requireCompanyAccess(), searchParams]);
  if (!access.isSystemAdmin && !access.canManageAnnouncements) redirect("/settings");
  const active = params.section ?? (access.isSystemAdmin ? "brand" : "announcements");
  const sections = [
    ...(access.isSystemAdmin ? [{ id: "menus", title: "功能区菜单", description: "菜单名称、上下排序与功能开关", icon: ListOrdered, content: <NavigationSettings /> }] : []),
    ...(access.isSystemAdmin ? [{ id: "brand", title: "公司资料与品牌", description: "公司信息、联系方式与 Logo", icon: Building2, content: <WorkspaceSettings /> }] : []),
    ...(access.canManageAnnouncements ? [{ id: "announcements", title: "公司公告", description: "发布、编辑和管理首页公告", icon: Megaphone, content: <AnnouncementManager /> }] : []),
    ...(access.isSystemAdmin ? [{ id: "login", title: "公共登录页", description: "登录页标语与预览", icon: Monitor, content: <PlatformBrandingSettings /> }] : []),
  ];
  return <div className="space-y-3" aria-label="公司设置">
    {sections.map(section => <details key={section.id} name="company-settings" id={section.id} open={active === section.id} className="group overflow-hidden rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <section.icon aria-hidden="true" className="size-4 shrink-0 text-primary" strokeWidth={1.6} />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{section.title}</span><span className="mt-1 block text-xs text-muted-foreground">{section.description}</span></span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t [&_section]:rounded-none [&_section]:border-0 [&_section>h2]:sr-only [&_section>div>h2]:sr-only">{section.content}</div>
    </details>)}
  </div>;
}
