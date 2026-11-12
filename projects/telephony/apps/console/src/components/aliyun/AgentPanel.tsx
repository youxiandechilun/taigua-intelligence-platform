/*
 * 中文导读：阿里云连接的 AgentPanel 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Download, RefreshCw , Save } from "lucide-react";
import { aliyunApi, type AgentStatus } from "@/src/lib/api/resources/aliyun";
import {
  useAliyunAgentStatus,
  useAliyunAgentCloud,
  useAliyunIdentity,
} from "@/src/hooks/queries/aliyun";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toast } from "@/src/lib/toast";
import { AgentVoiceProfile } from "./AgentVoiceProfile";
export function CloudCheck({ agentId }: { agentId: string }) {
  const status = useAliyunAgentStatus(agentId),
    cloud = useAliyunAgentCloud(agentId);
  const d = cloud.data;
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={
          cloud.isFetching ||
          !status.data?.hasAccessKey ||
          !status.data?.binding.agentId
        }
        onClick={() => void cloud.refetch()}
      >
        <RefreshCw className="size-4" />
        {cloud.isFetching ? "正在核验…" : "核验当前智能体云端版本"}
      </Button>
      {!status.data?.hasAccessKey ? (
        <p className="text-sm text-amber-700">
          尚未配置阿里云 AccessKey，无法查询云端生效状态。
        </p>
      ) : null}
      {cloud.error ? (
        <p role="alert" className="text-sm text-destructive">
          {cloud.error.message}
        </p>
      ) : null}
      {d && !cloud.error ? (
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p
            className={
              d.published && d.matchesBinding
                ? "text-emerald-700"
                : "text-amber-700"
            }
          >
            {d.published
              ? d.matchesBinding
                ? "云端已发布并生效，绑定版本匹配"
                : "云端已生效，但绑定版本不匹配，请更新绑定"
              : "云端尚未发布生效"}
          </p>
          <p>
            {d.name} · 分支 {d.branchId || "未提供"} · 版本{" "}
            {d.versionId || "未提供"}
          </p>
          {d.prologue ? (
            <div className="rounded border bg-muted/20 p-3 whitespace-pre-wrap">
              <span className="text-muted-foreground">云端当前开场白：</span>
              {d.prologue}
            </div>
          ) : null}
          <p className="text-muted-foreground">
            核验时间：{new Date(d.checkedAt).toLocaleString("zh-CN")}
            。网页准备稿与云端内容仍需核对。
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          尚未核验云端。配置完整后仍需小范围拨测确认通话效果。
        </p>
      )}
    </div>
  );
}
function BindingEditor({
  agentId,
  status,
}: {
  agentId: string;
  status: AgentStatus;
}) {
  const { org } = useAliyunIdentity();
  const qc = useQueryClient();
  const [id, setId] = useState(status.binding.agentId);
  const [branch, setBranch] = useState(status.binding.branchId || "");
  const [version, setVersion] = useState(status.binding.versionId || "");
  const catalog = useMutation({ mutationFn: () => aliyunApi.catalog("agents", org, { page: 1, pageSize: 100 }) });
  const bind = useMutation({
    mutationFn: () =>
      status.product === "aiccs"
        ? aliyunApi.bindCommunication(
            agentId,
            {
              agentId: id.trim(),
              branchId: branch.trim() || undefined,
              versionId: version.trim() || undefined,
            },
            org,
          )
        : aliyunApi.bind(agentId, id.trim(), org),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["aliyun", "connection"] });
      void qc.invalidateQueries({ queryKey: ["aliyun", "agent-status"] });
      qc.removeQueries({ queryKey: ["aliyun", "agent-cloud"] });
      toast.success("关联已保存，请重新核验云端版本");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      {status.canManage && <div className="space-y-3"><Button variant="outline" disabled={!status.hasAccessKey || catalog.isPending} onClick={() => catalog.mutate()}><RefreshCw className="size-4" />{catalog.isPending ? "查询中…" : "从阿里云选择智能体或话术"}</Button>{catalog.error && <p role="alert" className="text-xs text-destructive">{catalog.error.message}</p>}{catalog.data && <label className="grid gap-2 text-sm">云端资源<NativeSelect aria-label="本智能体云端资源" className="h-9 rounded-md border bg-background px-3" value={id} onChange={e => { const entry = catalog.data?.entries.find(v => v.id === e.target.value); setId(e.target.value); setBranch(entry?.branchId || ""); setVersion(entry?.versionId || ""); }}><option value="">请选择</option>{id && !catalog.data.entries.some(v => v.id === id) && <option value={id}>{id}（当前关联）</option>}{catalog.data.entries.map(v => <option key={v.id} value={v.id}>{v.name} · {v.published ? "已发布" : "草稿"}</option>)}</NativeSelect>{catalog.data.hasMore && <span className="text-xs text-muted-foreground">这里只显示前100条，更多资源可在阿里云设置页分页查询。</span>}</label>}</div>}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-2 text-sm">
          {status.product === "aiccs" ? "通信智能体 ID" : "云端话术 ID"}
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!status.canManage || bind.isPending}
          />
        </label>
        {status.product === "aiccs" ? (
          <>
            <label className="grid gap-2 text-sm">
              分支 ID（可选）
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={!status.canManage || bind.isPending}
              />
            </label>
            <label className="grid gap-2 text-sm">
              版本 ID（可选）
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={!status.canManage || bind.isPending}
              />
            </label>
          </>
        ) : null}
      </div>
      {status.canManage ? (
        <Button
          title="保存关联不会修改阿里云话术；提交外呼前会核对分支和版本。"
          disabled={
            !id.trim() || bind.isPending || (!!version.trim() && !branch.trim())
          }
          onClick={() => bind.mutate()}
        ><Save aria-hidden="true" className="size-4" />
          {bind.isPending ? "保存中…" : "保存本智能体独立关联"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          云端关联由公司管理员修改。
        </p>
      )}
    </div>
  );
}
export function AliyunAgentPanel({ agentId, showProfile = true }: { agentId: string; showProfile?: boolean }) {
  const status = useAliyunAgentStatus(agentId);
  const { org } = useAliyunIdentity();
  const exportDraft = useMutation({
    mutationFn: () => aliyunApi.scriptExport(agentId, org),
    onSuccess: (d) => {
      const url = URL.createObjectURL(
        new Blob(["\ufeff" + d.content], { type: "text/plain;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        d.name.replace(/[\\/:*?"<>|]/g, "_") + "-阿里云话术准备稿.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("话术与已启用知识已导出");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (status.isLoading) return <p>正在加载电话配置…</p>;
  if (!status.data) return <p role="alert">电话配置加载失败，请刷新页面。</p>;
  const s = status.data;
  return (
    <div className="space-y-5">
      {showProfile && <AgentVoiceProfile agentId={agentId} />}
      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Cloud className="size-4" />
          当前智能体的云端关联
        </h2>
        <p className="text-sm">
          关联来源：
          {s.bindingSource === "independent"
            ? "本智能体独立配置"
            : "工作区默认配置"}{" "}
          · {s.binding.agentId || "尚未绑定"}
        </p>
        {s.sharedBindingCount > 0 ? (
          <p className="text-sm text-amber-700">
            另有 {s.sharedBindingCount} 个网页智能体使用相同云端
            ID，实际电话话术共用同一云端智能体。要使用不同电话话术，请在阿里云分别创建智能体并绑定。
          </p>
        ) : null}
        <BindingEditor
          key={org + JSON.stringify(s.binding)}
          agentId={agentId}
          status={s}
        />
        <CloudCheck agentId={agentId} />
      </section>
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="font-semibold">话术与知识发布</h2>
        <details className="rounded-md border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">发布流程</summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>在网页编辑并保存话术、业务知识。</li>
            <li>下载准备稿，在阿里云对应智能体中配置话术、知识、声音和转人工。</li>
            <li>在阿里云发布生效，再回本页核验版本。</li>
          </ol>
        </details>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={exportDraft.isPending}
            onClick={() => exportDraft.mutate()}
          >
            <Download className="size-4" />
            {exportDraft.isPending ? "正在导出…" : "下载话术与知识准备稿"}
          </Button>
          <Button asChild variant="outline">
            <a
              href={
                s.product === "aiccs"
                  ? "https://aiccs.console.aliyun.com/agentNew/agentManage"
                  : "https://outboundbot.console.aliyun.com"
              }
              target="_blank"
              rel="noreferrer"
            >
              打开阿里云编辑与发布
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          当前接入接口支持版本查询和任务管理；云端话术发布需要在阿里云控制台完成。
        </p>
      </section>
      <section className="rounded-lg border p-5 space-y-3">
        <h2 className="font-semibold">百炼文字试聊</h2>
        <p className="text-sm">
          模型：{s.model} ·{" "}
          {s.hasDashscopeKey
            ? "API Key 已配置，调用结果以试聊为准"
            : "API Key 未配置"}
        </p>
        <p className="text-sm text-muted-foreground">
          右上角“百炼试聊”使用网页已保存话术及已启用知识。电话语音识别、声音和打断由阿里云云端配置。
        </p>
        <Button asChild variant="outline">
          <Link href="/settings/aliyun">设置模型与阿里云凭据</Link>
        </Button>
      </section>
    </div>
  );
}
