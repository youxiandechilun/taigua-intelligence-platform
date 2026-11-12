/*
 * 中文导读：客户列表、筛选与管理操作入口。
 */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Download,
  Upload,
  Search,
  Trash2,
} from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { PageHeader } from "@/src/components/common/PageHeader";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  crmApi,
  crmLabels,
  crmStatuses,
  crmDate,
  type CrmRow,
} from "@/src/lib/api/resources/crm";
import { CrmDialogs, type Editor } from "./CrmDialogs";
import { toast } from "@/src/lib/toast";
import { CallDetails } from "./CrmDetail";
const selectClass = "h-9 rounded-md border bg-background px-3 text-sm";
export function CrmCenter({
  resource,
  title,
}: {
  resource: string;
  title: string;
}) {
  const { data: session } = authClient.useSession();
  const urlParams=useSearchParams();
  const userId=session?.user.id||"";
  const workspaceId = session?.session.activeOrganizationId || "";
  const [q, setQ] = useState(""),
    [industry, setIndustry] = useState(""),
    [region, setRegion] = useState(""),
    [status, setStatus] = useState(urlParams.get("status")||""),
    [tag, setTag] = useState("");
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    setSelected([]);
    setEditor(null);
    setPage(1);
    setQ("");setIndustry("");setRegion("");setTag("");setStatus(urlParams.get("status")||"");
  }, [workspaceId,userId,resource,urlParams]);
  const params = {
    q,
    industry,
    region,
    tag,
    ...(status ? { status } : {}),
    page,
    pageSize: 20,
    ...(urlParams.get("due")==="true"?{due:"true"}:{}),
  };
  const query = useQuery({
    queryKey: ["crm", workspaceId, userId, resource, params],
    queryFn: () => crmApi.list(workspaceId, resource, params),
    enabled: Boolean(workspaceId),
    retry: false,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const manager = query.data?.canManage;
  const can=(action:string)=>query.data?.permissions?.includes(action)===true;
  const rows = query.data?.rows || [];
  const showEditor = (e: Editor) => setEditor(e);
  const change = (setter: (v: string) => void, v: string) => {
    setter(v);
    setPage(1);
    setSelected([]);
  };
  async function action(
    path: string,
    input: CrmRow = {},
    message = "操作完成",
  ) {
    setBusy(true);
    try {
      const r = await crmApi.post(workspaceId, path, input);
      await client.invalidateQueries({ queryKey: ["crm", workspaceId] });
      toast.success(
        path === "import/legacy"
          ? `导入 ${r.imported} 条，重复 ${r.duplicates} 条，未导入 ${r.errors.length} 条`
          : path === "calls/sync"
            ? `已关联 ${r.linked} 条通话${r.more ? "，可继续关联下一批" : ""}`
            : message,
      );
      if (r.errors?.length)
        toast.error(
          r.errors
            .slice(0, 3)
            .map((x: CrmRow) => `第${x.line}行：${x.error}`)
            .join("；"),
        );
      setSelected([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  }
  const checkbox = (r: CrmRow) => {
    const id =
      resource === "companies" || resource === "trash" ? r.id : r.companyId;
    return (
      <input
        type="checkbox"
        aria-label={"选择" + (r.name || r.companyName)}
        checked={selected.includes(id)}
        onChange={(e) =>
          setSelected(
            e.target.checked
              ? [...new Set([...selected, id])]
              : selected.filter((s) => s !== id),
          )
        }
      />
    );
  };
  const headers: Record<string, string[]> = {
    companies: [
      "企业名称",
      "行业 / 地区",
      "联系电话",
      "负责人",
      "客户状态",
      "标签",
      "更新时间",
      "操作",
    ],
    contacts: [
      "联系人",
      "所属企业",
      "职位",
      "手机 / 座机",
      "邮箱",
      "联系状态",
      "拒呼状态",
      "操作",
    ],
    leads: ["企业名称", "客户状态", "跟进备注", "下次跟进", "负责人", "操作"],
    tasks: ["任务", "企业名称", "负责人", "到期时间", "任务状态", "操作"],
    calls: [
      "企业 / 联系人",
      "通话编号",
      "拨打时间",
      "接通状态",
      "时长",
      "通话详情",
    ],
    trash: ["企业名称", "负责人", "删除时间", "处理状态", "操作"],
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          <div className="flex flex-wrap gap-2">
            {resource !== "trash" && can("export") && (
              <Button
                variant="outline"
                disabled={busy || !query.data?.total}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await crmApi.download(workspaceId, resource, params);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "导出失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download className="size-4" />
                导出Excel
              </Button>
            )}
            {can("create") && ["companies", "contacts", "leads", "tasks"].includes(resource) && (
              <Button
                disabled={!workspaceId}
                onClick={() =>
                  showEditor({
                    kind: (
                      {
                        companies: "company",
                        contacts: "contact",
                        leads: "lead",
                        tasks: "task",
                      } as Record<string, Editor["kind"]>
                    )[resource]!,
                  })
                }
              >
                <Plus className="size-4" />
                新增
                {title === "企业客户"
                  ? "企业"
                  : title === "线索池"
                    ? "线索"
                    : title === "跟进任务"
                      ? "任务"
                      : "联系人"}
              </Button>
            )}
          </div>
        }
      />
      <nav
        className="flex flex-wrap gap-2 border-b pb-3"
        aria-label="客户库导航"
      >
        {[
          ["companies", "企业客户"],
          ["contacts", "联系人"],
          ["leads", "线索池"],
          ["tasks", "跟进任务"],
          ["calls", "通话记录"],
          ...(can("delete") ? [["trash", "客户回收站"]] : []),
        ].map(([slug, name]) => (
          <Button
            key={slug}
            variant={resource === slug ? "default" : "ghost"}
            size="sm"
            asChild
          >
            <Link href={"/crm/" + slug}>{name}</Link>
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索企业、电话或地址"
            value={q}
            onChange={(e) => change(setQ, e.target.value)}
          />
        </div>
        <Input
          aria-label="筛选行业"
          placeholder="所属行业"
          className="w-36"
          value={industry}
          onChange={(e) => change(setIndustry, e.target.value)}
        />
        <Input
          aria-label="筛选地区"
          placeholder="所在地区"
          className="w-36"
          value={region}
          onChange={(e) => change(setRegion, e.target.value)}
        />
        <Input
          aria-label="筛选标签"
          placeholder="客户标签"
          className="w-36"
          value={tag}
          onChange={(e) => change(setTag, e.target.value)}
        />
        {!["calls", "tasks"].includes(resource) && (
          <select
            aria-label="筛选客户状态"
            className={selectClass}
            value={status}
            onChange={(e) => change(setStatus, e.target.value)}
          >
            <option value="">全部状态</option>
            {crmStatuses.map((s) => (
              <option value={s} key={s}>
                {crmLabels[s]}
              </option>
            ))}
          </select>
        )}
      </div>
      {resource === "companies" && (
        <div className="flex flex-wrap gap-2">
          {can("import") && <>
          <Button
            variant="outline"
            disabled={busy || !can("import")}
            onClick={() => showEditor({ kind: "import" })}
          >
            <Upload className="size-4" />
            导入Excel / CSV
          </Button>
          <Button
            variant="outline"
            disabled={busy || !can("import")}
            onClick={() => void action("import/legacy")}
          >
            导入现有业务客户
          </Button>
          </>}
          {manager && (
            <>
              <Button
                variant="outline"
                disabled={selected.length === 0 || busy}
                onClick={() => showEditor({ kind: "assign", ids: selected })}
              >
                批量分配 / 授权
              </Button>
              <Button
                variant="outline"
                disabled={selected.length !== 2 || busy || !can("delete")}
                onClick={() =>
                  showEditor({
                    kind: "merge",
                    ids: selected,
                    row: Object.fromEntries(rows.map((r) => [r.id, r.name])),
                  })
                }
              >
                合并选中客户
              </Button>
            </>
          )}
          <span className="self-center text-xs text-muted-foreground">
            选中 {selected.length} 个企业
          </span>
        </div>
      )}
      {resource === "calls" && manager && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action("calls/sync")}
          >
            关联已有通话
          </Button>
          <Button
            variant="outline"
            onClick={() => showEditor({ kind: "link" })}
          >
            手动确认通话归属
          </Button>
          <span className="self-center text-xs text-muted-foreground">
            新通话自动关联；同号多个客户需确认归属。
          </span>
        </div>
      )}
      {query.isError ? (
        <div role="alert" className="rounded-lg border p-5">
          <p className="text-sm text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "客户库加载失败"}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                {resource === "companies" && manager && (
                  <th className="w-10 p-4">选择</th>
                )}
                {headers[resource]?.map((h) => (
                  <th
                    className="whitespace-nowrap px-4 py-3 font-medium"
                    key={h}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isPending ? (
                <tr>
                  <td className="p-6 text-muted-foreground" colSpan={10}>
                    正在加载客户资料…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="py-12 text-center" colSpan={10}>
                    <Building2 className="mx-auto mb-3 size-7 text-primary/60" />
                    <p className="font-medium">
                      {resource === "trash"
                        ? "回收站暂无客户"
                        : "暂无符合条件的记录"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {resource === "companies"
                        ? "可以新增企业，或导入行业线索表。"
                        : "新增或关联客户资料后会显示在这里。"}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b align-top last:border-0 hover:bg-muted/20"
                  >
                    {resource === "companies" && manager && (
                      <td className="p-4">{checkbox(r)}</td>
                    )}
                    {resource === "companies" && (
                      <>
                        <td className="px-4 py-4">
                          <Link
                            className="font-medium text-primary hover:underline"
                            href={"/crm/companies/" + r.id}
                          >
                            {r.name}
                          </Link>
                          <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                            {r.business || r.address || "待补充业务资料"}
                          </p>
                        </td>
                        <td className="p-4">
                          {r.industry || "—"}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.region || "—"}
                          </p>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {r.phone || "—"}
                        </td>
                        <td className="p-4">{r.ownerName || "—"}</td>
                        <td className="p-4 whitespace-nowrap">
                          {crmLabels[r.status]}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {r.tags.map((t: string) => (
                              <span
                                key={t}
                                className="rounded bg-primary/5 px-2 py-0.5 text-xs text-primary"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-4 whitespace-nowrap text-xs text-muted-foreground">
                          {crmDate(r.updatedAt)}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {can("update") && <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                showEditor({ kind: "company", row: r })
                              }
                            >
                              编辑
                            </Button>}
{can("update") &&                             <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                showEditor({
                                  kind: "follow",
                                  companyId: r.id,
                                  row: r,
                                })
                              }
                            >
                              跟进
                            </Button>}
                            {can("delete") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={"回收" + r.name}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "将此客户移入回收站？未完成任务会取消，可以恢复客户资料。",
                                    )
                                  )
                                    void action(
                                      "companies/" + r.id + "/recycle",
                                    );
                                }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                    {resource === "contacts" && (
                      <>
                        <td className="p-4 font-medium">
                          {r.name || "企业联系电话（未提供姓名）"}
                        </td>
                        <td className="p-4">
                          <Link
                            href={"/crm/companies/" + r.companyId}
                            className="text-primary hover:underline"
                          >
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="p-4">{r.position || "—"}</td>
                        <td className="p-4 whitespace-nowrap">
                          {r.mobile || "—"}
                          <p className="mt-1">
                            {r.landline
                              ? (r.areaCode ? r.areaCode + "-" : "") +
                                r.landline +
                                (r.extension ? " 转" + r.extension : "")
                              : ""}
                          </p>
                        </td>
                        <td className="p-4">{r.email || "—"}</td>
                        <td className="p-4">{crmLabels[r.status]}</td>
                        <td className="p-4">
                          {r.doNotCall ? "已拒呼" : "未拒呼"}
                        </td>
                        <td className="p-3">
                          {can("update") && <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              showEditor({ kind: "contact", row: r })
                            }
                          >
                            编辑
                          </Button>}
                        </td>
                      </>
                    )}
                    {resource === "leads" && (
                      <>
                        <td className="p-4">
                          <Link
                            href={"/crm/companies/" + r.companyId}
                            className="text-primary hover:underline"
                          >
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="p-4">{crmLabels[r.status]}</td>
                        <td className="p-4">
                          <p className="max-w-64 whitespace-pre-wrap">
                            {r.notes || "—"}
                          </p>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {crmDate(r.nextFollowUp)}
                        </td>
                        <td className="p-4">{r.ownerName}</td>
                        <td className="p-3">
                          {can("update") && <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => showEditor({ kind: "lead", row: r })}
                          >
                            编辑线索
                          </Button>}
                        </td>
                      </>
                    )}
                    {resource === "tasks" && (
                      <>
                        <td className="p-4 font-medium">
                          {r.title}
                          <p className="mt-1 max-w-64 text-xs font-normal text-muted-foreground">
                            {r.notes}
                          </p>
                        </td>
                        <td className="p-4">
                          <Link
                            className="text-primary hover:underline"
                            href={"/crm/companies/" + r.companyId}
                          >
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="p-4">{r.ownerName}</td>
                        <td
                          className={
                            "p-4 whitespace-nowrap " +
                            (r.status === "PENDING" &&
                            Date.parse(r.dueAt) < Date.now()
                              ? "text-destructive"
                              : "")
                          }
                        >
                          {crmDate(r.dueAt)}
                        </td>
                        <td className="p-4">{crmLabels[r.status]}</td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={r.status !== "PENDING" || busy || !can("update")}
                            onClick={() =>
                              void action("tasks/" + r.id + "/complete")
                            }
                          >
                            标记完成
                          </Button>
                        </td>
                      </>
                    )}
                    {resource === "calls" && (
                      <>
                        <td className="p-4">
                          <Link
                            className="text-primary hover:underline"
                            href={"/crm/companies/" + r.companyId}
                          >
                            {r.companyName}
                          </Link>
                          <p className="mt-1 text-xs">
                            {r.contactName || "企业客户"}
                          </p>
                        </td>
                        <td className="max-w-56 break-all p-4 text-xs">
                          {String(r.localCallId || r.callId).slice(-8)}
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {crmDate(r.startTime)}
                        </td>
                        <td className="p-4">{crmLabels[r.status]}</td>
                        <td className="p-4 whitespace-nowrap">
                          {r.durationSeconds} 秒
                        </td>
                        <td className="min-w-64 p-4">
                          <CallDetails call={r} />
                        </td>
                      </>
                    )}
                    {resource === "trash" && (
                      <>
                        <td className="p-4 font-medium">{r.name}</td>
                        <td className="p-4">{r.ownerName}</td>
                        <td className="p-4">{crmDate(r.deletedAt)}</td>
                        <td className="p-4">
                          {r.mergedIntoId ? "已合并" : "可恢复"}
                        </td>
                        <td className="p-3">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || Boolean(r.mergedIntoId)}
                            onClick={() =>
                              void action("companies/" + r.id + "/restore")
                            }
                          >
                            恢复客户
                          </Button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {query.data && (
        <footer className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            共 {query.data.total} 条 · 每页20条
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage(page - 1);
                setSelected([]);
              }}
            >
              上一页
            </Button>
            <span>第 {page} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 20 >= query.data.total}
              onClick={() => {
                setPage(page + 1);
                setSelected([]);
              }}
            >
              下一页
            </Button>
          </div>
        </footer>
      )}
      {editor && (
        <CrmDialogs
          key={workspaceId + editor.kind + (editor.row?.id || "")}
          workspaceId={workspaceId}
          editor={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
