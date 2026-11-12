/*
 * 中文导读：业务线索的 BusinessCenter 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ClipboardList,
  Headset,
  Download,
  Plus,
  ArrowUpRight,
  Loader2,
  Trash2, Save, Pencil, UserRoundPlus } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import {
  businessApi,
  type BusinessContact,
  type BusinessLead,
  type ContactUpdate,
} from "@/src/lib/api/resources/business";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { toast } from "@/src/lib/toast";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/src/components/ui/dialog";
const sections = [
  { id: "leads", name: "企业线索", icon: Search },
  { id: "follow", name: "客户跟进", icon: ClipboardList },
  { id: "handoff", name: "人工接管", icon: Headset },
] as const;
type Section = (typeof sections)[number]["id"];
const statuses = {
  NEW: "待跟进",
  INTERESTED: "有意向",
  FOLLOW_UP: "继续跟进",
  NO_NEED: "暂无需求",
  OPT_OUT: "拒绝联系",
};
const wecom = {
  NONE: "未登记",
  REQUESTED: "愿意添加",
  ADDED: "已添加（人工登记或同步）",
  DECLINED: "拒绝添加",
};
const handoff = {
  NONE: "无需接管",
  PENDING: "待人工处理",
  ACCEPTED: "人工处理中",
  DONE: "已处理",
};
const jobStatuses: Record<string, string> = {
  SEARCHING: "正在搜索",
  WAITING: "待继续 · 未完成",
  PAUSED: "已暂停 · 未完成",
  COMPLETE: "已达到目标",
};
const fieldClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function displayDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未安排";
}
function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function BusinessCenter() {
  const { data: session } = authClient.useSession();
  const { data: org } = authClient.useActiveOrganization();
  const params = useSearchParams();
  const router=useRouter();
  const context = useCompanyContext();
  const [view, setView] = useState<"mine" | "company">(() =>
    params.get("view") === "company" ? "company" : "mine",
  );
  const [assigning, setAssigning] = useState<BusinessContact | null>(null);
  const [assignee, setAssignee] = useState("");
  const [historyContact, setHistoryContact] = useState<BusinessContact | null>(
    null,
  );
  const queryClient = useQueryClient();
  const key = ["business", session?.user.id, org?.id];
  const enabled = Boolean(session?.user.id && org?.id);
  const jobs = useQuery({
    queryKey: [...key, "jobs"],
    queryFn: () => businessApi.jobs(org!.id),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === "SEARCHING") ? 10000 : false,
  });
  const activeJob = jobs.data?.find((j) => j.status === "SEARCHING");
  const active = Boolean(activeJob);
  const contacts = useQuery({
    queryKey: [...key, "contacts", view],
    queryFn: () => businessApi.contacts(org!.id, view),
    enabled,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const [tab, setTab] = useState<Section>(() =>
    sections.some((s) => s.id === params.get("tab"))
      ? (params.get("tab") as Section)
      : "leads",
  );
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("中国大陆");
  const [quantity, setQuantity] = useState(30);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sources, setSources] = useState("");
  const [editing, setEditing] = useState<BusinessContact | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const selected = jobs.data?.find((j) => j.id === chosen) || jobs.data?.[0];
  const [dashboardFilter, setDashboardFilter] = useState(
    params.get("filter") || "",
  );
  const rows = (contacts.data || [])
    .filter(
      (c) =>
        !dashboardFilter ||
        (dashboardFilter === "due"
          ? Boolean(
              c.nextFollowUp &&
              new Date(c.nextFollowUp).getTime() <= Date.now() &&
              !["OPT_OUT", "NO_NEED"].includes(c.status),
            )
          : dashboardFilter === "interested"
            ? c.status === "INTERESTED"
            : dashboardFilter === "pending"
              ? ["PENDING", "ACCEPTED"].includes(c.handoffStatus) &&
                !["OPT_OUT", "NO_NEED"].includes(c.status)
              : true),
    )
    .filter(
      (c) =>
        (!filter ||
          [c.companyName, c.phone, c.industry, c.notes]
            .join(" ")
            .includes(filter)) &&
        (tab !== "handoff" || c.handoffStatus !== "NONE"),
    );
  const allRowsSelected =
    rows.length > 0 && rows.every((c) => selectedContacts.includes(c.id));
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...key, "jobs"] }),
        queryClient.invalidateQueries({ queryKey: [...key, "contacts"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!industry.trim()) return toast.error("请先输入行业或产品关键词。");
    if (activeJob && activeJob.industry === industry.trim() && activeJob.region === (region.trim() || "中国大陆") && activeJob.target === quantity) {
      setChosen(activeJob.id);
      return toast.success("这个任务正在搜索，已显示当前进度。");
    }
    await run(async () => {
      if (activeJob) await businessApi.action(org!.id, activeJob.id, "pause");
      const job = await businessApi.createJob(
        org!.id,
        industry.trim(),
        region.trim() || "中国大陆",
        quantity,
      );
      setChosen(job.id);
      toast.success("搜索任务已保存，服务器会持续收集公开电话。");
    });
  }
  async function removeContacts(ids: string[]) {
    if (!ids.length) return;
    if (
      !window.confirm(
        `确认移除 ${ids.length} 条客户记录？线索记录会被隐藏；已归档的客户资料仍保留在客户库，客户回收请在客户库操作。`,
      )
    )
      return;
    await run(async () => {
      await businessApi.delete(org!.id, ids);
      setSelectedContacts((previous) =>
        previous.filter((id) => !ids.includes(id)),
      );
      toast.success(`已移除 ${ids.length} 条客户记录。`);
    });
  }
  const waiting = (contacts.data || []).filter(
    (c) => c.status === "NEW" || c.status === "FOLLOW_UP",
  ).length;
  const pending = (contacts.data || []).filter(
    (c) => c.handoffStatus === "PENDING",
  ).length;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            业务工具中心
          </h1>
          
        </div>

      </header>
      <dl aria-label="客户概况" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-2.5">
        {[
          ["客户记录", contacts.data?.length ?? 0],
          ["待跟进客户", waiting],
          ["待人工处理", pending],
        ].map(([label, count]) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{contacts.isPending ? "—" : count}</dd>
          </div>
        ))}
      </dl>
      <nav
        aria-label="业务工具分类"
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {sections.map((s) => (
          <Button
            key={s.id}
            variant={tab === s.id ? "default" : "outline"}
            aria-pressed={tab === s.id}
            onClick={() => {
              if(s.id==="follow"){router.push("/crm/companies");return;}
              setTab(s.id);
              setDashboardFilter("");
              setSelectedContacts([]);
              void contacts.refetch();
            }}
          >
            <s.icon className="size-4" />
            {s.name}
          </Button>
        ))}
      </nav>
      {(jobs.error || contacts.error) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {(jobs.error || contacts.error)?.message}{" "}
          <button
            className="underline"
            onClick={() => {
              void jobs.refetch();
              void contacts.refetch();
            }}
          >
            重新加载
          </button>
        </p>
      )}
      {dashboardFilter && (
        <div className="flex items-center justify-between rounded-lg border bg-primary/5 px-4 py-3 text-sm">
          <span>
            当前筛选：
            {(
              {
                due: "已到期跟进",
                interested: "有意向客户",
                pending: "待人工处理",
              } as Record<string, string>
            )[dashboardFilter] || dashboardFilter}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDashboardFilter("")}
          >
            显示全部
          </Button>
        </div>
      )}
      {tab === "leads" ? (
        <>
          <section className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">输入行业或产品，生成企业线索表</h2>
            
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
              className="mt-5 grid items-end gap-4 sm:grid-cols-[1fr_140px_auto]"
            >
              <Field label="行业或产品关键词">
                <Input
                  required
                  maxLength={80}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="例如：包装设备、艾草贴、五金配件"
                />
              </Field>
              <Field label="需要的电话数量">
                <Input
                  type="number"
                  min={1}
                  max={2000}
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </Field>
              <Button disabled={busy || !enabled} type="submit">
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                {active ? "保存进度并切换搜索" : "开始查找"}
              </Button>
            </form>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                限定国内地区（选填）
              </summary>
              <div className="mt-3 max-w-xs">
                <Field label="中国大陆地区">
                  <Input
                    value={region}
                    maxLength={30}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="中国大陆，或广州、广东等"
                  />
                </Field>
              </div>
            </details>
            {active && (
              <p className="mt-3 text-xs text-muted-foreground">
                切换行业或产品会保存并暂停当前任务，再开始新任务。不同任务的结果分别保留，可从下方历史任务中查看或继续。
              </p>
            )}
          </section>
          {selected ? (
            <section className="space-y-4 rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    {selected.industry}{" "}
                    <span className="ml-2 rounded bg-primary/5 px-2 py-1 text-xs text-primary">
                      {jobStatuses[selected.status] || selected.status}
                    </span>
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selected.message}
                  </p>
                </div>
                <NativeSelect
                  aria-label="历史线索任务"
                  className={fieldClass + " max-w-xs"}
                  value={selected.id}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {jobs.data?.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.industry} · {j.results.length}/{j.target} ·{" "}
                      {jobStatuses[j.status]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center gap-4">
                <div
                  role="progressbar"
                  aria-label="已收集电话"
                  aria-valuemin={0}
                  aria-valuemax={selected.target}
                  aria-valuenow={selected.results.length}
                  className="h-2 flex-1 overflow-hidden rounded bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (selected.results.length / selected.target) * 100)}%`,
                    }}
                  />
                </div>
                <strong className="text-sm tabular-nums">
                  {selected.results.length} / {selected.target}
                </strong>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !selected.results.length}
                  onClick={() =>
                    void run(() =>
                      businessApi.download(
                        org!.id,
                        `jobs/${selected.id}/export`,
                        `${selected.industry}-国内企业线索.xlsx`,
                      ),
                    )
                  }
                >
                  <Download className="size-4" />
                  下载已收集表格
                </Button>
                {selected.status !== "COMPLETE" && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          businessApi.action(
                            org!.id,
                            selected.id,
                            selected.status === "SEARCHING"
                              ? "pause"
                              : "resume",
                          ),
                        )
                      }
                    >
                      {selected.status === "SEARCHING"
                        ? "暂停搜索"
                        : "继续搜索"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setSourceOpen(true)}
                    >
                      补充企业官网
                    </Button>
                  </>
                )}
              </div>
              <dl aria-label="搜索结果概况" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y py-2 text-sm">
                <div className="flex items-center gap-2"><dt className="text-muted-foreground">有效联系电话</dt><dd className="font-semibold tabular-nums text-primary">{selected.phoneCount ?? selected.results.length}</dd></div>
                <div className="flex items-center gap-2"><dt className="text-muted-foreground">匹配企业</dt><dd className="font-semibold tabular-nums">{selected.companyCount ?? new Set(selected.results.map(r => r.companyName)).size}</dd></div>
                <div className="flex items-center gap-2"><dt className="text-muted-foreground">目标数量</dt><dd className="tabular-nums">{selected.target}</dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">
                当前范围：{selected.region} · 目标 {selected.target} 个不重复电话。同一家企业的不同号码会合并展示，分别计入电话数量。{selected.status === "SEARCHING" ? "搜索在后台继续，下载结果不会结束任务。" : selected.status === "COMPLETE" ? "任务已达到目标，表格可以继续下载。" : "当前任务未完成，已收集结果保留，可点击继续搜索。"}
              </p>
              {selected.diagnostics?.since && (
                <details className="rounded-md border px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">查看本次搜索情况</summary>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    <span>已尝试页面（含历史）{selected.visitedCount}</span>
                    <span>待查企业页面 {selected.sourceCount}</span>
                    <span>已读取企业页面 {selected.diagnostics.fetchedPages || 0}</span>
                    <span>过滤无关搜索结果 {selected.diagnostics.searchFiltered || 0}</span>
                    <span>行业不匹配 {selected.diagnostics.irrelevant || 0}</span>
                    <span>地区不匹配 {selected.diagnostics.region || 0}</span>
                    <span>未识别企业名称 {selected.diagnostics.noCompany || 0}</span>
                    <span>未找到可用电话 {selected.diagnostics.noPhone || 0}</span>
                    <span>企业网站暂不可访问 {selected.diagnostics.unavailable || 0}</span>
                    <span>跳过重复号码 {selected.diagnostics.duplicates || 0}</span>
                  </div>
                  {(selected.diagnostics.searchFailures || 0) > 0 && <p className="mt-2">部分搜索来源返回空页面、访问限制或连接失败，系统会切换来源并自动重试。</p>}
                  <p className="mt-2">以上统计从功能升级后开始记录。历史尝试页面 {selected.diagnostics.historicalAttempts || 0} 个，未计入分类统计。</p>
                </details>
              )}
              <LeadTable rows={selected.results} />
            </section>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {jobs.isLoading
                ? "正在加载线索任务…"
                : "输入行业或产品和数量后开始查找，结果将自动保存并生成可下载表格。"}
            </div>
          )}
        </>
      ) : (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {sections.find((s) => s.id === tab)?.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setManual(true)}>
                <Plus className="size-4" />
                录入客户
              </Button>
              <Button
                variant="outline"
                disabled={busy || !contacts.data?.length}
                onClick={() =>
                  void run(() =>
                    businessApi.download(
                      org!.id,
                      `contacts/export?view=${view}`,
                      "客户联系表.xlsx",
                    ),
                  )
                }
              >
                <Download className="size-4" />
                导出联系表
              </Button>
              <Button
                variant="outline"
                disabled={busy || !selectedContacts.length}
                onClick={() => void removeContacts(selectedContacts)}
              >
                <Trash2 className="size-4" />
                删除所选
                {selectedContacts.length
                  ? `（${selectedContacts.length}）`
                  : ""}
              </Button>
            </div>
          </div>
          {tab === "handoff" && (
            <p className="rounded-md bg-muted p-3 text-sm">
              将需要人工处理的客户加入队列，记录接管原因和处理结果。坐席线路尚未接通，暂不提供通话实时转接。
            </p>
          )}
          {context.data?.canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={view === "mine" ? "default" : "outline"}
                onClick={() => {
                  setView("mine");
                  setSelectedContacts([]);
                }}
              >
                我的客户
              </Button>
              <Button
                variant={view === "company" ? "default" : "outline"}
                onClick={() => {
                  setView("company");
                  setSelectedContacts([]);
                }}
              >
                公司客户
              </Button>
              
            </div>
          )}
          <Input
            aria-label="搜索客户"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索公司名称、行业、电话或需求"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="选择当前列表全部客户"
                      checked={allRowsSelected}
                      onChange={(e) =>
                        setSelectedContacts(
                          e.target.checked
                            ? Array.from(
                                new Set([
                                  ...selectedContacts,
                                  ...rows.map((c) => c.id),
                                ]),
                              )
                            : selectedContacts.filter(
                                (id) => !rows.some((c) => c.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  {[
                    "客户 / 行业",
                    "联系电话",
                    "意向",
                    "跟进状态",
                    "需求 / 备注",
                    "负责人",
                    "操作",
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-3">
                      <input
                        type="checkbox"
                        aria-label={`选择${c.companyName}`}
                        checked={selectedContacts.includes(c.id)}
                        onChange={(e) =>
                          setSelectedContacts((previous) =>
                            e.target.checked
                              ? [...previous, c.id]
                              : previous.filter((id) => id !== c.id),
                          )
                        }
                      />
                    </td>
                    <td className="min-w-48 px-3 py-4">
                      <div className="font-medium">{c.companyName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {c.industry || "未分类"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono">
                      {c.phone}
                    </td>
                    <td className="whitespace-nowrap px-3">
                      {statuses[c.status as keyof typeof statuses] || c.status}
                    </td>
                    <td className="whitespace-nowrap px-3">
                      {tab === "handoff"
                          ? handoff[c.handoffStatus as keyof typeof handoff]
                          : displayDate(c.nextFollowUp)}
                    </td>
                    <td className="min-w-40 max-w-80 px-3">
                      <p className="line-clamp-2">
                        {tab === "handoff"
                          ? c.handoffReason || c.notes || "未登记"
                          : c.notes || "未登记"}
                      </p>
                    </td>
                    <td className="px-3 whitespace-nowrap">
                      {c.ownerName || "原负责人"}
                    </td>
                    <td className="px-3 whitespace-nowrap">
                      {c.crmCompanyId&&<Button variant="outline" size="sm" asChild><Link href={"/crm/companies/"+c.crmCompanyId}>客户详情</Link></Button>}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(c)}
                      ><Pencil aria-hidden="true" className="size-4" />
                        编辑记录
                      </Button>
                      {context.data?.canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAssigning(c);
                            setAssignee(c.ownerId);
                          }}
                        ><UserRoundPlus aria-hidden="true" className="size-4" />
                          分配
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHistoryContact(c)}
                      ><UserRoundPlus aria-hidden="true" className="size-4" />
                        分配记录
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void removeContacts([c.id])}
                      >
                        <Trash2 className="size-4" />
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {contacts.isLoading
                  ? "正在加载客户…"
                    : tab === "handoff"
                      ? "暂无人工处理任务。在客户跟进中设置接管状态后会进入队列。"
                      : "暂无客户记录。查找企业线索或录入客户后即可跟进。"}
              </p>
            )}
          </div>
        </section>
      )}
      <Dialog
        open={!!assigning}
        onOpenChange={(v) => {
          if (!v && !busy) setAssigning(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分配客户负责人</DialogTitle>
            <DialogDescription>
              {assigning?.companyName}
              ：分配后原员工不再查看该客户，已有跟进备注和记录全部保留。
            </DialogDescription>
          </DialogHeader>
          <Field label="本公司负责人">
            <NativeSelect
              className={fieldClass}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">请选择已启用的账号</option>
              {context.data?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            disabled={busy || !assignee}
            onClick={() =>
              void run(async () => {
                if (!assigning) return;
                await businessApi.assign(org!.id, assigning.id, assignee);
                setAssigning(null);
                toast.success("客户负责人已更新。");
              })
            }
          ><UserRoundPlus aria-hidden="true" className="size-4" />
            确认分配
          </Button>
        </DialogContent>
      </Dialog>
      {historyContact && (
        <AssignmentHistory
          key={historyContact.id}
          contact={historyContact}
          view={view}
          orgId={org!.id}
          onClose={() => setHistoryContact(null)}
        />
      )}
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>补充企业官网</DialogTitle>
            <DialogDescription>
              每行一个公开官网网址，系统将补充检索并继续当前任务。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="企业官网网址"
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            rows={6}
            placeholder="https://企业官网地址"
          />
          <Button
            disabled={busy || !sources.trim()}
            onClick={() =>
              void run(async () => {
                if (!selected) return;
                await businessApi.action(
                  org!.id,
                  selected.id,
                  "resume",
                  sources
                    .split(/\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
                setSourceOpen(false);
                setSources("");
              })
            }
          ><Save aria-hidden="true" className="size-4" />
            保存并继续查找
          </Button>
        </DialogContent>
      </Dialog>
      <ManualDialog
        open={manual}
        onClose={() => setManual(false)}
        busy={busy}
        save={(lead) =>
          run(async () => {
            await businessApi.save(org!.id, lead);
            setManual(false);
            toast.success("客户已保存。");
          })
        }
      />
      {editing && (
        <FollowDialog
          key={editing.id}
          contact={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          save={(data) =>
            run(async () => {
              await businessApi.update(org!.id, editing.id, data, view);
              setEditing(null);
              toast.success("跟进记录已保存。");
            })
          }
        />
      )}
    </div>
  );
}
function LeadTable({ rows }: { rows: BusinessLead[] }) {
  const groups = new Map<string, { lead: BusinessLead; phones: BusinessLead[] }>();
  for (const lead of rows) {
    const key=lead.companyName.normalize("NFKC").replace(/\s/g, "");
    const group=groups.get(key);
    if(group) group.phones.push(lead);
    else groups.set(key, {lead, phones:[lead]});
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {["公司名称", "地址", "经营业务", "联系电话 / 来源"].map((h) => (
              <th key={h} className="px-3 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.values()].map(({lead:r, phones}, i) => (
            <tr key={r.companyName} className="border-t align-top">
              <td className="min-w-52 px-3 py-4">
                <span className="mr-2 text-xs text-muted-foreground">{i+1}</span>{r.companyName}
                {phones.length>1 && <p className="mt-1 pl-4 text-xs text-muted-foreground">{phones.length} 个不同联系电话</p>}
              </td>
              <td className="min-w-44 max-w-64 px-3 py-4"><p className="break-words">{r.address || "暂未公开"}</p></td>
              <td className="min-w-44 max-w-72 px-3 py-4"><p className="line-clamp-3" title={r.business}>{r.business || "暂未公开"}</p></td>
              <td className="min-w-52 px-3 py-4">
                <div className="space-y-2">
                  {phones.map(p => <div key={p.phone} className="flex items-center justify-between gap-3">
                    <span className="whitespace-nowrap font-mono tabular-nums">{formatLeadPhone(p.phone)}</span>
                    {p.sourceUrl && <a className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary hover:underline" href={p.sourceUrl} target="_blank" rel="noopener noreferrer">公开来源<ArrowUpRight className="size-3" /></a>}
                  </div>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-8 text-center text-sm text-muted-foreground">尚未收集到匹配企业的有效电话，进度会自动更新。</p>}
    </div>
  );
}
function formatLeadPhone(phone:string) {
  const match=phone.match(/^(0(?:10|2[0-9]|[3-9]\d{2}))(\d{7,8})$/);
  return match ? `${match[1]}-${match[2]}` : phone;
}
function ManualDialog({
  open,
  onClose,
  busy,
  save,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  save: (r: BusinessLead) => Promise<void>;
}) {
  const [data, setData] = useState<BusinessLead>({
    companyName: "",
    phone: "",
    industry: "",
    address: "",
    business: "",
    sourceUrl: "",
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>录入客户</DialogTitle>
          <DialogDescription>
            填写国内企业联系资料，座机需要带区号。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(data);
          }}
        >
          {(
            [
              ["companyName", "公司名称"],
              ["phone", "联系电话（座机带区号）"],
              ["industry", "行业"],
              ["address", "地址"],
              ["business", "经营业务"],
              ["sourceUrl", "来源网址"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                required={key === "companyName" || key === "phone"}
                type={key === "sourceUrl" ? "url" : "text"}
                maxLength={key === "sourceUrl" ? 2000 : 200}
                value={data[key]}
                onChange={(e) => setData({ ...data, [key]: e.target.value })}
              />
            </Field>
          ))}
          <Button disabled={busy} type="submit"><Save aria-hidden="true" className="size-4" />
            保存客户
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function FollowDialog({
  contact,
  busy,
  onClose,
  save,
}: {
  contact: BusinessContact;
  busy: boolean;
  onClose: () => void;
  save: (d: ContactUpdate) => Promise<void>;
}) {
  const [data, setData] = useState<ContactUpdate>({
    status: contact.status,
    notes: contact.notes,
    nextFollowUp: contact.nextFollowUp,
    wecomStatus: contact.wecomStatus,
    handoffStatus: contact.handoffStatus,
    handoffReason: contact.handoffReason,
  });
  const [date, setDate] = useState(localDate(contact.nextFollowUp));
  const optOut = data.status === "OPT_OUT";
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact.companyName}</DialogTitle>
          <DialogDescription>
            {contact.phone} · 编辑客户需求和后续处理记录
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              ...data,
              nextFollowUp:
                date && !optOut ? new Date(date).toISOString() : null,
            });
          }}
        >
          <Field label="客户意向">
            <NativeSelect
              className={fieldClass}
              value={data.status}
              onChange={(e) => setData({ ...data, status: e.target.value })}
            >
              {Object.entries(statuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="客户需求 / 跟进备注">
            <Textarea
              maxLength={4000}
              value={data.notes}
              onChange={(e) => setData({ ...data, notes: e.target.value })}
              rows={4}
            />
          </Field>
          <Field label="下次跟进时间">
            <Input
              type="datetime-local"
              disabled={optOut}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="企微添加记录">
            <NativeSelect
              disabled={optOut}
              className={fieldClass}
              value={data.wecomStatus}
              onChange={(e) =>
                setData({ ...data, wecomStatus: e.target.value })
              }
            >
              {Object.entries(wecom).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="人工接管状态">
            <NativeSelect
              disabled={optOut}
              className={fieldClass}
              value={data.handoffStatus}
              onChange={(e) =>
                setData({ ...data, handoffStatus: e.target.value })
              }
            >
              {Object.entries(handoff).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="接管原因 / 处理结果">
            <Textarea
              maxLength={1000}
              value={data.handoffReason}
              onChange={(e) =>
                setData({ ...data, handoffReason: e.target.value })
              }
            />
          </Field>
          {optOut && (
            <p className="text-sm text-primary">
              保存后将取消下次跟进、企微添加待办和人工接管待办，保留拒绝联系记录。
            </p>
          )}
          <Button type="submit" disabled={busy}><Save aria-hidden="true" className="size-4" />
            保存跟进记录
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentHistory({
  contact,
  view,
  orgId,
  onClose,
}: {
  contact: BusinessContact;
  view: "mine" | "company";
  orgId: string;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: ["contact-assignment", orgId, contact.id, view],
    queryFn: () => businessApi.history(orgId, contact.id, view),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>客户分配记录</DialogTitle>
          <DialogDescription>
            {contact.companyName} · 当前负责人：{contact.ownerName}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {history.isPending && <p className="text-sm">正在加载…</p>}
          {history.error && (
            <p role="alert" className="text-sm text-destructive">
              {history.error.message}
            </p>
          )}
          {history.data?.map((h) => (
            <div key={h.id} className="border-b pb-3 text-sm">
              <p>
                {h.previousOwnerName || "原负责人"} →{" "}
                {h.ownerName || "新负责人"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {h.actorName} · {new Date(h.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          ))}
          {history.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              暂无分配记录，客户仍由原账号负责。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
