/*
 * 中文导读：自动化流程的 AutomationCenter 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useSearchParams, useRouter } from "next/navigation";
import { PersonalAutomations, TemplateLibrary } from "./EmployeeAutomation";
import { WorkflowWorkspace } from "./WorkflowWorkspace";
import { AutomationLoading } from "./AutomationLoading";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow, Download, Check, Play , RefreshCw, Save } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import {
  automationApi,
  type AutomationRule,
  type AutomationKind,
} from "@/src/lib/api/resources/automation";
import { Button } from "@/src/components/ui/button";
import { Switch } from "@/src/components/ui/switch";
import { Input } from "@/src/components/ui/input";
import { toast } from "@/src/lib/toast";
const descriptions: Record<AutomationKind, string> = {
  LEAD_READY: "企业搜索达到目标后，生成完成通知，附上可下载的线索表。",
  CALL_SUMMARY:
    "收到通话文字记录后，由 AI 整理需求与意向；匹配客户后更新记录，生成跟进或接管待办。",
  MY_REPORT: "只汇总你的客户和待办。",
  FOLLOW_UP: "提醒你跟进到期客户。",
  DAILY_REPORT: "汇总当天新增线索、通话结果和待办，每天按北京时间生成日报。",
};
const labels: Record<string, string> = {
  LEAD_READY: "线索完成通知",
  CALL_SUMMARY: "通话整理与跟进",
  DAILY_REPORT: "每日业务汇总",
  MY_REPORT: "我的业务日报",
  followUpList: "需跟进客户",
  QUEUED: "等待执行",
  RUNNING: "正在执行",
  SUCCESS: "已完成",
  FAILED: "需要处理",
  summary: "摘要",
  need: "客户需求",
  intent: "客户意向",
  handoff: "需要人工",
  reason: "原因",
  nextAction: "下一步建议",
  date: "日期",
  newContacts: "新增线索",
  calls: "通话次数",
  connected: "接通次数",
  interested: "当前意向客户",
  optOut: "当前拒绝联系",
  followUpsDue: "到期跟进",
  openTodos: "未完成待办",
  industry: "行业",
  count: "电话数量",
  target: "目标数量",
  INTERESTED: "有意向",
  FOLLOW_UP: "继续跟进",
  NO_NEED: "暂无需求",
  OPT_OUT: "拒绝联系",
  UNKNOWN: "尚不明确",
};
const time = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export function AutomationCenter({ initialContext }: { initialContext: { org: string; user: string; canManage: boolean; canEditEngine: boolean } }) {
  const { data: session } = authClient.useSession();
  const org = session?.session.activeOrganizationId ?? initialContext.org;
  const user = session?.user.id ?? initialContext.user;
  const company = useCompanyContext();
  const params = useSearchParams(),
    router = useRouter();
  const requested = params.get("view");
  const setView = (next: "editor" | "mine" | "company" | "templates") =>
    router.replace("/automation?view=" + next, { scroll: false });
  const initial = org === initialContext.org && user === initialContext.user ? initialContext : undefined;
  const canManage = company.data?.canManage ?? initial?.canManage ?? false;
  const canEditEngine = company.data?.isSystemAdmin ?? initial?.canEditEngine ?? false;
  const recordView =
    requested === "company" && canManage ? "company" : "mine";
  const query = useQuery({
    queryKey: ["automation", user, org, recordView],
    queryFn: () => automationApi.get(org, recordView),
    enabled: Boolean(org),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });
  const client = useQueryClient();
  const [busy, setBusy] = useState("");
  async function act(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "queued" in result && "status" in result) {
        const submission = result as {queued:boolean;status:string;message?:string};
        const text = submission.message || ({QUEUED:submission.queued?"任务已提交，结果会显示在执行记录中":"该任务已在队列中，请查看执行记录",RUNNING:"该任务正在执行，请查看执行记录",SUCCESS:"这条记录已整理完成，请查看已有执行结果",FAILED:"这条记录上次执行失败，请在执行记录中点击重试",SKIPPED:"当前任务未提交，请检查流程是否已开启"} as Record<string,string>)[submission.status] || "已核对任务状态，请查看执行记录";
        if (submission.status === "FAILED" || submission.status === "SKIPPED") toast.error(text);
        else toast.success(text);
      } else toast.success(message);
      await client.invalidateQueries({ queryKey: ["automation", user, org] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      setBusy("");
    }
  }
  const data = query.data ?? { engine: null, canManage, canEditEngine, personalRules: [], rules: [], todos: [], runs: [] };
  const view =
    requested === "templates"
      ? "templates"
      : requested === "company" && data.canManage
        ? "company"
        : requested === "mine"
          ? "mine"
          : data.canEditEngine
            ? "editor"
            : "mine";
  const [editorVisited, setEditorVisited] = useState(false);
  useEffect(() => { if (view === "editor") setEditorVisited(true); }, [view]);
  if (!org || (!initial && company.isPending)) return <AutomationLoading />;
  return (
    <main data-automation-center className="flex w-full min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            <Workflow className="size-6 text-primary" />自动化
          </h1>
          
        </div>
          <div className="flex items-center gap-3">
            <span role="status" className="text-sm">
              <span
                className={`mr-2 inline-block size-2 rounded-full ${data.engine?.ready ? "bg-green-600" : "bg-amber-600"}`}
              />
              {data.engine?.ready
                ? "自动化服务已连接"
                : data.engine?.configured
                  ? "服务暂未连接，任务会保留"
                  : data.engine ? "自动化服务待配置" : "正在更新业务数据…"}
            </span>
          </div>
      </header>
      <nav
        aria-label="自动化功能"
        className="flex flex-wrap items-center gap-2 border-b pb-3"
      >
        {data.canEditEngine ? (
          <Button
            variant={view === "editor" ? "default" : "ghost"}
            aria-pressed={view === "editor"}
            onClick={() => setView("editor")}
          >
            <Workflow className="size-4" />流程工作台
          </Button>
        ) : null}
        <Button
          variant={view === "mine" ? "default" : "ghost"}
          onClick={() => setView("mine")}
        >
          我的自动化
        </Button>
        {data.canManage ? (
          <Button
            variant={view === "company" ? "default" : "ghost"}
            onClick={() => setView("company")}
          >
            公司流程
          </Button>
        ) : null}
        <Button
          variant={view === "templates" ? "default" : "ghost"}
          onClick={() => setView("templates")}
        >
          模板学习库
        </Button>
      </nav>
      {query.isError ? (
        <p role="status" className="text-sm text-amber-700">
          数据暂未更新，系统会自动重试。{!query.data && <Button size="sm" variant="ghost" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button>}
        </p>
      ) : null}
      {data.canEditEngine && (view === "editor" || editorVisited) ? (
        <section
          aria-label="自动化流程工作台"
          hidden={view !== "editor"}
          className={view === "editor" ? "space-y-3" : "hidden"}
        >
          <WorkflowWorkspace key={org + user} />
        </section>
      ) : null}
      {(view === "mine" || view === "company") && query.isPending ? <AutomationLoading /> : null}
      {view === "mine" && query.data ? (
        <PersonalAutomations
          org={org}
          user={user}
          rules={data.personalRules}
          busy={Boolean(busy)}
          onSave={(r) =>
            void act(
              "personal-" + r.kind,
              () => automationApi.savePersonal(org, r),
              "个人规则已保存",
            )
          }
          onRun={(r) =>
            void act(
              "personal-" + r.kind,
              () => automationApi.runPersonal(org, r.kind),
              "任务已提交",
            )
          }
        />
      ) : view === "templates" ? (
        <TemplateLibrary key={org + user} org={org} user={user} canManage={data.canManage} />
      ) : null}
      {view === "company" && data.canManage && query.data ? (
        <section
          aria-label="自动化流程"
          className="divide-y rounded-lg border bg-card"
        >
          {data.rules.length ? (
            data.rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                managers={(company.data?.assignees ?? []).filter((m) =>
                  m.role.split(",").some((r) => ["owner", "admin"].includes(r)),
                )}
                canManage={data.canManage}
                busy={Boolean(busy)}
                onSave={(r) =>
                  void act(
                    r.kind,
                    () => automationApi.save(org, r),
                    "流程设置已保存",
                  )
                }
                onRun={() =>
                  void act(
                    rule.kind,
                    () => automationApi.run(org, rule.kind),
                    "任务已提交，结果会显示在执行记录中",
                  )
                }
              />
            ))
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              暂无可用自动化
            </p>
          )}
        </section>
      ) : null}
      {query.data && (view === "mine" || view === "company") ? (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">
              {view === "mine" ? "我的跟进待办" : "公司跟进待办"}
            </h2>
            {data.todos.length ? (
              <div className="divide-y rounded-lg border">
                {data.todos.map((todo) => (
                  <article
                    key={todo.id}
                    className="flex items-start justify-between gap-4 p-5"
                  >
                    <div>
                      <h3 className="font-medium">
                        {todo.title}
                        <span className="ml-3 text-xs text-muted-foreground">
                          {todo.ownerName || "负责人"} ·{" "}
                          {todo.status === "DONE" ? "已处理" : todo.status === "CANCELLED" ? "已取消" : "待处理"}
                        </span>
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {todo.description}
                      </p>
                    </div>
                    {todo.status === "OPEN" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(
                            todo.id,
                            () => automationApi.done(org, todo.id),
                            "待办已标记为完成",
                          )
                        }
                      >
                        <Check className="size-4" />
                        标记完成
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                暂无跟进待办
              </p>
            )}
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">
              {view === "mine" ? "我的执行记录" : "公司执行记录"}
            </h2>
            {data.runs.length ? (
              <div className="divide-y rounded-lg border">
                {data.runs.map((run) => (
                  <article key={run.id} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-medium">
                          {run.kind === "FOLLOW_UP"
                            ? "我的跟进提醒"
                            : labels[run.kind]}
                        </h3>
                        <span
                          className={`text-xs ${run.status === "FAILED" ? "text-destructive" : run.status === "SUCCESS" ? "text-green-700" : "text-muted-foreground"}`}
                        >
                          {labels[run.status] || run.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {time(run.createdAt)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {run.status === "SUCCESS" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void act(
                                run.id,
                                () =>
                                  automationApi.download(
                                    org,
                                    run.id,
                                    (run.kind === "FOLLOW_UP"
                                      ? "我的跟进提醒"
                                      : labels[run.kind]) +
                                      (run.kind === "LEAD_READY"
                                        ? ".xlsx"
                                        : ".txt"),
                                  ),
                                "文件已生成",
                              )
                            }
                          >
                            <Download className="size-4" />
                            {run.kind === "LEAD_READY"
                              ? "下载表格"
                              : "下载结果"}
                          </Button>
                        ) : run.status === "FAILED" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void act(
                                run.id,
                                () => automationApi.retry(org, run.id),
                                "任务已重新提交",
                              )
                            }
                          ><RefreshCw aria-hidden="true" className="size-4" />
                            重新执行
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {run.error ? (
                      <p role="status" className="mt-3 text-sm text-amber-700">
                        {run.error}
                      </p>
                    ) : null}
                    {run.result ? (
                      <details
                        className="mt-3 text-sm"
                        open={run.status === "SUCCESS"}
                      >
                        <summary className="cursor-pointer text-muted-foreground">
                          查看结果
                        </summary>
                        <dl className="mt-3 grid gap-2 sm:grid-cols-[9rem_1fr]">
                          {Object.entries(run.result).map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="text-muted-foreground">
                                {labels[key] || key}
                              </dt>
                              <dd className="whitespace-pre-wrap break-words">
                                {typeof value === "boolean"
                                  ? value
                                    ? "是"
                                    : "否"
                                  : labels[String(value)] ||
                                    String(value ?? "")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                {view === "mine"
                  ? "暂无个人执行记录"
                  : "暂无公司执行记录"}
              </p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
function RuleRow({
  rule,
  managers,
  canManage,
  busy,
  onSave,
  onRun,
}: {
  rule: AutomationRule;
  managers: { id: string; name: string }[];
  canManage: boolean;
  busy: boolean;
  onSave: (r: AutomationRule) => void;
  onRun: () => void;
}) {
  const [hour, setHour] = useState(String(rule.dailyHour));
  return (
    <article className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
      <div>
        <h2 className="font-semibold">{rule.name}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {descriptions[rule.kind]}
        </p>
        {rule.kind !== "LEAD_READY" && canManage ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            负责人
            <NativeSelect
              className="h-8 rounded border bg-background px-2"
              value={rule.ownerId}
              disabled={busy || !managers.length}
              onChange={(e) => onSave({ ...rule, ownerId: e.target.value })}
            >
              {managers.length ? (
                managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              ) : (
                <option value={rule.ownerId}>当前负责人</option>
              )}
            </NativeSelect>
          </label>
        ) : null}
        {rule.kind === "DAILY_REPORT" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor={"daily-hour-" + rule.id}>每天生成时间</label>
            <Input
              id={"daily-hour-" + rule.id}
              type="number"
              min="0"
              max="23"
              value={hour}
              disabled={!canManage || busy}
              onChange={(e) => setHour(e.target.value)}
              className="h-8 w-16"
            />
            <span className="text-muted-foreground">点，北京时间</span>
            {canManage ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  busy ||
                  hour === "" ||
                  !Number.isInteger(Number(hour)) ||
                  Number(hour) < 0 ||
                  Number(hour) > 23 ||
                  Number(hour) === rule.dailyHour
                }
                onClick={() => onSave({ ...rule, dailyHour: Number(hour) })}
              ><Save aria-hidden="true" className="size-4" />
                保存时间
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-start gap-3">
        <label className="flex items-center gap-2 pt-2 text-sm">
          <Switch
            checked={rule.enabled}
            disabled={!canManage || busy}
            aria-label={"开启" + rule.name}
            onCheckedChange={(checked) => onSave({ ...rule, enabled: checked })}
          />
          {rule.enabled ? "已开启" : "已关闭"}
        </label>
        {canManage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !rule.enabled}
            onClick={onRun}
          >
            <Play className="size-3" />
            {rule.kind === "DAILY_REPORT"
              ? "生成今日日报"
              : rule.kind === "LEAD_READY"
                ? "整理最新线索"
                : "整理最新通话"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
