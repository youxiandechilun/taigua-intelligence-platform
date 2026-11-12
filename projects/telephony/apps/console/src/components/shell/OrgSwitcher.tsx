/*
 * 中文导读：应用外壳与导航的 OrgSwitcher 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Building2, Check, Plus } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { clearIdentityCache } from "@/src/lib/query-cache";
import { toast } from "@/src/lib/toast";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/src/components/ui/dropdown-menu";

export function OrgSwitcher({ activeOrgId }: { activeOrgId: string }) {
  const { data: session } = authClient.useSession();
  const canCreate = session?.user.role?.split(",").includes("admin") === true;
  const { data: organizations, isPending } = authClient.useListOrganizations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function switchTo(id: string) {
    if (busy || id === activeOrgId) return;
    setBusy(true);
    try {
      const { error } = await authClient.organization.setActive({ organizationId: id });
      if (error) throw new Error(error.message);
      clearIdentityCache(queryClient);
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工作区切换失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return <DropdownMenuSub>
    <DropdownMenuSubTrigger className="rounded-md px-2.5 py-2" disabled={busy}><Building2 aria-hidden="true" /><span>切换工作区</span>{organizations&&<span className="ml-auto mr-1 text-xs text-muted-foreground">{organizations.length}个</span>}</DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent className="min-w-60 max-w-80 rounded-lg border border-border/70">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">选择工作区</DropdownMenuLabel>
        <div className="max-h-64 overflow-y-auto">
          {isPending && <p className="px-2 py-3 text-sm text-muted-foreground">正在加载…</p>}
          {(organizations ?? []).map(org => <DropdownMenuItem key={org.id} onSelect={() => void switchTo(org.id)} disabled={busy||org.id===activeOrgId} className={`gap-2 ${org.id===activeOrgId?'bg-primary/5 text-primary data-[disabled]:opacity-100':''}`}>
            <Building2 aria-hidden="true" className="size-4" /><span className="flex-1 truncate">{org.name}</span>
            {org.id === activeOrgId && <><span className="text-xs">当前</span><Check aria-hidden="true" className="size-3.5 text-primary" /></>}
          </DropdownMenuItem>)}
        </div>
        <DropdownMenuSeparator />
        {canCreate && <DropdownMenuItem asChild><Link href="/orgs/create"><Plus aria-hidden="true" className="size-4" />新增工作区</Link></DropdownMenuItem>}
        <DropdownMenuItem asChild><Link href="/orgs"><Building2 aria-hidden="true" className="size-4" />管理我的工作区</Link></DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>;
}
