/*
 * 中文导读：阿里云连接的 ServiceAdministration 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAgents } from "@/src/hooks/queries/agents";
import { useAliyunTasks } from "@/src/hooks/queries/aliyun";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { aliyunApi, type AliyunTask } from "@/src/lib/api/resources/aliyun";
import { AliyunAgentPanel } from "./AgentPanel";
import { AgentRuntime } from "./AgentRuntime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Notice } from "./Shared";
import { toast } from "@/src/lib/toast";

function TaskRecovery({ task }: { task: AliyunTask }) {
  const [remoteId, setRemoteId] = useState("");
  const qc = useQueryClient();
  const recovery = useMutation({
    mutationFn: () => aliyunApi.action(task.id, "reconcile", { remoteId: remoteId.trim() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["aliyun", "tasks"] }); toast.success("任务关联已恢复"); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <article className="space-y-3 rounded-lg border p-4">
    <h3 className="text-sm font-medium">{task.name}</h3>
    <dl className="space-y-1 text-xs text-muted-foreground"><div>本地任务 ID：{task.id}</div><div>阿里云任务 ID：{task.remoteId || "未关联"}</div><div>云端话术：{task.cloudAgentId || task.scriptId || "未关联"}</div><div>任务状态：{task.status}</div></dl>
    {task.errorMessage && <Notice>{task.errorMessage}</Notice>}
    {["NEEDS_REVIEW", "UPLOADING", "SUBMITTING"].includes(task.status) && <div className="flex flex-wrap gap-2"><Input className="max-w-md" aria-label={`恢复${task.name}的任务关联`} placeholder="从阿里云控制台复制已创建的任务 ID" value={remoteId} onChange={e => setRemoteId(e.target.value)} /><Button variant="outline" disabled={!remoteId.trim() || recovery.isPending} onClick={() => recovery.mutate()}>核对并恢复关联</Button></div>}
  </article>;
}

function Administration() {
  const agents = useAgents();
  const tasks = useAliyunTasks();
  const [selected, setSelected] = useState("");
  const id = agents.data?.some(a => a.agentId === selected) ? selected : agents.data?.[0]?.agentId || "";
  return <div className="space-y-5">
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div><h2 className="font-semibold">数字员工服务关联</h2></div>
      <label className="grid max-w-md gap-2 text-sm">选择数字员工<NativeSelect className="h-9 rounded-md border bg-background px-3" value={id} onChange={e => setSelected(e.target.value)}><option value="" disabled>请选择数字员工</option>{agents.data?.map(a => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect></label>
      {agents.error && <Notice>{agents.error.message}</Notice>}
      {id && <div key={id} className="space-y-5"><AliyunAgentPanel agentId={id} /><AgentRuntime agentId={id} /></div>}
      {!agents.isPending && !agents.error && !id && <p className="text-sm text-muted-foreground">请先创建数字员工。</p>}
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">外呼任务诊断</h2><p className="text-xs text-muted-foreground">核对已有任务的云端编号；恢复关联不会重新创建任务或发起电话。</p>{tasks.error ? <Notice>{tasks.error.message}</Notice> : tasks.data?.length ? tasks.data.map(task => <TaskRecovery key={task.id} task={task} />) : <p className="text-sm text-muted-foreground">{tasks.isPending ? "正在读取任务…" : "暂无外呼任务。"}</p>}</section>
  </div>;
}

export function ServiceAdministration() {
  const company = useCompanyContext();
  if (company.isPending) return <p className="text-sm text-muted-foreground">正在读取权限…</p>;
  if (!company.data?.canManage) return <p className="text-sm text-muted-foreground">仅公司管理员可以维护服务配置。</p>;
  return <Administration key={company.data.organizationId} />;
}
