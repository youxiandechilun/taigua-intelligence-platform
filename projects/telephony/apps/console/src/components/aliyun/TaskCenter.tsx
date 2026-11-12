/*
 * 中文导读：阿里云连接的 TaskCenter 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import {importRecipients} from '@/src/lib/browser-compute/import-recipients';
import {localTask} from '@/src/lib/browser-compute/runtime';
import {CrmRecipientPicker} from "@/src/components/crm/CrmRecipientPicker";
import { downloadExcelMatrix } from "@/src/lib/export-excel";
import { useState, type FormEvent, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, RefreshCw, PhoneCall, FilePlus2 } from "lucide-react";
import { useAgents } from "@/src/hooks/queries/agents";
import { useAliyunConfig, useAliyunTasks, useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { aliyunApi, type AliyunTask, type Recipient, type CallDetail } from "@/src/lib/api/resources/aliyun";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Badge } from "@/src/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { Notice } from "@/src/components/aliyun/Shared";
import { toast } from "@/src/lib/toast";
import { policyText } from "./CloudSettingsControls";
const STATUS: Record<string, string> = { PREPARED: "已核验待启动", DRAFT: "工作区草稿", UPLOADING: "上传中", UPLOADED: "已上传 · 未拨号", SUBMITTING: "提交中", SUBMITTED: "已提交", RUNNING: "执行中", COMPLETED: "已完成", STOPPED: "已停止", NEEDS_REVIEW: "待核对", FAILED: "失败", NOT_ANSWERED: "未接通", IN_PROGRESS: "通话中", SCHEDULED: "待执行", UNKNOWN: "状态待确认" };

function timeInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); }
function TaskForm() {
  const config = useAliyunConfig(); const agents = useAgents(); const qc = useQueryClient();
  const [name, setName] = useState("客户联系"); const [agentId, setAgent] = useState(""); const [caller, setCaller] = useState("");
  const { org, user } = useAliyunIdentity();
  const profile = useQuery({ queryKey: ["aliyun", "voice-profile", user, org, agentId], queryFn: () => aliyunApi.profile(agentId, org), enabled: !!org && !!agentId, retry: false });
  const [parsing,setParsing]=useState(false);
  const [text, setText] = useState(""); const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [issues, setIssues] = useState<string[]>([]); const [duplicates, setDuplicates] = useState(0);
  const [start, setStart] = useState(() => timeInput(new Date())); const [end, setEnd] = useState(() => timeInput(new Date(Date.now() + 86400000)));
  const create = useMutation({ mutationFn: (input:Parameters<typeof aliyunApi.create>[0])=>aliyunApi.create(input,org), onSuccess: () => { qc.invalidateQueries({ queryKey: ["aliyun", "tasks"] }); setRecipients([]); setText(""); toast.success("外呼草稿已创建，尚未拨号"); }, onError: (e: Error) => toast.error(e.message) });
  const fileImport = useMutation({ mutationFn: (file: File) => importRecipients(file,org), onSuccess: data => { setRecipients(data.recipients); setDuplicates(data.duplicates); setIssues(data.invalidRows.map(r => `第 ${r.rowNumber} 行 ${r.phoneNumber}：${r.error}`)); setText(""); }, onError: (e: Error) => toast.error(e.message) });
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size > 2000000) { toast.error("文件不能超过 2 MB"); return; }
    fileImport.mutate(file);
  }
  async function parseText() {
    if(parsing||fileImport.isPending)return;setParsing(true);
    try {
      const parsed=await localTask('numbers',text);
      if(parsed.recipients.length>2000){toast.error('一个任务最多2000个号码，请分批导入。');return;}
      setRecipients(parsed.recipients);setDuplicates(parsed.duplicates);setIssues(parsed.issues);
    } catch {toast.error('号码读取失败，请重试。');}
    finally {setParsing(false);}
  }

  function submit(event: FormEvent) { event.preventDefault(); if (!recipients.length || issues.length) return; create.mutate({ name, agentId, callerNumber: caller, recipients, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() }); }
  return <form onSubmit={submit} className="border bg-card">
    <div className="border-b p-5"><h2 className="font-semibold">创建外呼草稿</h2><p className="mt-1 text-sm text-muted-foreground">选择数字员工和国内客户号码，核对名单与话术后确认启动。</p></div>
    <div className="space-y-5 p-5"><div className="grid gap-4 lg:grid-cols-3"><label className="grid gap-2 text-sm">任务名称<Input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className="grid gap-2 text-sm">数字员工<NativeSelect required className="h-9 border bg-background px-2" value={agentId} onChange={e => setAgent(e.target.value)}><option value="">请选择</option>{agents.data?.filter(a => a.isActive).map(a => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect></label><label className="grid gap-2 text-sm">主叫号码<NativeSelect required className="h-9 border bg-background px-2" value={caller} onChange={e => setCaller(e.target.value)}><option value="">请选择</option>{config.data?.callerNumbers.map(n => <option key={n} value={n}>{n}</option>)}</NativeSelect></label></div>
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">开始时间（本地时间）<Input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label className="grid gap-2 text-sm">结束时间（本地时间）<Input required type="datetime-local" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label></div>
      <div className="space-y-3"><label className="grid gap-2 text-sm">客户号码<Textarea rows={4} disabled={parsing||fileImport.isPending||create.isPending} value={text} onChange={e => { setText(e.target.value); setRecipients([]); setIssues([]); }} placeholder="每行一个国内号码；座机必须带区号" /></label><div className="flex flex-wrap gap-2"><CrmRecipientPicker workspaceId={org} userId={user} disabled={parsing||fileImport.isPending||create.isPending} onSelect={rows=>{const combined=new Map(recipients.map(r=>[r.phoneNumber,r]));let skipped=0;for(const r of rows){if(combined.has(r.phoneNumber))skipped++;else combined.set(r.phoneNumber,r);}if(combined.size>2000){toast.error("一个任务最多2000个号码，请分批选择。");return;}setRecipients([...combined.values()]);setText("");setIssues([]);setDuplicates(d=>d+skipped);}}/><Button type="button" variant="outline" disabled={!text.trim()||parsing||fileImport.isPending||create.isPending} onClick={()=>void parseText()}>整理号码</Button><label className="inline-flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm hover:bg-muted"><Upload className="size-4" />{fileImport.isPending ? "读取中…" : "导入 Excel / CSV"}<input type="file" accept=".csv,.xlsx" className="sr-only" disabled={parsing||fileImport.isPending||create.isPending} onChange={importFile} /></label><Button type="button" variant="ghost" onClick={async() => { try { await aliyunApi.downloadImportTemplate(org); toast.success("Excel 模板已下载。"); } catch (error) { toast.error(error instanceof Error ? error.message : "模板下载失败"); } }}><Download className="size-4" />下载 Excel 模板</Button></div></div>
      {(recipients.length > 0 || issues.length > 0) && <div className="border"><div className="border-b bg-muted/30 px-4 py-3 text-sm">有效号码 {recipients.length} 个 · 已去重 {duplicates} 个 · 待修改 {issues.length} 个</div>{issues.length > 0 && <div className="p-4"><Notice>请修改以下号码后重新导入，避免漏掉客户。</Notice><ul className="mt-2 text-xs text-destructive space-y-1">{issues.slice(0,20).map((s,i) => <li key={i}>{s}</li>)}</ul>{issues.length > 20 && <p className="mt-2 text-xs">另有 {issues.length - 20} 项待修改。</p>}</div>}<div className="max-h-56 overflow-auto"><table className="w-full text-sm"><thead className="bg-muted/20"><tr><th className="px-4 py-2 text-left">公司 / 客户</th><th className="px-4 py-2 text-left">联系电话</th><th className="px-4 py-2 text-left">话术变量</th></tr></thead><tbody>{recipients.slice(0,100).map(r => <tr className="border-t" key={r.phoneNumber}><td className="px-4 py-2">{r.name || "未填写"}</td><td className="px-4 py-2">{r.phoneNumber}</td><td className="px-4 py-2">{Object.keys(r.variables).join("、") || "无"}</td></tr>)}</tbody></table></div>{recipients.length > 100 && <p className="p-3 text-xs text-muted-foreground">预览前 100 行，创建时将保存全部 {recipients.length} 个号码。</p>}</div>}
      {profile.error && <Notice>{profile.error.message}</Notice>}
      <p className="text-xs text-muted-foreground">{agentId && profile.isPending ? "读取本数字员工拨打规则…" : `${profile.data?.profile.dialPolicyOverride ? "本数字员工独立规则" : "工作区默认规则"}：${policyText(profile.data?.profile.dialPolicyOverride || config.data?.dialPolicy, config.data?.product)}`}</p>
      <Button type="submit" disabled={create.isPending || !recipients.length || !!issues.length || !agentId || !caller || !profile.data || !!profile.error}><FilePlus2 className="size-4" />{create.isPending ? "保存中…" : `创建工作区草稿${recipients.length ? `（${recipients.length} 个号码）` : ""}`}</Button>
    </div>
  </form>;
}
function TaskRow({ task }: { task: AliyunTask }) {
  const qc = useQueryClient(); const config = useAliyunConfig(); const [expanded, setExpanded] = useState(false); const [confirmOpen, setConfirm] = useState(false); const [confirmation, setConfirmation] = useState(false); const [detail, setDetail] = useState<CallDetail | null>(null);
  const action = useMutation({ mutationFn: ({ type, input }: { type: "publish" | "start" | "stop" | "sync" | "reconcile"; input?: { confirmation?: string; remoteId?: string } }) => aliyunApi.action(task.id, type, input), onSuccess: () => { qc.invalidateQueries({ queryKey: ["aliyun", "tasks"] }); setConfirm(false); setConfirmation(false); toast.success("任务状态已更新"); }, onError: (e: Error) => { qc.invalidateQueries({ queryKey: ["aliyun", "tasks"] }); toast.error(e.message); } });
  const call = useMutation({ mutationFn: (sessionId: string) => aliyunApi.detail(task.id, sessionId), onSuccess: setDetail, onError: (e: Error) => toast.error(e.message) });
  return <article className="border bg-card"><div className="flex flex-wrap items-start justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><h3 className="font-medium">{task.name}</h3><Badge variant="secondary">{STATUS[task.status] || "待确认"}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{task.recipients.length} 个客户 · 主叫 {task.callerNumber} · {new Date(task.startTime).toLocaleString("zh-CN")}</p>{task.syncedAt && <p className="mt-1 text-xs text-muted-foreground">上次同步：{new Date(task.syncedAt).toLocaleString("zh-CN")}</p>}</div><div className="flex flex-wrap gap-2">
    {task.status === "DRAFT" && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ type: "publish" })}><Upload className="size-3" />{task.provider === "aiccs" ? "核验启动条件" : "准备任务"}</Button>}
    {["UPLOADED", "PREPARED"].includes(task.status) && <Button size="sm" disabled={action.isPending || !config.data?.liveEnabled} onClick={() => { setConfirmation(false); setConfirm(true); }}><PhoneCall className="size-3" />确认启动</Button>}
    {task.remoteId && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ type: "sync" })}><RefreshCw className="size-3" />同步结果</Button>}
    {task.remoteId && ["SUBMITTED", "RUNNING", "NEEDS_REVIEW"].includes(task.status) && <Button size="sm" variant="destructive" disabled={action.isPending} onClick={() => action.mutate({ type: "stop" })}>停止任务</Button>}
    <Button size="sm" variant="ghost" onClick={() => setExpanded(v => !v)}>{expanded ? "收起" : "详情与结果"}</Button></div></div>
    {task.errorMessage && <div className="px-4 pb-4"><Notice>{task.errorMessage}</Notice></div>}
    {["UPLOADED", "PREPARED"].includes(task.status) && !config.data?.liveEnabled && <p className="px-4 pb-4 text-xs text-muted-foreground">外呼暂未启用，请联系管理员。</p>}
    {expanded && <div className="border-t p-4 space-y-4"><p className="text-xs text-muted-foreground">结束时间：{new Date(task.endTime).toLocaleString("zh-CN")}</p>
      {["NEEDS_REVIEW", "UPLOADING", "SUBMITTING"].includes(task.status) && <p className="text-xs text-muted-foreground">任务状态待核对，请联系管理员；核对前请勿重复创建。</p>}
      <Button size="sm" variant="outline" onClick={() => { const results = new Map(task.results.map(r => [r.phoneNumber, r])); downloadExcelMatrix(`外呼结果-${task.name}.xlsx`, ["公司名称", "联系电话", "通话结果", "通话时长（秒）"], task.recipients.map(r => { const result = results.get(r.phoneNumber); return [r.name, r.phoneNumber, result ? STATUS[result.status] || "待确认" : "待同步", result?.talkTime ?? ""]; }), "本任务全部客户及当前已同步的通话结果。"); }}><Download className="size-3" />下载客户与结果</Button>
      {task.results.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="py-2 text-left">联系电话</th><th className="py-2 text-left">结果</th><th className="py-2 text-left">时长</th><th className="py-2 text-left">详情</th></tr></thead><tbody>{task.results.map((r, i) => <tr className="border-b" key={`${r.phoneNumber}-${i}`}><td className="py-2">{r.phoneNumber}</td><td>{STATUS[r.status] || "待确认"}</td><td>{r.talkTime ?? 0} 秒</td><td>{r.sessionId ? <Button size="sm" variant="ghost" disabled={call.isPending} onClick={() => call.mutate(r.sessionId!)}>对话 / 录音</Button> : "无通话详情"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">暂无通话结果。任务执行后可同步结果。</p>}
    </div>}
    <Dialog open={confirmOpen} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>确认向 {task.recipients.length} 位客户发起外呼</DialogTitle><DialogDescription>将按执行时间拨号，使用已发布话术，并产生通信费用。</DialogDescription></DialogHeader><div className="space-y-4"><p className="text-sm">任务：{task.name}<br />主叫：{task.callerNumber}<br />拨打规则：{policyText(task.executionPolicy, task.provider)}{task.provider === "aiccs" && <><br />任务并发：{task.executionPolicy?.concurrency || 1} 路</>}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmation} onChange={e => setConfirmation(e.target.checked)} className="mt-1" />我已核对客户名单和电话话术，并确认启动此任务。</label><Button disabled={!confirmation || action.isPending} onClick={() => action.mutate({ type: "start", input: { confirmation: task.id } })}>{action.isPending ? "提交中…" : "确认开始真实外呼"}</Button></div></DialogContent></Dialog>
    <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>通话详情 · {detail?.phoneNumber}</DialogTitle><DialogDescription>查看通话对话和录音；录音链接可能有时效。</DialogDescription></DialogHeader>{detail && <div className="space-y-4"><p className="text-sm">时长 {detail.duration ?? 0} 秒{detail.transferTarget ? ` · 转接目标 ${detail.transferTarget}` : ""}</p>{detail.recordingUrl ? <audio controls src={detail.recordingUrl} className="w-full" /> : <p className="text-sm text-muted-foreground">{detail.recordingUnavailable ? "录音暂不可用，请联系管理员。" : "此通话没有录音。"}</p>}{detail.transcripts.length ? detail.transcripts.map((t, i) => <div key={i} className="border p-3 space-y-2 text-sm"><p><strong>{t.speaker}：</strong>{t.text}</p></div>) : <p className="text-sm text-muted-foreground">暂无转写内容。</p>}{detail.labels.length > 0 && <p className="text-xs">{detail.labels.map(l => `${l.name}：${l.value}`).join("；")}</p>}</div>}</DialogContent></Dialog>
  </article>;
}
export function TaskCenter() {
  const tasks = useAliyunTasks();const {org,user}=useAliyunIdentity();
  return <div className="space-y-5"><TaskForm key={org+":"+user} /><section className="space-y-3"><div className="flex justify-between items-center"><h2 className="font-semibold">任务记录</h2></div>{tasks.isLoading ? <p>加载任务中…</p> : tasks.error ? <Notice>{tasks.error.message}</Notice> : tasks.data?.length ? tasks.data.map(t => <TaskRow key={t.id} task={t} />) : <div className="border p-6 text-sm text-muted-foreground">还没有外呼任务，可在上方创建第一份草稿。</div>}</section></div>;
}
