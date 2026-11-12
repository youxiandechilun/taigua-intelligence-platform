/*
 * 中文导读：阿里云连接的 CloudSettingsControls 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Cloud, Volume2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Notice } from "./Shared";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { aliyunApi, type AliyunConfig, type AliyunConfigInput, type DialPolicy, type CloudCatalog } from "@/src/lib/api/resources/aliyun";
import { toast } from "@/src/lib/toast";

export const DAY_LABELS: Record<string, string> = { MONDAY: "周一", TUESDAY: "周二", WEDNESDAY: "周三", THURSDAY: "周四", FRIDAY: "周五", SATURDAY: "周六", SUNDAY: "周日" };
export const DEFAULT_POLICY: DialPolicy = { start: "09:00", end: "18:00", days: Object.keys(DAY_LABELS).slice(0, 5), retries: 0, retryIntervalMinutes: 60, holidayRestricted: true };
export function policyText(policy?: DialPolicy, product?: string) {
  const p = policy?.start ? policy : DEFAULT_POLICY;
  return `北京时间 ${p.start}–${p.end}${(product === "aiccs" || product === "sip") ? `，${p.days.map(d => DAY_LABELS[d]).join("、")}${product === "sip" && p.holidayRestricted ? "，避开法定节假日" : ""}` : p.holidayRestricted ? "，避开法定节假日" : ""}，每位客户最多拨打 ${p.retries + 1} 次${p.retries ? `，未接通重拨间隔 ${p.retryIntervalMinutes} 分钟` : ""}`;
}
export function DialPolicyEditor({ value, product, onChange, scope = "workspace", compact = false, disabled = false }: { value: DialPolicy; product: string; onChange: (policy: DialPolicy) => void; scope?: "workspace" | "agent"; compact?: boolean; disabled?: boolean }) {
  const patch = (next: Partial<DialPolicy>) => onChange({ ...value, ...next });
  return <section className={compact ? "min-w-0 space-y-3" : "rounded-lg border bg-card p-5 space-y-5"} aria-label="拨打时间与重拨">
    {!compact && <div><h2 className="font-semibold">拨打时间与重拨</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{scope === "agent" ? "仅用于此数字员工的新任务，优先于工作区默认规则。" : "保存为当前工作区的任务默认值。"}新建任务会固定这份规则，修改设置不会改变既有任务。</p></div>}
    <fieldset disabled={disabled} className={compact ? "min-w-0 space-y-3 [&_label]:text-xs [&_input:disabled]:opacity-80 [&_select:disabled]:opacity-80" : "min-w-0 space-y-5"}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">开始拨打（北京时间）<Input required type="time" value={value.start} onChange={e => patch({ start: e.target.value })} /></label><label className="grid gap-2 text-sm">结束拨打（北京时间）<Input required type="time" value={value.end} onChange={e => patch({ end: e.target.value })} /></label></div>
    {(product === "aiccs" || product === "sip") ? <fieldset className="space-y-2"><legend className="mb-2 text-xs font-medium">可拨打星期</legend><div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-3"}>{Object.entries(DAY_LABELS).map(([day, label]) => <label key={day} className={compact ? "flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs" : "flex items-center gap-2 rounded-md border px-3 py-2 text-sm"}><input type="checkbox" className="accent-primary" checked={value.days.includes(day)} onChange={e => patch({ days: e.target.checked ? [...value.days, day] : value.days.filter(d => d !== day) })} />{label}</label>)}</div>{product === "aiccs" && <p className="text-xs text-muted-foreground">当前按星期安排拨打，不支持自动排除法定节假日。</p>}</fieldset> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.holidayRestricted} onChange={e => patch({ holidayRestricted: e.target.checked })} />避开法定节假日</label>}
    {product === "sip" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.holidayRestricted} onChange={e => patch({ holidayRestricted: e.target.checked })} />避开法定节假日</label>}
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">未接通重拨次数<NativeSelect className="h-9 rounded-md border bg-background px-3" value={value.retries} onChange={e => patch({ retries: Number(e.target.value) })}>{[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? "不自动重拨" : `重拨 ${n} 次（最多拨打 ${n + 1} 次）`}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">重拨间隔（分钟）<Input type="number" min={1} max={720} disabled={!value.retries} value={value.retryIntervalMinutes} onChange={e => patch({ retryIntervalMinutes: Number(e.target.value) })} /></label></div>
    </fieldset>
    {compact ? <p className="text-[11px] leading-5 text-muted-foreground">规则用于新任务；已有任务继续使用原规则。</p> : <div className="rounded-md bg-primary/5 p-3 text-xs leading-5 text-primary">当前规则：{policyText(value, product)}</div>}
  </section>;
}

export function CloudResourceManager({ config, onSelect }: { config: AliyunConfig; onSelect: (patch: Partial<AliyunConfigInput>) => void }) {
  const { org } = useAliyunIdentity();
  const [kind, setKind] = useState<"agents" | "voices" | "instances" | "seat-numbers">("agents");
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<CloudCatalog | null>(null);
  const [voice, setVoice] = useState<CloudCatalog["entries"][number] | null>(null);
  const query = useMutation({ mutationFn: ({ type, page }: { type: typeof kind; page: number }) => aliyunApi.catalog(type, org, { page, pageSize: 20, keyword: type === "agents" || type === "instances" ? keyword : "" }), onSuccess: data => setResult(data), onError: () => setResult(null) });
  const load = (page = 1) => query.mutate({ type: kind, page });
  const labels = { agents: config.product === "aiccs" ? "云端智能体" : "已发布话术", voices: "音色与试听", instances: config.product === "aiccs" ? "人工坐席实例" : "外呼实例", "seat-numbers": "人工坐席号码" };
  return <section className="space-y-5">
    <div className="flex flex-wrap gap-2" role="group" aria-label="云端资源分类">{Object.entries(labels).filter(([type]) => type !== "seat-numbers" || config.product === "aiccs").map(([type, label]) => <Button key={type} variant={kind === type ? "secondary" : "outline"} className={kind === type ? "text-primary bg-primary/5" : ""} onClick={() => { setKind(type as typeof kind); setResult(null); query.reset(); setVoice(null); }}>{label}</Button>)}</div>
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div><h2 className="flex items-center gap-2 font-semibold"><Cloud className="size-4" />{labels[kind]}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">查询当前工作区已保存凭据对应的阿里云资源。采用资源后需要保存网页配置。</p></div>
      {!config.hasAccessKey && <Notice>尚未保存阿里云 AccessKey。配置服务端凭据后，可直接在这里查询，无需登录云控制台。</Notice>}
      {kind === "seat-numbers" && <p className="text-xs text-muted-foreground">人工坐席实例：{config.seatInstanceId || "未配置"}。此列表用于人工接听线路，不代表 AI 任务的主叫服务号；AI 服务号仍在接入配置中登记。</p>}
      <div className="flex gap-3">{(kind === "agents" || kind === "instances") && <Input aria-label="云端资源名称" placeholder="按名称搜索" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && config.hasAccessKey && !query.isPending) load(); }} />}<Button disabled={!config.hasAccessKey || query.isPending || (kind === "seat-numbers" && !config.seatInstanceId)} onClick={() => load()}><RefreshCw className="size-4" />{query.isPending ? "查询中…" : "查询云端"}</Button></div>
      {query.error && <Notice>{query.error.message}</Notice>}
      {result && !query.error && <><p className="text-xs text-muted-foreground">共 {result.total} 条 · 查询时间 {new Date(result.checkedAt).toLocaleString("zh-CN")}</p>{result.entries.length ? <ul className="divide-y">{result.entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="text-sm font-medium">{entry.name}{entry.published !== undefined && <span className={`ml-2 text-xs ${entry.published ? "text-primary" : "text-muted-foreground"}`}>{entry.published ? "已发布可用" : "未发布"}</span>}</p><p className="mt-1 break-all text-xs text-muted-foreground">{entry.id}{entry.description ? ` · ${entry.description}` : ""}</p></div>{kind === "voices" ? <Button variant="outline" size="sm" disabled={!entry.sampleUrl} onClick={() => setVoice(entry)}><Volume2 className="size-3.5" />试听</Button> : kind !== "seat-numbers" && <Button size="sm" variant="outline" onClick={() => { onSelect(kind === "agents" ? config.product === "aiccs" ? { communicationAgentId: entry.id, branchId: entry.branchId || "", versionId: entry.versionId || "", liveEnabled: false } : { defaultScriptId: entry.id, liveEnabled: false } : config.product === "aiccs" ? { seatInstanceId: entry.id } : { instanceId: entry.id, defaultScriptId: "", liveEnabled: false }); toast.success("已填入配置，请核对后保存"); }}>采用</Button>}</li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">云端未返回此类资源。</p>}{(result.page > 1 || result.hasMore) && <div className="flex gap-3"><Button variant="outline" disabled={query.isPending || result.page <= 1} onClick={() => load(result.page - 1)}>上一页</Button><Button variant="outline" disabled={query.isPending || !result.hasMore} onClick={() => load(result.page + 1)}>下一页</Button></div>}</>}
      {voice?.sampleUrl && <div className="rounded-md border p-4 space-y-2"><p className="text-sm font-medium">{voice.name} · 阿里云试听</p><audio controls preload="none" src={voice.sampleUrl} className="w-full" /></div>}
    </div>
  </section>;
}

export function CloudCapabilityTable() {
  const rows = [
    ["声音、角色性别、回答语言", "数字员工 → 通话设置", "角色与语言用于网页演练；电话音色须云端发布"],
    ["音色库和音色试听", "设置 → 云端资源", "通过官方接口查询与播放已有示例"],
    ["拨打时段、星期、重拨、并发", "数字员工 → 通话设置 / 工作区默认拨打规则", "新任务保存规则，确认启动后提交给阿里云"],
    ["智能体、版本和话术关联", "设置 → 员工服务关联", "查询真实云端资源并保存当前工作区关联"],
    ["外呼任务、记录、录音、小记", "外呼 / 通话记录 / 自动化", "通过现有阿里云任务接口和回执接收端管理"],
    ["开场白、静音、打断、转人工参数", "设置 → 员工服务关联", "可核验云端实际值；通信智能体修改和发布仍在阿里云"],
    ["知识库和热词绑定、网关管理", "网页业务知识 / 阿里云通信智能体", "网页知识可编辑；云端绑定和版本发布仍在阿里云"],
    ["企业资质、号码申请、套餐购买", "阿里云控制台", "涉及运营商审核和开通，保留阿里云办理入口"],
  ];
  return <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/30"><tr>{["功能", "操作位置", "生效方式"].map(s => <th key={s} className="p-4 font-medium">{s}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row[0]} className="border-t">{row.map((cell, i) => <td key={i} className={`p-4 align-top leading-6 ${i ? "text-muted-foreground" : "font-medium"}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
