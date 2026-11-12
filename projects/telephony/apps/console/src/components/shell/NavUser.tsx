/*
 * 中文导读：应用外壳与导航的 NavUser 组件，封装该界面的展示与交互。
 */
"use client";

import { useRouter } from "next/navigation";
import {useState} from 'react';
import { useQueryClient } from "@tanstack/react-query";
import {
 BadgeCheck,
 ChevronsUpDown,
 LogOut,
 UsersRound,
 ArrowLeft,
} from "lucide-react";
import { toast } from "@/src/lib/toast";

import {
 Avatar,
 AvatarFallback,
 AvatarImage,
} from "@/src/components/ui/avatar";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuGroup,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
 DropdownMenuLabel,
} from "@/src/components/ui/dropdown-menu";
import {
 SidebarMenu,
 SidebarMenuButton,
 SidebarMenuItem,
} from "@/src/components/ui/sidebar";
import { authClient } from "@/src/lib/auth-client";
import { clearIdentityCache } from "@/src/lib/query-cache";
import { OrgSwitcher } from "@/src/components/shell/OrgSwitcher";
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {accountDisplayName} from '@/src/lib/account-display';
import {AccountSwitchDialog,useReturnToAdministrator} from './AccountSwitcher';

export interface NavUserProps {
 name: string;
 email: string;
 image: string | null;
}

function initials(name: string) {
 return name
 .split(" ")
 .map((p) => p[0])
 .filter(Boolean)
 .slice(0, 2)
 .join("")
 .toUpperCase();
}

export function NavUser({ user, activeOrgId }: { user: NavUserProps; activeOrgId: string }) {
 const router = useRouter();
 const queryClient = useQueryClient();
 const context=useCompanyContext(),{data:session}=authClient.useSession();
 const {data:organizations}=authClient.useListOrganizations();
 const workspaceName=organizations?.find(org=>org.id===activeOrgId)?.name||'当前工作区';
 const [switchOpen,setSwitchOpen]=useState(false);
 const {restore,busy:restoring}=useReturnToAdministrator();
 const currentUser=session?.user||user;

 async function signOut() {
 await authClient.signOut({
 fetchOptions: {
 onSuccess: () => {
 clearIdentityCache(queryClient);
 toast.success("已退出登录");
 router.push("/login");
 },
 },
 });
 }

 return (
 <><SidebarMenu>
 <SidebarMenuItem>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <SidebarMenuButton
 size="lg"
 aria-label="打开个人菜单"
 className="h-12 rounded-lg !bg-transparent px-2.5 shadow-none transition-colors hover:!bg-sidebar-accent/60 hover:text-sidebar-foreground data-[state=open]:!bg-sidebar-accent/70 data-[state=open]:text-sidebar-foreground"
 >
 <Avatar className="size-8 shrink-0 rounded-md">
 {currentUser.image ? (
 <AvatarImage src={currentUser.image} alt={currentUser.name} />
 ) : null}
 <AvatarFallback className="bg-primary/15 text-primary ring-1 ring-primary/20">
 {initials(currentUser.name)}
 </AvatarFallback>
 </Avatar>
 <div className="grid flex-1 text-left text-sm leading-tight">
 <span className="truncate font-semibold">{currentUser.name}</span>
 <span className="truncate text-xs text-muted-foreground/80">
 {accountDisplayName(currentUser.email)}
 </span>
 </div>
 <ChevronsUpDown className="ml-auto size-4 text-muted-foreground/70 transition-transform data-[state=open]:rotate-180" />
 </SidebarMenuButton>
 </DropdownMenuTrigger>
 <DropdownMenuContent
 className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg border border-border/70 p-1.5 shadow-lg"
 side="top"
 align="start"
 sideOffset={8}
 >
 <DropdownMenuLabel className="px-2.5 py-2"><span className="block text-xs font-normal text-muted-foreground">当前工作区</span><span className="mt-0.5 block truncate text-sm font-medium">{workspaceName}</span></DropdownMenuLabel>
 <DropdownMenuSeparator />
 <DropdownMenuGroup>
 <DropdownMenuItem className="rounded-md px-2.5 py-2" onClick={() => router.push("/settings/profile")}>
 <BadgeCheck />
 个人中心
 </DropdownMenuItem>
 <OrgSwitcher activeOrgId={activeOrgId} />
 {session?.session.impersonatedBy?<DropdownMenuItem disabled={restoring} onSelect={()=>void restore()} className="rounded-md px-2.5 py-2"><ArrowLeft/>返回超级管理员</DropdownMenuItem>:context.data?.isSystemAdmin&&<DropdownMenuItem onSelect={()=>setSwitchOpen(true)} className="rounded-md px-2.5 py-2"><UsersRound/>切换账号</DropdownMenuItem>}
 </DropdownMenuGroup>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="rounded-md px-2.5 py-2 text-muted-foreground" onClick={signOut}>
 <LogOut />
 退出登录
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </SidebarMenuItem>
 </SidebarMenu><AccountSwitchDialog open={switchOpen} onOpenChange={setSwitchOpen} activeOrgId={activeOrgId}/></>
 );
}
