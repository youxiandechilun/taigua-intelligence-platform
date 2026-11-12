/*
 * 中文导读：设置中心的 AccountsManager 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, ShieldCheck, ArrowRightLeft, Trash2, RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/src/lib/auth-client";
import { accountsApi, type Credentials, type ManagedCompany } from "@/src/lib/api/resources/accounts";
import { clearIdentityCache } from "@/src/lib/query-cache";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { toast } from "@/src/lib/toast";

export function AccountsManager() {
  const router = useRouter(), client = useQueryClient();
  const { data: session } = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const [view, setView] = useState("companies"), [deletedView, setDeletedView] = useState(false), [search, setSearch] = useState("");
  const companies = useQuery({ queryKey: ["platform-companies", session?.user.id], queryFn: () => accountsApi.companies(), enabled: Boolean(session?.user.id) });
  const recycle = useQuery({ queryKey: ["platform-deleted-companies", session?.user.id], queryFn: () => accountsApi.companies(true), enabled: Boolean(session?.user.id) && view === "companies" && deletedView });
  const accounts = useQuery({ queryKey: ["platform-super-administrators", session?.user.id], queryFn: async () => (await accountsApi.list()).filter(a => a.role?.split(",").includes("admin")), enabled: Boolean(session?.user.id) && view === "administrators" });
  const [creating, setCreating] = useState(false), [addingCompany, setAddingCompany] = useState(false), [companyName, setCompanyName] = useState(""), [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(""), [name, setName] = useState(""), [companyId, setCompanyId] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null), [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<{ company: ManagedCompany; kind: "delete" | "restore" } | null>(null), [confirmationName, setConfirmationName] = useState(""), [operationError, setOperationError] = useState("");
  const displayed = deletedView ? recycle : companies;
  const list = (displayed.data ?? []).filter(company => company.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setOperationError("");
    try { await action(); }
    catch (e) { const message = e instanceof Error ? e.message : "操作未完成"; setOperationError(message); toast.error(message); }
    finally { setBusy(false); }
  }
  async function refreshCompanies() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["platform-companies"] }),
      client.invalidateQueries({ queryKey: ["platform-deleted-companies"] }),
      client.invalidateQueries({ queryKey: ["platform-super-administrators"] }),
      organizations.refetch(),
    ]);
  }
  async function switchCompany(company: ManagedCompany) {
    if (company.accessStatus !== "ACTIVE" || company.id === session?.session.activeOrganizationId) return;
    await run(async () => {
      const result = await authClient.organization.setActive({ organizationId: company.id });
      if (result.error) throw new Error(result.error.message || "公司切换失败");
      clearIdentityCache(client);
      router.push("/settings/members"); router.refresh();
    });
  }
  function prepare(company: ManagedCompany, kind: "delete" | "restore") {
    setConfirmationName(""); setOperationError(""); setPending({ company, kind });
  }
  async function confirmCompanyAction() {
    if (!pending) return;
    await run(async () => {
      if (pending.kind === "delete") {
        await accountsApi.deleteCompany(pending.company.id, confirmationName.trim());
        if (companyId === pending.company.id) setCompanyId("");
        toast.success("公司工作区已移入回收站");
      } else {
        await accountsApi.restoreCompany(pending.company.id);
        toast.success("公司工作区已恢复，自动任务保持关闭");
      }
      setPending(null);
      await refreshCompanies();
    });
  }

  return <div className="space-y-4">
    {((view === "companies" ? displayed.error : accounts.error) || (!pending && operationError)) && <p role="alert" className="text-sm text-destructive">{(view === "companies" ? displayed.error : accounts.error)?.message || operationError}</p>}
    <Tabs value={view} onValueChange={value => { if (!busy) { setView(value); setOperationError(""); } }} className="gap-4">
      <TabsList variant="line" aria-label="平台管理分类"><TabsTrigger value="companies" disabled={busy}><Building2 className="size-4" />公司工作区</TabsTrigger><TabsTrigger value="administrators" disabled={busy}><ShieldCheck className="size-4" />超级管理员</TabsTrigger></TabsList>
      <TabsContent value="companies">
        <section className="overflow-hidden rounded-xl border bg-card" aria-label={deletedView ? "工作区回收站" : "公司工作区列表"}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索公司工作区" className="h-9 w-60 pl-9" placeholder={deletedView ? "搜索回收站工作区" : "搜索公司工作区"} value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDeletedView(value => !value); setSearch(""); setOperationError(""); }}><Trash2 className="size-3.5" />{deletedView ? "返回公司列表" : "回收站"}</Button>{!deletedView && <Button size="sm" disabled={busy} onClick={() => setAddingCompany(true)}><Plus className="size-4" />新增公司</Button>}</div>
          </div>
          {deletedView && <div className="border-b bg-muted/20 px-5 py-3 text-sm font-medium">工作区回收站</div>}
          <div className="divide-y">{list.map(company => {
            const current = session?.session.activeOrganizationId === company.id;
            return <div key={company.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="size-4" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{company.name}</p>{deletedView ? <p className="mt-1 text-xs text-muted-foreground">删除于 {company.deletedAt ? new Date(company.deletedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</p> : current ? <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary"><span className="size-1.5 rounded-full bg-primary" />当前公司</span> : company.accessStatus !== "ACTIVE" ? <p className="mt-1 text-xs text-muted-foreground">{company.accessStatus === "DISABLED" ? "访问已停用" : "未分配访问权限"}</p> : null}</div></div>
              <div className="flex items-center gap-2">{deletedView ? <Button size="sm" variant="outline" disabled={busy} aria-label={"恢复" + company.name} onClick={() => prepare(company, "restore")}><RotateCcw className="size-3.5" />恢复</Button> : <>
                {!current && company.accessStatus === "ACTIVE" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void switchCompany(company)}><ArrowRightLeft className="size-3.5" />切换公司</Button>}
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy || current} title={current ? "当前公司不能删除" : "移入工作区回收站"} aria-label={"删除" + company.name} onClick={() => prepare(company, "delete")}><Trash2 className="size-3.5" />删除</Button>
              </>}</div>
            </div>;
          })}</div>
          {displayed.isPending ? <p role="status" className="p-6 text-sm text-muted-foreground">正在加载工作区…</p> : !displayed.error && !list.length && <p className="p-8 text-center text-sm text-muted-foreground">{search ? "没有找到对应的工作区" : deletedView ? "回收站中暂无工作区" : "暂无公司工作区"}</p>}
        </section>
      </TabsContent>
      <TabsContent value="administrators">
        <section className="overflow-hidden rounded-xl border bg-card" aria-label="超级管理员列表">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4"><span className="text-sm text-muted-foreground">{accounts.data?.length ?? 0} 位超级管理员</span><Button size="sm" onClick={() => setCreating(true)} disabled={busy || companies.isPending || !!companies.error}><Plus className="size-4" />新增超级管理员</Button></div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">姓名 / 账号</th><th className="px-5 py-3 font-medium">所属公司</th><th className="px-5 py-3 font-medium">状态</th></tr></thead><tbody>{accounts.data?.map(account => <tr key={account.id} className="border-b last:border-0"><td className="px-5 py-4"><p className="font-medium">{account.name}</p><p className="mt-1 text-xs text-muted-foreground">{account.username}</p></td><td className="px-5 py-4">{account.members.filter(member => companies.data?.some(company => company.id === member.organization.id)).map(member => member.organization.name).join("、") || "—"}</td><td className="px-5 py-4">{account.banned ? "已停用" : "正常"}</td></tr>)}</tbody></table></div>
          {accounts.isPending && <p role="status" className="p-5 text-sm text-muted-foreground">正在加载账号…</p>}
        </section>
      </TabsContent>
    </Tabs>

    <Dialog open={Boolean(pending)} onOpenChange={open => { if (!busy && !open) setPending(null); }}><DialogContent><DialogHeader><DialogTitle>{pending?.kind === "delete" ? "删除公司工作区" : "恢复公司工作区"}</DialogTitle><DialogDescription>{pending?.kind === "delete" ? "删除后成员无法进入此工作区，自动任务停止。员工、客户及历史资料保留，可在回收站恢复。" : "恢复工作区及原有成员访问权限；自动任务、接听状态和对外入口保持关闭，需要手动开启。"}</DialogDescription></DialogHeader>
      <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm font-medium">{pending?.company.name}</p>
      {pending?.kind === "delete" && <label className="grid gap-2 text-sm">输入完整工作区名称确认<Input aria-label="确认删除的工作区名称" value={confirmationName} onChange={e => setConfirmationName(e.target.value)} autoComplete="off" disabled={busy} placeholder={pending.company.name} /></label>}
      {operationError && <p role="alert" className="text-sm text-destructive">{operationError}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button><Button variant={pending?.kind === "delete" ? "destructive" : "default"} disabled={busy || (pending?.kind === "delete" && confirmationName.trim() !== pending.company.name)} onClick={() => void confirmCompanyAction()}>{busy ? "正在处理…" : pending?.kind === "delete" ? "移入回收站" : "确认恢复"}</Button></div>
    </DialogContent></Dialog>

    <Dialog open={addingCompany} onOpenChange={open => { if (!busy) setAddingCompany(open); }}><DialogContent><DialogHeader><DialogTitle>新增公司工作区</DialogTitle><DialogDescription className="sr-only">创建独立的公司工作区。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => { await accountsApi.createCompany(companyName.trim()); setCompanyName(""); setAddingCompany(false); setDeletedView(false); await refreshCompanies(); toast.success("公司已新增"); }); }}><label className="grid gap-2 text-sm">公司名称<Input aria-label="新增公司名称" value={companyName} onChange={e => setCompanyName(e.target.value)} required maxLength={80} disabled={busy} /></label><div className="flex justify-end gap-2"><Button variant="outline" type="button" disabled={busy} onClick={() => setAddingCompany(false)}>取消</Button><Button disabled={busy || !companyName.trim()}>新增公司</Button></div></form></DialogContent></Dialog>

    <Dialog open={creating} onOpenChange={open => { if (!busy) setCreating(open); }}><DialogContent><DialogHeader><DialogTitle>新增超级管理员</DialogTitle><DialogDescription>此账号可配置整个系统，并管理所有公司。</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => {
        const result = await accountsApi.create({ username: username.trim(), name: name.trim(), departmentId: null, organizationId: companyId, companyRole: "admin", accountType: "super_admin" });
        setCredentials(result.credentials); setShowPassword(false); setCreating(false); setUsername(""); setName("");
        await client.invalidateQueries({ queryKey: ["platform-super-administrators"] }); toast.success("超级管理员已创建");
      }); }}>
        <label className="grid gap-2 text-sm">姓名<Input required maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <label className="grid gap-2 text-sm">登录账号<Input required pattern="[A-Za-z0-9_-]{3,40}" maxLength={40} placeholder="3–40 位字母、数字、下划线或短横线" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
        <label className="grid gap-2 text-sm">默认公司<NativeSelect required aria-label="超级管理员默认公司" className="h-10 rounded-md border bg-background px-3 text-sm" value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={busy}><option value="">请选择公司</option>{companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</NativeSelect></label>
        <div className="flex justify-end gap-2"><Button variant="outline" type="button" disabled={busy} onClick={() => setCreating(false)}>取消</Button><Button disabled={busy || !companyId}>创建账号</Button></div>
      </form>
    </DialogContent></Dialog>
    <Dialog open={Boolean(credentials)} onOpenChange={open => { if (!open) { setCredentials(null); setShowPassword(false); } }}><DialogContent><DialogHeader><DialogTitle>超级管理员登录信息</DialogTitle><DialogDescription>密码仅此次展示，请妥善保存。</DialogDescription></DialogHeader>{credentials && <div className="space-y-3"><Input aria-label="超级管理员登录账号" readOnly value={credentials.username} /><Input aria-label="超级管理员初始密码" type={showPassword ? "text" : "password"} readOnly value={credentials.password} /><Button variant="outline" onClick={() => setShowPassword(value => !value)}>{showPassword ? "隐藏密码" : "显示密码"}</Button></div>}</DialogContent></Dialog>
  </div>;
}
