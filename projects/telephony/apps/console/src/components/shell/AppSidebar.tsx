/*
 * 中文导读：应用外壳与导航的 AppSidebar 组件，封装该界面的展示与交互。
 */
"use client";

import * as React from "react";
import {
  LayoutDashboard,
  Bot,
  Mic2,
  FileAudio,
  PhoneCall,
  PhoneOutgoing,
  BookOpen,
  Settings2,
  Wrench,
  Workflow,
  Building2,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from "@/src/components/ui/sidebar";
import { NavMain, type NavItem } from "@/src/components/shell/NavMain";
import { useCompanyContext,hasCompanyPermission } from "@/src/lib/api/resources/company";
import {navigationDefaults,defaultNavigationPolicy} from "@/src/lib/navigation";
import { WorkspaceBrand } from "@/src/components/workspace/WorkspaceBrand";
import Link from "next/link";
import { NavUser, type NavUserProps } from "@/src/components/shell/NavUser";

const primaryNav: NavItem[] = [
  { title: "仪表盘", href: "/dashboard", icon: LayoutDashboard },
  { title: "数字员工", href: "/agents", icon: Bot },
  { title: "外呼", href: "/outbound", icon: PhoneOutgoing },
  { title: "通话记录", href: "/calls", icon: PhoneCall },
  { title: "知识库", href: "/kb", icon: BookOpen },
  { title: "客户库", href: "/crm", icon: Building2 },
  { title: "企业微信", href: "/wecom", icon: MessageCircle },
  { title: "业务工具", href: "/tools", icon: Wrench },
  { title: "自动化", href: "/automation", icon: Workflow },
];

const settingsNav: NavItem[] = [
  {
    title: "设置中心",
    href: "/settings",
    icon: Settings2,
  },
];

export function AppSidebar({
  activeOrgId,
  systemAdmin = false,
  user,
  ...props
}: {
  activeOrgId: string;
  systemAdmin?: boolean;
  user: NavUserProps;
} & React.ComponentProps<typeof Sidebar>) {
  const context = useCompanyContext();
  const isAdmin=context.data?.isSystemAdmin??systemAdmin;
  const originals=[...primaryNav,...settingsNav];
  const resource:Record<string,string>={'/agents':'agent','/outbound':'outboundCalls','/calls':'callLogs','/kb':'knowledgeSource','/crm':'crm','/wecom':'wecom','/tools':'crm','/automation':'automation'};
  const items=(!context.data&&!isAdmin?[]:(context.data?.navigation||defaultNavigationPolicy()).items).flatMap(menu=>{
    const definition=navigationDefaults.find(item=>item.id===menu.id),item=originals.find(item=>item.href===definition?.href);
    if(!item)return [];
    if(!isAdmin&&(!menu.enabled||item.href!=='/settings'&&!hasCompanyPermission(context.data,item.href==='/dashboard'?'callLogs':resource[item.href],'read')))return [];
    return [{...item,title:menu.label}];
  });
  const learningVisible=isAdmin||hasCompanyPermission(context.data,'agentConfiguration','update');
  const settingsEnabled=isAdmin||context.data?.navigation?.items.find(item=>item.id==='settings')?.enabled!==false;
  if(learningVisible&&settingsEnabled){const agentIndex=items.findIndex(item=>item.href==='/agents');const index=agentIndex>=0?agentIndex+1:Math.max(0,items.findIndex(item=>item.href==='/settings'));items.splice(index,0,{title:'声音库',href:'/voices',icon:Mic2});}
  if(learningVisible&&settingsEnabled){const index=items.findIndex(item=>item.href==='/voices');items.splice(index<0?items.length:index,0,{title:'录音学习',href:'/recording-learning',icon:FileAudio});}
  const recognitionVisible = settingsEnabled && (isAdmin || hasCompanyPermission(context.data, 'lines', 'read'));
  if (recognitionVisible) {
    const settingsIndex = items.findIndex(item => item.href === '/settings');
    items.splice(settingsIndex < 0 ? items.length : settingsIndex, 0, { title: '识别与拦截', href: '/recognition', icon: ShieldCheck });
  }
  const isWorkspaceItem = (item: NavItem) => item.href === '/settings' || item.href === '/recognition';
  const groups = [
    { label: '平台', items: items.filter(item => !isWorkspaceItem(item)) },
    { label: '工作区', items: items.filter(isWorkspaceItem) },
  ].filter(group => group.items.length > 0);
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="min-w-0 shrink-0 border-b border-sidebar-border/60 px-3 py-2 group-data-[collapsible=icon]:p-2">
        <Link
          href="/dashboard"
          aria-label="当前工作区首页"
          className="flex min-h-10 w-full min-w-0 items-center justify-center overflow-hidden rounded p-0"
        >
          <WorkspaceBrand />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1 py-2.5">
        {groups.map((group,index)=><React.Fragment key={group.label}>
          {index>0&&<SidebarSeparator className="mx-5 bg-sidebar-border/50"/>}
          <NavMain label={group.label} items={group.items}/>
        </React.Fragment>)}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60 p-3.5">
        <NavUser user={user} activeOrgId={activeOrgId} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
