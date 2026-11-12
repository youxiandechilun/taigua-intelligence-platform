/*
 * 中文导读：orgs的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { clearIdentityCache } from "@/src/lib/query-cache";
import { toast } from "@/src/lib/toast";
import { Button } from "@/src/components/ui/button";
import Logo from "@/src/components/logo1";
export default function WorkspacesPage() {
  const company=useCompanyContext();
  const { data: organizations, isPending, error, refetch } = authClient.useListOrganizations();
  const { data: session } = authClient.useSession(); const router = useRouter(); const queryClient = useQueryClient(); const [busy, setBusy] = useState<string | null>(null);
  async function open(id: string) {
    if (busy) return; setBusy(id);
    try { const { error } = await authClient.organization.setActive({ organizationId: id }); if (error) throw new Error(error.message); clearIdentityCache(queryClient); router.push("/dashboard"); router.refresh(); }
    catch(e) { toast.error(e instanceof Error ? e.message : "工作区暂时无法打开"); } finally { setBusy(null); }
  }
  return <main className="mx-auto max-w-3xl space-y-8 px-6 py-10"><Link href="/dashboard" aria-label="返回后台"><Logo /></Link><header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">我的工作区</h1></div>{(company.data?.role==="owner"||session?.user.role?.split(",").includes("admin"))&&<Button asChild><Link href="/orgs/create"><Plus className="size-4"/>新增工作区</Link></Button>}</header>
    {isPending && <p className="text-muted-foreground">正在加载工作区…</p>}{error && <div role="alert"><p className="text-destructive">工作区加载失败，请重试。</p><Button variant="outline" onClick={() => void refetch()}>重新加载</Button></div>}
    <div className="space-y-3">{(organizations ?? []).map(org => <section key={org.id} className="flex flex-wrap items-center gap-4 border bg-card p-5"><Building2 className="size-5 text-muted-foreground"/><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{org.name}</h2>{session?.session.activeOrganizationId === org.id && <p className="mt-1 text-xs text-primary">当前工作区</p>}</div><Button variant="outline" onClick={() => void open(org.id)} disabled={!!busy}>{busy === org.id ? "正在打开…" : "打开工作区"}</Button></section>)}</div>
    {!isPending && !error && !organizations?.length && <p className="text-muted-foreground">还没有分配工作区，请联系管理员。</p>}
    <Button asChild variant="ghost"><Link href="/dashboard">返回后台</Link></Button>
  </main>;
}
