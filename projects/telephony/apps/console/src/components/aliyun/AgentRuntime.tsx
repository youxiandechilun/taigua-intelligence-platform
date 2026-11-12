/*
 * 中文导读：阿里云连接的 AgentRuntime 组件，封装该界面的展示与交互。
 */
"use client";
import Link from "next/link";
import {
  useAliyunAgentStatus,
  useAliyunAgentCloud,
} from "@/src/hooks/queries/aliyun";
import { Button } from "../ui/button";
import { CloudCheck } from "./AgentPanel";
export function AgentRuntime({ agentId }: { agentId: string }) {
  const query = useAliyunAgentStatus(agentId),
    cloud = useAliyunAgentCloud(agentId);
  const s = query.data,
    d = cloud.error ? undefined : cloud.data;
  if (!s)
    return (
      <p>
        {query.error ? "运行状态加载失败，请刷新页面" : "正在加载运行状态…"}
      </p>
    );
  return (
    <div className="space-y-5">
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="font-semibold">任务提交条件</h2>
        {s.missing.length ? (
          <ul className="list-disc pl-5 text-sm text-amber-700 space-y-2">
            {s.missing.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-700">
            本地提交条件已齐全，仍需核验云端生效版本、号码可用性及真实拨测。
          </p>
        )}
        <Button asChild variant="outline">
          <Link href="/settings/aliyun">配置工作区阿里云服务</Link>
        </Button>
      </section>
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="font-semibold">工作区共用配置</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>服务地域：{s.regionId}</div>
          <div>任务并发：{s.concurrency} 路</div>
          <div>可选主叫：{s.callerCount} 个</div>
          <div>真实外呼：{s.liveEnabled ? "开关已启用" : "尚未启用"}</div>
          <div>回传鉴权：{s.callbackReady ? "服务器已配置" : "尚未配置"}</div>
          <div>通话整理流程：{s.summaryEnabled ? "已开启" : "未开启"}</div>
        </dl>
        <p className="text-sm text-muted-foreground">
          并发与服务凭据作用于当前工作区。回传鉴权已配置不代表阿里云消息投递成功；通话入库后可在“通话结果与跟进”查看。
        </p>
        <Button asChild variant="outline">
          <Link href="/automation?view=company">配置公司通话整理流程</Link>
        </Button>
      </section>
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="font-semibold">云端通话规则</h2>
        <CloudCheck agentId={agentId} />
        {d ? (
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>声音：{d.voice || "云端未提供"}</div>
            <div>最长通话（秒）：{d.sessionTimeout ?? "云端未提供"}</div>
            <div>静音时长（秒）：{d.muteDuration ?? "云端未提供"}</div>
            <div>静音挂断次数：{d.muteHangupNum ?? "云端未提供"}</div>
            <div>
              转人工：
              {d.transferEnabled === null
                ? "云端未提供"
                : d.transferEnabled
                  ? "云端已启用，需拨测"
                  : "云端未启用"}
            </div>
            <div>
              云端知识检索：
              {d.ragEnabled === null
                ? "云端未提供"
                : d.ragEnabled
                  ? "已启用"
                  : "未启用"}
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            核验后显示云端实际规则。网页“人工接管话术”只提供回答规则，实际转接需要云端启用转人工并配置接听号码。
          </p>
        )}
      </section>
    </div>
  );
}
export function AgentStats({ agentId }: { agentId: string }) {
  const q = useAliyunAgentStatus(agentId),
    s = q.data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 border rounded-lg text-xs">
      {[
        { label: "工作区主叫", value: s?.callerCount },
        { label: "本智能体通话", value: s?.callsCount },
        { label: "已启用知识", value: s?.knowledgeCount },
        {
          label: "云端关联",
          value: s
            ? s.binding.agentId
              ? s.bindingSource === "independent"
                ? "独立关联"
                : "工作区默认"
              : "未关联"
            : undefined,
        },
      ].map((x) => (
        <div key={x.label} className="px-4 py-3 border-r last:border-r-0">
          <p className="font-semibold">
            {x.value ?? (q.error ? "加载失败" : "…")}
          </p>
          <p className="mt-1 text-muted-foreground">{x.label}</p>
        </div>
      ))}
    </div>
  );
}
