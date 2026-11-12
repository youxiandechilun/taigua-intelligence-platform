/*
 * 中文导读：客户跟进详情与操作面板。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Building2, Clock3, History, Loader2, LockKeyhole, MessageCircle, Phone, RefreshCw, Save, Sparkles, UserRound, UsersRound } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/src/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { NativeSelect } from "@/src/components/ui/native-select";
import { Switch } from "@/src/components/ui/switch";
import { EmployeePicker } from "@/src/components/common/EmployeePicker";
import { useCustomerReadState, useFollowupIdentity } from "@/src/hooks/use-customer-followup";
import { followupRequest, followupDate, intentLabels, wechatLabels, isTemporaryCustomer, type CustomerRecord, type FollowupCall, type WechatStage } from "@/src/lib/customer-followup";
import { toast } from "@/src/lib/toast";

function CustomerRecording({ call }: { call: FollowupCall }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState(false);
  return <section className="space-y-3 rounded-lg border bg-background p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2 font-medium"><Phone aria-hidden="true" className="size-3.5 text-muted-foreground" />{followupDate(call.at)}</span>
      <span className="text-muted-foreground">{intentLabels[call.intent]}{call.duration !== null ? ` · ${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, "0")}` : ""}</span>
    </div>
    {call.audio ? <>
      <div className="flex items-center gap-2"><audio ref={audio} src={call.audio} controls preload="none" onError={() => setError(true)} className="h-10 min-w-0 flex-1" aria-label="通话录音" /><NativeSelect aria-label="录音播放速度" defaultValue="1" onChange={event => { if (audio.current) audio.current.playbackRate = Number(event.target.value); }}>{[0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}倍</option>)}</NativeSelect></div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"><span>录音暂未加载</span><Button type="button" size="sm" variant="outline" onClick={() => { setError(false); audio.current?.load(); }}><RefreshCw aria-hidden="true" className="size-3.5" />重新加载</Button></div>}
    </> : <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">暂无可播放录音</p>}
    {call.summary && <p className="break-words text-sm leading-6">{call.summary}</p>}
    {call.transcriptError && <p role="status" className="text-sm text-muted-foreground">对话文字暂未完整读取，请重新打开查看。</p>}
    {!!call.transcript.length && <details className="rounded-md bg-muted/40 p-3"><summary className="cursor-pointer text-sm font-medium">对话记录（{call.transcript.length}条）</summary><div className="mt-3 max-h-72 space-y-3 overflow-auto overscroll-contain">{call.transcript.map((line, index) => <p key={index} className="break-words text-sm leading-6"><span className="mr-2 text-muted-foreground">{line.speaker}</span>{line.text}</p>)}</div></details>}
  </section>;
}

function Editor({ customer, staff, canAssign, onClose }: { customer: CustomerRecord; staff: { id: string; name: string }[]; canAssign: boolean; onClose(): void }) {
  const { workspace, user } = useFollowupIdentity();
  const client = useQueryClient();
  const lock = useRef(false);
  const [name, setName] = useState(customer.name), [company, setCompany] = useState(customer.company), [wechatId, setWechatId] = useState(customer.wechatId);
  const [stage, setStage] = useState<WechatStage>(customer.stage), [consent, setConsent] = useState(customer.wechatConsent);
  const [owner, setOwner] = useState(customer.ownerId || ""), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [section, setSection] = useState("profile");
  const temporary = isTemporaryCustomer(customer), readOnly = temporary || customer.readOnly;
  const dirty = name !== customer.name || company !== customer.company || wechatId !== customer.wechatId || stage !== customer.stage || consent !== customer.wechatConsent || owner !== (customer.ownerId || "");
  const calls = useQuery({ queryKey: ["customer-followup", workspace, user, "recordings", customer.id], queryFn: () => followupRequest<{ calls: FollowupCall[]; more: boolean }>(workspace, `/customers/${customer.id}/calls`), enabled: section === "recordings", retry: false, staleTime: 60000, refetchOnWindowFocus: false });
  async function save() {
    if (readOnly || lock.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      await followupRequest(workspace, `/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ version: customer.version, name, company, wechatId, stage, wechatConsent: consent, ...(owner && owner !== customer.ownerId ? { ownerId: owner } : {}) }) });
      toast.success(process.env.NEXT_PUBLIC_LOCAL_PREVIEW === "true" ? "客户资料已保存到本地" : "客户资料已保存");
      await client.invalidateQueries({ queryKey: ["customer-followup", workspace, user] });
      if (owner !== customer.ownerId && owner !== user && !canAssign) onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "保存未完成，请重试。"); }
    finally { lock.current = false; setSaving(false); }
  }
  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save(); }}>
    {temporary && <div role="status" className="shrink-0 border-b bg-primary/[.035] px-5 py-3 text-sm sm:px-6"><p className="font-medium">通话中命中关键词，待确认</p><p className="mt-1 text-xs text-muted-foreground">当前仅查看，确认后可编辑资料与跟进。资料会自动刷新。</p></div>}
    <Tabs value={section} onValueChange={setSection} className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-b px-5 py-3 sm:px-6">
        <TabsList aria-label="客户详情栏目" className="grid h-10! w-full grid-cols-3 gap-1">
          <TabsTrigger value="profile" className="gap-1.5 px-1.5 text-xs sm:text-sm"><UserRound aria-hidden="true" className="size-3.5" />客户资料</TabsTrigger>
          <TabsTrigger value="recordings" className="gap-1.5 px-1.5 text-xs sm:text-sm"><AudioLines aria-hidden="true" className="size-3.5" />通话录音<span className="rounded bg-foreground/5 px-1.5 text-xs tabular-nums">{customer.callCount}</span></TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 px-1.5 text-xs sm:text-sm"><History aria-hidden="true" className="size-3.5" />操作记录</TabsTrigger>
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        <TabsContent forceMount value="profile" className="m-0 space-y-6 data-[state=inactive]:hidden">
          <section className="space-y-3 rounded-lg border border-primary/10 bg-primary/[.035] p-4" aria-label="客户意向摘要">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><Sparkles aria-hidden="true" className="size-4 text-primary" strokeWidth={1.75} />意向摘要</h3><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${customer.intent === "interested" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><span aria-hidden="true" className="size-1 rounded-full bg-current" />{temporary ? "通话中待确认" : intentLabels[customer.intent]}{customer.demo ? " · 演示" : ""}</span></div>
            <p className="break-words text-sm leading-6">{customer.evidence || customer.summary || "暂未生成意向摘要，可在通话录音中查看沟通内容。"}</p>
          </section>
          <fieldset disabled={saving || readOnly} className="min-w-0 space-y-4">
            <legend className="mb-4 flex items-center gap-2 text-sm font-semibold"><UserRound aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />基本资料</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid min-w-0 gap-2 text-sm"><span>客户姓名</span><Input name="customerName" autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="客户姓名（选填）" maxLength={200} /></label>
              <label className="grid min-w-0 gap-2 text-sm"><span className="flex items-center gap-1.5"><Building2 aria-hidden="true" className="size-3.5 text-muted-foreground" />公司 / 门店</span><Input name="company" autoComplete="off" value={company} onChange={e => setCompany(e.target.value)} placeholder="公司或门店名称（选填）" maxLength={200} /></label>
            </div>
            {canAssign && !readOnly ? <div className="grid min-w-0 gap-2 text-sm"><label htmlFor="customer-owner" className="flex items-center gap-1.5"><UsersRound aria-hidden="true" className="size-3.5 text-muted-foreground" />客户负责人</label><EmployeePicker id="customer-owner" value={owner} onChange={setOwner} employees={staff} currentName={owner === customer.ownerId ? customer.ownerName : undefined} disabled={saving || readOnly} /></div> : <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5 text-sm"><span className="text-muted-foreground">客户负责人</span><span>{customer.ownerName}</span></div>}
          </fieldset>
          <fieldset disabled={saving || readOnly} className="min-w-0 space-y-4 border-t pt-5">
            <legend className="float-left mb-4 flex w-full items-center gap-2 text-sm font-semibold"><MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={1.75} />微信联系</legend>
            <div className="clear-both flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-3.5 py-3"><label htmlFor={`wechat-consent-${customer.id}`} className="flex-1 cursor-pointer text-sm">客户已同意加微信</label><Switch id={`wechat-consent-${customer.id}`} checked={consent} disabled={saving || readOnly || customer.intent !== "interested"} onCheckedChange={setConsent} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid min-w-0 gap-2 text-sm"><span>微信进度</span>{temporary ? <span className="flex min-h-9 items-center rounded-md border px-3 text-muted-foreground">通话中</span> : <NativeSelect name="stage" value={stage} onChange={e => setStage(e.target.value as WechatStage)}>{Object.entries(wechatLabels).map(([key, label]) => <option key={key} value={key} disabled={customer.intent !== "interested" && key !== "closed"}>{label}</option>)}</NativeSelect>}</label>
              <label className="grid min-w-0 gap-2 text-sm"><span>微信号</span><Input name="wechatId" autoComplete="off" spellCheck={false} value={wechatId} onChange={e => setWechatId(e.target.value)} placeholder="客户微信号（选填）" maxLength={200} /></label>
            </div>
          </fieldset>
        </TabsContent>
        <TabsContent value="recordings" className="m-0 space-y-4">
          {calls.isLoading ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />正在读取通话…</div> : calls.isError ? <div role="alert" className="space-y-3 rounded-lg border p-4"><p>{calls.error.message}</p><Button type="button" variant="outline" onClick={() => void calls.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div> : calls.data?.calls.length ? <>{calls.data.calls.map(call => <CustomerRecording key={call.id} call={call} />)}{calls.data.more && <p className="text-sm text-muted-foreground">当前显示最近20次通话，完整历史可在通话记录中查看。</p>}</> : <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground"><AudioLines aria-hidden="true" className="size-7" strokeWidth={1.5} /><p>暂无关联通话</p></div>}
        </TabsContent>
        <TabsContent value="history" className="m-0">
          {customer.history.length ? <ol className="ml-1 border-l">{[...customer.history].reverse().map((item, index) => <li key={index} className="relative pb-6 pl-5 last:pb-0"><span aria-hidden="true" className="absolute -left-1 top-1.5 size-2 rounded-full border border-background bg-primary/60" /><div className="flex flex-wrap justify-between gap-2 text-sm"><strong className="font-medium">{item.title}</strong><time className="text-muted-foreground">{followupDate(item.at)}</time></div><p className="mt-1 text-sm text-muted-foreground">{item.actor}</p>{item.note && <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6">{item.note}</p>}</li>)}</ol> : <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground"><Clock3 aria-hidden="true" className="size-7" strokeWidth={1.5} /><p>暂无操作记录</p></div>}
        </TabsContent>
      </div>
    </Tabs>
    <footer className="shrink-0 border-t bg-background px-5 py-4 sm:px-6">
      {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive"><span>{error}</span><Button type="button" variant="outline" size="sm" onClick={() => void client.invalidateQueries({ queryKey: ["customer-followup", workspace, user, "detail", customer.id] })}><RefreshCw aria-hidden="true" className="size-3.5" />重新读取</Button></div>}
      <div className="flex items-center justify-between gap-3"><span aria-live="polite" className="text-xs text-muted-foreground">{temporary ? "当前仅查看，确认后可跟进" : dirty ? "有未保存的修改" : ""}</span><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>关闭</Button>{!readOnly && (section === "profile" || dirty) && <Button type="submit" className="min-w-28" disabled={saving}>{saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}{saving ? "保存中…" : "保存修改"}</Button>}</div></div>
    </footer>
  </form>;
}

export default function CustomerFollowupSheet({ customerId, onClose, staff = [], canAssign = false }: { customerId: string; onClose(): void; staff?: { id: string; name: string }[]; canAssign?: boolean }) {
  const { workspace, user } = useFollowupIdentity();
  const identity = `${workspace}:${user}`; const initial = useRef(identity);
  useEffect(() => { if (identity !== initial.current) onClose(); }, [identity, onClose]);
  const query = useQuery({ queryKey: ["customer-followup", workspace, user, "detail", customerId], queryFn: () => followupRequest<{ customer: CustomerRecord }>(workspace, `/customers/${customerId}`), enabled: !!workspace && !!user, retry: false, refetchOnWindowFocus: false, refetchInterval: current => current.state.data && isTemporaryCustomer(current.state.data.customer) ? 15000 : false, staleTime: 0 });
  const reading = useCustomerReadState();
  const markedRevision = useRef<string | null>(null);
  const customer = query.data?.customer;
  const { mutate: markRead } = reading;
  useEffect(() => {
    if (query.isFetching || !query.isSuccess || !customer || customer.readOnly || customer.readAt !== null || !customer.readRevision || markedRevision.current === customer.readRevision) return;
    markedRevision.current = customer.readRevision;
    markRead({ customerId: customer.id, read: true, revision: customer.readRevision });
  }, [query.isFetching, query.isSuccess, customer?.id, customer?.readAt, customer?.readRevision, customer?.readOnly, markRead]);
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="!w-full !max-w-2xl gap-0" aria-describedby="customer-followup-description">
    <SheetHeader className="border-b px-5 py-5 pr-14 sm:px-6 sm:pr-14"><SheetTitle className="flex items-center gap-3 text-xl"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/5"><Phone className="size-4 text-primary" strokeWidth={1.75} /></span><span className="truncate tabular-nums">{query.data?.customer.phone || "客户详情"}</span></SheetTitle><SheetDescription id="customer-followup-description" className="pl-12">{query.data?.customer.name || "姓名待补充"}</SheetDescription></SheetHeader>
    {reading.isError && customer && <div role="alert" className="flex items-center justify-between gap-3 border-b px-5 py-3 text-sm text-destructive"><span>阅读状态未保存：{reading.error.message}</span><Button size="sm" variant="outline" disabled={reading.isPending} onClick={() => markRead({ customerId: customer.id, read: true, revision: customer.readRevision })}>重试保存</Button></div>}
    {query.isLoading ? <div role="status" className="flex items-center justify-center gap-2 p-10 text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />正在读取客户…</div> : query.isError ? <div className="space-y-4 p-5" role="alert"><LockKeyhole aria-hidden="true" className="size-5 text-muted-foreground" /><p>{query.error.message}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新读取</Button></div> : query.data && <Editor key={`${query.data.customer.id}:${isTemporaryCustomer(query.data.customer) ? "provisional" : "confirmed"}:${query.data.customer.version}`} customer={query.data.customer} staff={staff} canAssign={canAssign} onClose={onClose} />}
  </SheetContent></Sheet>;
}
