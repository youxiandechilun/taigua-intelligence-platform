/*
 * 中文导读：线路与语音外呼的 AliyunLegacySettings 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Cloud, RefreshCw, ExternalLink } from "lucide-react";
import { useAliyunConfig, useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { aliyunApi, type AliyunConfig, type AliyunConfigInput } from "@/src/lib/api/resources/aliyun";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import { Notice } from "@/src/components/aliyun/Shared";
import { toast } from "@/src/lib/toast";
import { CloudCapabilityTable, CloudResourceManager, DialPolicyEditor, DEFAULT_POLICY } from "@/src/components/aliyun/CloudSettingsControls";

import { ServiceAdministration } from "@/src/components/aliyun/ServiceAdministration";

function ConfigurationForm({ config }: { config: AliyunConfig }) {
  const qc = useQueryClient();
  const { org } = useAliyunIdentity();
  const [tab, setTab] = useState("connection");
  const [draft, setDraft] = useState<AliyunConfigInput>({ dialPolicy: config.dialPolicy || DEFAULT_POLICY, seatInstanceId: config.seatInstanceId || "", product: config.product, communicationAgentId: config.communicationAgentId, branchId: config.branchId, versionId: config.versionId, approvedKnowledge: config.approvedKnowledge, concurrency: config.concurrency, regionId: config.regionId, instanceId: config.instanceId, defaultScriptId: config.defaultScriptId, model: config.model, callerNumbers: config.callerNumbers, liveEnabled: config.liveEnabled });
  const [callers, setCallers] = useState(config.callerNumbers.join("\n"));
  const save = useMutation({ mutationFn: (input: AliyunConfigInput) => aliyunApi.save(input, org), onSuccess: () => { void qc.invalidateQueries({queryKey:["aliyun","connection"]}); void qc.invalidateQueries({queryKey:["aliyun","agent-status"]}); qc.removeQueries({queryKey:["aliyun","agent-cloud"]}); setDraft(d => ({ ...d, accessKeyId: "", accessKeySecret: "", securityToken: "", dashscopeApiKey: "" })); toast.success("阿里云配置已保存"); }, onError: (e: Error) => toast.error(e.message) });
  const resources = useMutation({ mutationFn: () => aliyunApi.resources(org), onError: (e: Error) => toast.error(e.message) });
  function submit(event: FormEvent) { event.preventDefault(); const numbers = [...new Set(callers.split(/[\n,，;；]/).map(n => n.trim()).filter(Boolean))]; save.mutate({ ...draft, callerNumbers: numbers }); }
  function field(key: keyof AliyunConfigInput, label: string, placeholder = "", secret = false) {
    return <label className="grid gap-2 text-sm" key={key} htmlFor={`aliyun-${key}`}><span className="font-medium">{label}</span><Input id={`aliyun-${key}`} type={secret ? "password" : "text"} autoComplete="off" placeholder={placeholder} value={String(draft[key] ?? "")} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /></label>;
  }
  return <div className="space-y-5">
    <Notice success={config.ready}>{config.ready ? "接入参数已齐全。点击检查连接，核对实例与已发布话术。" : `还需填写：${config.missing.join("、")}`}</Notice>
    <div className="flex flex-wrap gap-2 border-b pb-4" role="group" aria-label="阿里云设置分类">{[{id:"connection",label:"接入配置"},{id:"rules",label:"拨打规则"},{id:"resources",label:"云端资源"},{id:"employees",label:"员工服务关联"},{id:"scope",label:"功能接入范围"}].map(item=><Button key={item.id} variant={tab===item.id?"secondary":"ghost"} className={tab===item.id?"text-primary bg-primary/5":"text-muted-foreground"} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}>{item.label}</Button>)}</div>
    {tab === "resources" && <CloudResourceManager config={config} onSelect={patch=>{setDraft(d=>({...d,...patch}));setTab("connection");}} />}
    {tab === "scope" && <CloudCapabilityTable />}
    {tab === "employees" && <ServiceAdministration />}
    <form onSubmit={submit} className="space-y-5" hidden={tab === "resources" || tab === "scope" || tab === "employees"}>
      <div className="space-y-5" hidden={tab !== "connection"}>
      <section className="border bg-card p-5 space-y-4"><h2 className="font-semibold flex items-center gap-2"><Cloud className="size-4" />外呼实例与线路</h2>
        <label className="grid gap-2 text-sm">接入产品<NativeSelect aria-label="接入产品" className="h-9 border bg-background px-3" value={draft.product} onChange={e => setDraft(d => ({ ...d, product: e.target.value as AliyunConfigInput["product"], liveEnabled: false, dialPolicy: { ...d.dialPolicy, holidayRestricted: true } }))}><option value="aiccs">通信智能体（大模型通话）</option><option value="outboundbot">智能外呼机器人（实例 / 话术）</option></NativeSelect></label>
        <div className="grid gap-4 md:grid-cols-2">{field("regionId", "地域", "cn-shanghai")}{draft.product === "aiccs" ? <>{field("communicationAgentId", "默认通信智能体 ID")}{field("branchId", "分支 ID（可选）")}{field("versionId", "已发布版本 ID（可选）")}</> : <>{field("instanceId", "外呼实例 ID")}{field("defaultScriptId", "默认已发布话术 ID（可选）")}</>}</div>
        {draft.product === "aiccs" && <p className="text-xs text-muted-foreground">可先保存云端草稿 ID。启动前会核验当前已发布且生效的分支和版本；此处保存不代表已发布。</p>}

        <label className="grid gap-2 text-sm"><span className="font-medium">审核通过的主叫号码</span><Textarea value={callers} onChange={e => setCallers(e.target.value)} placeholder="每行一个号码；座机需带区号" rows={3} /><span className="text-xs text-muted-foreground">填入属于当前阿里云实例的号码；号码资质和使用权限由阿里云校验。</span></label>
        {draft.product === "aiccs" && field("seatInstanceId", "人工坐席实例 ID（可选）", "有人工线路时配置，与通信智能体 ID 不同")}
        <a className="inline-flex items-center gap-1 text-sm text-primary" href="https://aiccs.console.aliyun.com/agentNew/agentManage" target="_blank" rel="noreferrer">打开阿里云控制台<ExternalLink className="size-3" /></a>
      </section>
      <section className="border bg-card p-5 space-y-4"><div><h2 className="font-semibold">服务端访问凭据</h2><p className="mt-1 text-xs text-muted-foreground">{config.hasAccessKey ? "已保存 AccessKey。留空可保留，更新时同时填写 ID 和 Secret。" : "使用仅具有当前通信服务所需权限的 RAM AccessKey。"} 凭据在服务端加密保存。</p></div>
        <div className="grid gap-4 md:grid-cols-2">{field("accessKeyId", "AccessKey ID", "请输入", true)}{field("accessKeySecret", "AccessKey Secret", "请输入", true)}{field("securityToken", "临时凭证 Token（可选）", "仅 STS 凭证需要", true)}</div>
      </section>
      <section className="border bg-card p-5 space-y-4"><h2 className="font-semibold">百炼文字试聊</h2><p className="text-sm text-muted-foreground">用工作区话术草稿演练回答。电话中的模型、声音及人工转接在阿里云已发布话术中配置。</p>
        <div className="grid gap-4 md:grid-cols-2">{field("dashscopeApiKey", "百炼中国区 API Key", config.hasDashscopeKey ? "已保存；留空保留" : "用于文字试聊", true)}
          <label className="grid gap-2 text-sm"><span className="font-medium">试聊模型</span><NativeSelect aria-label="试聊模型" className="h-9 border bg-background px-3" value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}><option value="qwen-plus">通义千问 Plus</option><option value="qwen-turbo">通义千问 Turbo</option><option value="qwen-max">通义千问 Max</option></NativeSelect></label>
        </div>
        <label className="grid gap-2 text-sm"><span className="font-medium">公司已确认业务资料</span><Textarea aria-label="公司已确认业务资料" rows={8} value={draft.approvedKnowledge} onChange={e => setDraft(d => ({ ...d, approvedKnowledge: e.target.value }))} /><span className="text-xs text-muted-foreground">试聊回答公司事实时以此为依据；未确认的业务、报价和承诺交由负责人回答。</span></label>
      </section>
      <section className="border bg-card p-5 space-y-2"><h2 className="font-semibold">通话结果回传</h2><p className="text-sm">{config.callbackReady ? "服务器接收端已配置：呼叫记录、录音、小记。" : "服务器回执认证尚未配置。"}</p><p className="text-xs text-muted-foreground">云端回执地址需单独保存；正式通话后才能验证完整回传。录音链接通常有效 7 天。</p></section>
      <div className="flex items-center justify-between border bg-card p-5"><div><label htmlFor="live-enabled" className="font-medium">允许真实外呼</label><p className="mt-1 text-xs text-muted-foreground">开启后，仍需在任务详情中确认启动。通信费用由阿里云账户结算。</p></div><Switch id="live-enabled" checked={draft.liveEnabled} onCheckedChange={v => setDraft(d => ({ ...d, liveEnabled: v }))} /></div>
      </div>
      {tab === "rules" && <><DialPolicyEditor value={draft.dialPolicy} product={draft.product} onChange={dialPolicy=>setDraft(d=>({...d,dialPolicy}))} />{draft.product === "aiccs" && <label className="grid gap-2 rounded-lg border p-5 text-sm">新任务并发数<Input type="number" min={1} max={10} value={draft.concurrency} onChange={e=>setDraft(d=>({...d,concurrency:Number(e.target.value)}))} /><span className="text-xs text-muted-foreground">测试建议 1 路；实际额度由阿里云校验。更高并发会加快拨号和费用消耗。</span></label>}</>}
      <div className="flex flex-wrap gap-3"><Button disabled={save.isPending} type="submit"><Save className="size-4" />{save.isPending ? "保存中…" : "保存配置"}</Button><Button type="button" variant="outline" disabled={save.isPending || resources.isPending || !config.hasAccessKey || !(config.product === "aiccs" ? config.communicationAgentId : config.instanceId)} onClick={() => resources.mutate()}><RefreshCw className="size-4" />{resources.isPending ? "检查中…" : "检查已保存的连接"}</Button></div>
    </form>
    {tab === "connection" && resources.data && <section className="border bg-card p-5 space-y-3"><Notice success={resources.data.published !== false}>已连接云端：{resources.data.instance.name || resources.data.instance.id}，并发额度 {resources.data.instance.concurrency ?? "以控制台为准"}</Notice><h2 className="font-medium">云端话术状态</h2>{resources.data.scripts.length ? <ul className="divide-y">{resources.data.scripts.map(s => <li className="py-3 flex flex-wrap justify-between gap-2 text-sm" key={s.id}><span>{s.name || "未命名话术"} · {s.status || "已发布"}</span><span className="text-muted-foreground break-all">{s.id}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">此实例暂未返回已发布话术，请在阿里云完成话术发布。</p>}</section>}
    <details className="border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">接口与连接信息</summary><dl className="mt-3 space-y-2"><div>通话后端：{config.backend}</div><div>外呼服务：{config.endpoint}</div><div>API 版本：{config.apiVersion}，{config.transport}</div><div>百炼服务：{config.dashscopeEndpoint}</div></dl></details>
  </div>;
}
export default function AliyunSettingsPage() {
  const query = useAliyunConfig();
  const { org } = useAliyunIdentity();
  return <div className="space-y-5">{query.isLoading ? <p>读取配置中…</p> : query.error ? <Notice>{query.error.message}</Notice> : query.data && <ConfigurationForm key={`${org}:${query.data.product}:${query.data.regionId}:${query.data.instanceId}`} config={query.data} />}</div>;
}
