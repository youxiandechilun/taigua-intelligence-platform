/*
 * 中文导读：线路与语音外呼的 QuickOutboundForm 组件，封装该界面的展示与交互。
 */
'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronDown, Clock3, Download, List, PhoneCall, Search, Settings2, Upload, X } from 'lucide-react';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { useAgents } from '@/src/hooks/queries/agents';
import { useLocalRecipients } from '@/src/hooks/use-browser-compute';
import { apiClient, unwrap } from '@/src/lib/api/client';
import type { Recipient } from '@/src/lib/api/resources/aliyun';
import {TaskRetryFields,validRetryPolicy} from './TaskRetryFields';
import { telephonyApi } from '@/src/lib/api/resources/telephony';
import { useOutboundParallelismPolicy } from '@/src/lib/api/resources/outbound-parallelism';
import { importRecipients } from '@/src/lib/browser-compute/import-recipients';
import { mergeRecipientLists, removeRecipientFromText } from '@/src/lib/outbound/recipient-input';
import { createAndStartQuickOutbound, defaultProvinceLine, quickOutboundName, quickOutboundSchedule, type QuickOutboundPhase, type QuickOutboundSubmissionResult } from '@/src/lib/outbound/quick-outbound';
import { OUTBOUND_TEMPLATE_FILENAME, OUTBOUND_TEMPLATE_PATH } from '@/src/lib/outbound/import-template';
import { dialProviderName, dialProvinceName, selectedDialLine, type DialSelection } from '@/src/lib/outbound/dialing-lines';
import { CrmRecipientPicker } from '@/src/components/crm/CrmRecipientPicker';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { NativeSelect } from '@/src/components/ui/native-select';
import { Textarea } from '@/src/components/ui/textarea';
import { toast } from '@/src/lib/toast';
import { OutboundMultiplier } from './OutboundMultiplier';
import { PersonalVoiceSettings } from './PersonalVoiceSettings';
import { useDialingLines } from './DialingLineSelect';
import { OutboundAgentSelect } from './OutboundAgentSelect';

const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const localPreview = process.env.NEXT_PUBLIC_LOCAL_PREVIEW === 'true';

type OutboundDisplay = { name: string; count: number; agent: string; province: string; line: string; parallelism: number };
type OutboundResult = QuickOutboundSubmissionResult & OutboundDisplay;
type SubmissionHint = OutboundDisplay & { requestId: string };
const phaseLabels: Record<QuickOutboundPhase, string> = { creating: '保存任务中…', starting: '启动任务中…', recovering: '查询提交结果中…' };

export function QuickOutboundForm({ initialAgentId = '', onCreated, onView }: {
  initialAgentId?: string;
  onCreated: () => void;
  onView: (id: string) => void;
}) {
  const { org, user } = useAliyunIdentity();
  const { query: parallelismPolicy } = useOutboundParallelismPolicy();
  const maxParallelism = parallelismPolicy.data?.maxParallelism ?? 3;
  const agents = useAgents(), lines = useDialingLines();
  const [parallelism,setParallelism]=useState(1);
  const [retryPolicy,setRetryPolicy]=useState({retries:0,retryIntervalMinutes:30});
  const [agentId, setAgentId] = useState(initialAgentId);
  const [selection, setSelection] = useState<DialSelection>({ provider: 'HAOKEHU_SIP', province: '', lineId: '' });
  const effectiveRetry=selection.provider==='HAOKEHU_SIP'?retryPolicy:{...retryPolicy,retries:0};
  const [numberText, setNumberText] = useState('');
  const [numberView, setNumberView] = useState<'input' | 'list'>('input');
  const [imported, setImported] = useState<Recipient[]>([]);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [importDuplicates, setImportDuplicates] = useState(0);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [templateHint, setTemplateHint] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [timing, setTiming] = useState<'now' | 'scheduled'>('now');
  const [start, setStart] = useState(() => localDate(new Date(Date.now() + 3600000)));
  const [end, setEnd] = useState(() => localDate(new Date(Date.now() + 86400000)));
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceDirty, setVoiceDirty] = useState(false);
  const [result, setResult] = useState<OutboundResult | null>(null);
  const [phase, setPhase] = useState<QuickOutboundPhase>('creating');
  const [recovery, setRecovery] = useState<SubmissionHint | null>(null);
  const recoveryKey = user && org ? `outbound-submission:v1:${user}:${org}` : '';
  const fileInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const submission = useRef<{ fingerprint: string; requestId: string; name: string; startTime: string; endTime: string } | null>(null);
  const parsed = useLocalRecipients(numberText);
  const merged = useMemo(() => mergeRecipientLists(imported, parsed.recipients), [imported, parsed.recipients]);
  const recipients = merged.recipients;
  const duplicates = importDuplicates + parsed.duplicates + merged.duplicates;
  const issues = [...importIssues, ...parsed.issues];
  const selected = selectedDialLine(lines.data, selection);
  const provinces = [...new Set(lines.data.flatMap(line => line.provinces))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const provinceLines = lines.data.filter(line => line.provinces.includes(selection.province));
  const availableAgents = agents.data?.filter(agent => agent.isActive && agent.release?.usable) ?? [];
  const chosenAgent = availableAgents.find(agent => agent.agentId === agentId);

  useEffect(() => {
    setRecovery(null); setResult(null); submission.current = null;
    if (!recoveryKey || localPreview) return;
    try {
      const hint: unknown = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
      if (!hint || typeof hint !== 'object' || !('requestId' in hint) || typeof hint.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(hint.requestId)) return;
      const saved = hint as SubmissionHint;
      setRecovery(saved);
      setResult({ ...saved, id: saved.requestId, status: 'UNKNOWN', unresolved: true, startError: '上次提交的结果尚未返回，请查询同一任务的提交结果。' });
    } catch { /* Browser storage can be unavailable; the current submission still keeps its ID. */ }
  }, [recoveryKey]);

  function rememberSubmission(hint: SubmissionHint) {
    setRecovery(hint);
    try { if (recoveryKey) sessionStorage.setItem(recoveryKey, JSON.stringify(hint)); } catch { /* Keep the in-memory recovery record. */ }
  }
  function forgetSubmission() {
    setRecovery(null);
    try { if (recoveryKey) sessionStorage.removeItem(recoveryKey); } catch { /* No persistent record was available. */ }
  }
  const taskStatus = async (id: string, signal: AbortSignal) => {
    const task = (await telephonyApi.tasks(org, 'mine', { signal, timeout: 12000 })).find(row => row.id === id);
    return task ? { id: task.id, status: task.status, ...task.carrierSummary } : undefined;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (recovery) return {
        ...recovery,
        ...await createAndStartQuickOutbound({ requestId: recovery.requestId, recoverOnly: true,
          create: async () => { throw new Error('请查询已提交的任务'); },
          start: async () => { throw new Error('请在任务详情中启动'); },
          status: taskStatus, onPhase: setPhase,
        }),
      };
      if (importing || parsed.pending) throw new Error('正在整理号码，请稍候');
      if (!recipients.length || !chosenAgent) throw new Error('请添加号码并选择数字员工');
      if (issues.length || parsed.error) throw new Error('请修改无效号码，或明确选择忽略无效号码');
      if (recipients.length > 2000) throw new Error('每次最多 2000 个号码，请分批导入');
      if (!selected || lines.isError || !selected.ready || !selected.enabled) throw new Error('请选择当前可用的线路省份');
      if (!parallelismPolicy.data || !Number.isSafeInteger(parallelism)||parallelism<1||parallelism>maxParallelism) throw new Error(`请在读取设置后选择 1—${maxParallelism} 倍外呼`);
      if (!validRetryPolicy(effectiveRetry))throw new Error('请设置有效重拨次数和间隔（1–720分钟）');
      if (voiceDirty) throw new Error('请先保存通话声音的修改');
      const fingerprint = JSON.stringify({ selection, agentId, parallelism, retryPolicy:effectiveRetry, recipients, taskName, timing, ...(timing === 'scheduled' ? { start, end } : {}) });
      if (submission.current?.fingerprint !== fingerprint) {
        const now = new Date();
        submission.current = { fingerprint, requestId: crypto.randomUUID(), name: quickOutboundName(taskName, now), ...quickOutboundSchedule(timing, start, end, now) };
      }
      const frozen = submission.current;
      const payload = {
        ...selection, agentId, parallelism, retryPolicy:effectiveRetry, recipients, name: frozen.name,
        startTime: frozen.startTime, endTime: frozen.endTime, requestId: frozen.requestId,
      };
      const display = { name: frozen.name, count: recipients.length, agent: chosenAgent.name, parallelism,
        province: dialProvinceName(selection.province), line: dialProviderName(selected.provider,selected.serviceProvider) + ' · ' + selected.name };
      if (!localPreview) rememberSubmission({ ...display, requestId: frozen.requestId });
      const saved: QuickOutboundSubmissionResult = localPreview
        ? { ...await unwrap<{ id: string }>(apiClient.post('/outbound-task-drafts', payload, { headers: { 'x-workspace-id': org }, timeout: 30000 })), status: 'DRAFT', startError: '', unresolved: false }
        : await createAndStartQuickOutbound({
          requestId: frozen.requestId,
          create: signal => telephonyApi.create(org, payload, { signal }),
          start: (id, signal) => telephonyApi.action(org, id, 'start', { confirmation: id }, { signal }),
          status: taskStatus, onPhase: setPhase,
        });
      return { ...saved, ...display };
    },
    onSuccess: data => {
      setResult(data); onCreated();
      if (localPreview) toast.success('本地外呼演示已就绪，未拨打电话');
      else if (data.unresolved) toast.error('提交结果暂未返回，请查询同一任务');
      else if (data.startError) toast.error('任务已保存，请查看启动反馈');
      else toast.success(data.acceptedCount === 0 ? '本次号码均已跳过，请查看原因' : timing === 'scheduled' ? '外呼任务已预约' : '外呼任务已创建');
      if (!data.unresolved && !localPreview) {
        forgetSubmission();
        setImported([]); setNumberText(''); setImportIssues([]); setImportDuplicates(0); setFileName(''); submission.current = null;
      }
    },
    onError: (error: Error) => { forgetSubmission(); toast.error(error.message); },
    retry: false,
  });
  const busy = importing || create.isPending || !!recovery;
  const canStart = recovery ? !importing && !create.isPending : validRetryPolicy(effectiveRetry)&&!!parallelismPolicy.data&&Number.isSafeInteger(parallelism)&&parallelism>=1&&parallelism<=maxParallelism&&!busy && !parsed.pending && !parsed.error && !issues.length && !voiceDirty
    && !!chosenAgent && !!selected?.ready && selected.enabled && !lines.isError && recipients.length > 0 && recipients.length <= 2000;

  function appendRecipients(rows: Recipient[], duplicateCount = 0) {
    const next = mergeRecipientLists(imported, rows);
    setImported(next.recipients);
    setImportDuplicates(current => current + duplicateCount + next.duplicates);
    if (next.recipients.length) setNumberView('list');
    setResult(null);
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy) return;
    setImporting(true);
    try {
      const data = await importRecipients(file, org);
      appendRecipients(data.recipients, data.duplicates);
      setImportIssues(previous => [...previous, ...data.invalidRows.map(row => `${file.name} 第 ${row.rowNumber} 行：${row.error}`)]);
      setFileName(file.name);
      toast.success(`已读取 ${data.recipients.length} 个有效号码`);
    } catch (error) { toast.error(error instanceof Error ? error.message : '文件读取失败，请使用 Excel 或 CSV'); }
    finally { setImporting(false); }
  }
  function clear() {
    setImported([]); setNumberText(''); setImportIssues([]); setImportDuplicates(0); setFileName(''); setResult(null);
    setNumberView('input');
  }

  return <section aria-label="快捷外呼" className="overflow-hidden rounded-xl border bg-card">
    <div className="border-b px-5 py-4">
      <h2 className="text-base font-semibold">开始外呼</h2>
      <p className="mt-1 text-sm text-muted-foreground">添加号码，选好数字员工和线路省份，即可开始。</p>
    </div>
    <form onSubmit={event => { event.preventDefault(); if (canStart && !submitLock.current) { submitLock.current = true; create.mutate(undefined, { onSettled: () => { submitLock.current = false; } }); } }}>
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 p-5 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">1</span>添加号码</h3>
            {(recipients.length > 0 || numberView === 'list') && <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setNumberView(current => current === 'input' ? 'list' : 'input')}>
              <List aria-hidden="true" className="size-3.5" />{numberView === 'input' ? `查看名单（${recipients.length}）` : '粘贴号码'}
            </Button>}
          </div>
          {numberView === 'input' ? <>
            <label className="sr-only" htmlFor="quick-outbound-numbers">粘贴客户号码</label>
            <Textarea id="quick-outbound-numbers" className="field-sizing-fixed h-52 min-h-52 max-h-52 resize-none overflow-y-auto overscroll-contain bg-background leading-7 tabular-nums" rows={6} value={numberText} disabled={busy} maxLength={120000} spellCheck={false} autoComplete="off" aria-invalid={parsed.issues.length > 0} aria-describedby="quick-number-help" placeholder={'在这里粘贴号码，每行一个\n也支持用逗号、空格分隔'} onChange={event => { setNumberText(event.target.value); setResult(null); }}/>
          </> : <div role="region" aria-label={`本次有效号码，共 ${recipients.length} 个`} tabIndex={0} className="h-52 min-h-52 max-h-52 overflow-y-auto overscroll-contain rounded-md border bg-background focus-visible:outline-2 focus-visible:outline-ring">
            {recipients.length ? <ul className="divide-y">{recipients.map(recipient => <li key={recipient.phoneNumber} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{recipient.name || '未填姓名'}</span>
              <span className="text-xs tabular-nums">{recipient.phoneNumber}</span>
              <Button type="button" size="icon-xs" variant="ghost" disabled={busy} aria-label={'移除号码' + recipient.phoneNumber} onClick={() => {
                setImported(previous => previous.filter(row => row.phoneNumber !== recipient.phoneNumber));
                setNumberText(previous => removeRecipientFromText(previous, recipient.phoneNumber));
                setResult(null);
              }}><X aria-hidden="true" className="size-3" /></Button>
            </li>)}</ul> : <p className="px-3 py-4 text-sm text-muted-foreground">名单已清空，可切换到粘贴号码或继续导入。</p>}
          </div>}
          {templateHint && <p role="status" className="text-xs text-muted-foreground">已请求下载，请在浏览器下载列表查看“{OUTBOUND_TEMPLATE_FILENAME}”。</p>}
          {fileName && <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Check aria-hidden="true" className="size-3.5 shrink-0 text-primary"/><span className="truncate">已导入 {fileName}</span></p>}
          {parsed.error && <p role="alert" className="text-sm text-destructive">{parsed.error}</p>}
          {issues.length > 0 && <div className="rounded-md border border-destructive/30 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-destructive">{issues.length} 个无效号码，修改后再开始</span><Button type="button" variant="outline" size="xs" disabled={busy || parsed.pending || !!parsed.error} onClick={() => { setImported(recipients); setNumberText(''); setImportIssues([]); setImportDuplicates(duplicates); setResult(null); }}>忽略无效号码</Button></div><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看原因</summary><ul className="mt-2 space-y-1 break-all">{issues.slice(0, 20).map((issue, index) => <li key={index}>{issue}</li>)}</ul>{issues.length > 20 && <p className="mt-2">另有 {issues.length - 20} 项</p>}</details></div>}
          {recipients.length > 2000 && <p role="alert" className="text-sm text-destructive">当前有 {recipients.length} 个号码，超过 2000 个，请分批导入。</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-xs">
            <button type="button" className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" disabled={busy} onClick={()=>fileInput.current?.click()}><Upload aria-hidden="true" className="size-3.5"/>{importing?'读取中…':'导入 Excel / CSV'}</button>
            <input ref={fileInput} type="file" className="sr-only" aria-label="导入外呼号码" accept=".xlsx,.csv" disabled={busy} onChange={importFile}/>
            <a className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring" href={OUTBOUND_TEMPLATE_PATH} download={OUTBOUND_TEMPLATE_FILENAME} onClick={()=>setTemplateHint(true)}><Download aria-hidden="true" className="size-3.5"/>下载模板</a>
            {(imported.length>0||numberText||issues.length>0)&&<button type="button" className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50" disabled={busy} onClick={clear}>清空名单</button>}
            <span id="quick-number-help" className="text-xs text-muted-foreground">手机或带区号座机，每次最多 2000 个号码</span>
          </div>
        </div>
        <div className="min-w-0 space-y-4 border-t p-5 lg:border-t-0">
          <h3 className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">2</span>选择员工与线路</h3>
          <OutboundAgentSelect agents={availableAgents} value={agentId} loading={agents.isPending} disabled={busy||agents.isPending||agents.isError||!availableAgents.length} onChange={value=>{setAgentId(value);setVoiceDirty(false);setResult(null);}}/>
          <OutboundMultiplier value={parallelism} onChange={value=>{setParallelism(value);setResult(null);}} disabled={busy} max={maxParallelism} ready={!!parallelismPolicy.data}/>
          {agents.error && <p role="alert" className="text-sm text-destructive">数字员工读取失败：{agents.error.message}<Button type="button" size="xs" variant="link" onClick={() => void agents.refetch()}>重试</Button></p>}
          {!agents.isPending && !agents.error && !availableAgents.length && <p role="status" className="text-xs text-muted-foreground">当前没有已发布且可使用的数字员工，请联系管理员。</p>}
          <label className="grid gap-2 text-sm">线路省份<NativeSelect aria-label="线路省份" required value={selection.province} disabled={busy || lines.isPending || lines.isError || !provinces.length} onChange={event => { const province = event.target.value; setSelection(defaultProvinceLine(lines.data, province) ?? { provider: 'HAOKEHU_SIP', province, lineId: '' }); setResult(null); }}><option value="">{lines.isPending ? '正在读取线路…' : '请选择线路省份'}</option>{provinces.map(province => <option key={province} value={province}>{dialProvinceName(province)}</option>)}</NativeSelect></label>
          {provinceLines.length > 1 && <label className="grid gap-2 text-sm">可用线路<NativeSelect aria-label="可用线路" required value={selected?.id ?? ''} disabled={busy || lines.isPending || lines.isError} onChange={event => { const line = provinceLines.find(line => line.id === event.target.value); if (line) setSelection({ provider: line.provider, province: selection.province, lineId: line.id }); setResult(null); }}><option value="">请选择线路</option>{provinceLines.map(line => <option key={line.id} value={line.id}>{dialProviderName(line.provider,line.serviceProvider)} · {line.name}{line.enabled && line.ready ? '' : '（暂不可用）'}</option>)}</NativeSelect></label>}
          {selected && <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground"><p>{dialProviderName(selected.provider,selected.serviceProvider)} · {selected.name}</p><p>主叫标识 <span className="ml-1 tabular-nums text-foreground">{selected.identifier}</span></p>{(!selected.enabled || !selected.ready) && <p role="alert" className="text-destructive">此线路暂不可用，请选择其他线路或联系管理员。</p>}</div>}
          {lines.error && <p role="alert" className="text-sm text-destructive">线路读取失败：{lines.error.message}<Button type="button" size="xs" variant="link" onClick={() => void lines.refetch()}>重试</Button></p>}
          {!lines.isPending && !lines.error && !provinces.length && <p role="status" className="text-xs text-muted-foreground">当前账号暂无可用线路，请联系管理员。</p>}
          {selection.province && !selected && !lines.isPending && !lines.error && <p role="alert" className="text-xs text-destructive">所选线路已变化，请重新选择省份。</p>}
        </div>
      </div>
      <details className="group border-t px-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><Settings2 aria-hidden="true" className="size-4"/>更多设置<ChevronDown aria-hidden="true" className="ml-auto size-4 group-open:rotate-180"/></summary>
        <div className="space-y-4 pb-5 pt-1">
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">任务名称<Input value={taskName} maxLength={100} disabled={busy} placeholder="自动按日期命名（选填）" onChange={event => { setTaskName(event.target.value); setResult(null); }}/></label><label className="grid gap-2 text-sm">执行时间<NativeSelect value={timing} disabled={busy} onChange={event => { setTiming(event.target.value as 'now' | 'scheduled'); setResult(null); }}><option value="now">立即开始</option><option value="scheduled">预约开始</option></NativeSelect></label></div>
          {timing === 'scheduled' ? <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">预约开始时间<Input required type="datetime-local" value={start} disabled={busy} onChange={event => { setStart(event.target.value); setResult(null); }}/></label><label className="grid gap-2 text-sm">任务结束时间<Input required type="datetime-local" min={start} value={end} disabled={busy} onChange={event => { setEnd(event.target.value); setResult(null); }}/></label></div> : <p className="text-xs text-muted-foreground">任务有效期为 24 小时，按数字员工与线路已设置的拨打时段执行。</p>}
          {selection.provider==='HAOKEHU_SIP'&&<TaskRetryFields value={retryPolicy} onChange={value=>{setRetryPolicy(value);setResult(null);}} disabled={busy}/>}
          <div className="flex flex-wrap items-center gap-3"><CrmRecipientPicker workspaceId={org} userId={user} disabled={busy} onSelect={rows => appendRecipients(rows)}/><span className="text-xs text-muted-foreground">也可以补充已有客户号码</span></div>
          <details onToggle={event => setVoiceOpen(event.currentTarget.open)}><summary className="cursor-pointer py-1 text-sm">通话声音</summary><div className="pt-3">{agentId ? voiceOpen && <PersonalVoiceSettings key={user + org + agentId + selection.provider} agentId={agentId} provider={selection.provider} compact onDirtyChange={setVoiceDirty}/> : <p className="text-xs text-muted-foreground">先选择数字员工，再调整个人通话声音。</p>}</div></details>
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-5 py-4">
        <div className="min-w-0"><p role="status" aria-live="polite" className="text-sm">{parsed.pending ? '正在整理号码…' : <><strong className="font-semibold text-primary tabular-nums">{recipients.length}</strong> 个有效号码{duplicates > 0 && <span className="ml-3 text-xs text-muted-foreground">已去重 {duplicates} 个</span>}{issues.length > 0 && <span className="ml-3 text-xs text-destructive">无效 {issues.length} 个</span>}</>}</p><p className="mt-1 text-xs text-muted-foreground">{localPreview ? '本地预览仅演示，不会拨打真实电话。' : '开始后按所选线路与拨打规则执行，可在任务详情中暂停。'}</p>{voiceDirty && <p role="status" className="mt-1 text-xs text-amber-700">请先在更多设置中保存通话声音修改。</p>}</div>
        <Button type="submit" className="h-10 gap-2 px-6" disabled={!canStart}>{recovery ? <Search aria-hidden="true" className="size-4"/> : <PhoneCall aria-hidden="true" className="size-4"/>}{create.isPending ? phaseLabels[phase] : recovery ? '查询提交结果' : '开始外呼'}</Button>
      </div>
    </form>
    {result && <div role="status" aria-label={localPreview ? '本地外呼演示结果' : '外呼创建结果'} className="flex flex-wrap items-center justify-between gap-3 border-t bg-primary/5 px-5 py-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">{result.unresolved ? <Clock3 aria-hidden="true" className="size-4 text-amber-600"/> : <Check aria-hidden="true" className="size-4 text-primary"/>}{localPreview ? '本地外呼演示已就绪' : result.unresolved ? '提交结果暂未返回' : result.startError ? '任务已保存，尚未启动' : result.acceptedCount === 0 ? '号码均已跳过' : '外呼任务已创建'}</p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{result.count} 个号码 · {result.agent} ×{result.parallelism} · {result.province} · {result.line}</p>
        {result.acceptedCount !== undefined && <p className="mt-1 text-xs leading-5">本次检查 {result.totalCount ?? result.count} 个，可拨 <strong className="font-medium text-primary tabular-nums">{result.acceptedCount}</strong> 个，跳过 <strong className="font-medium tabular-nums">{result.skippedCount ?? 0}</strong> 个。</p>}
        {!!result.skipReasons?.length && <details className="mt-1 text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer">查看跳过原因</summary><ul className="mt-1 space-y-1">{result.skipReasons.map(item => <li key={item.reason}>{item.reason}：{item.count} 个</li>)}</ul></details>}
        <p className={'text-xs leading-5 ' + (result.startError ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{localPreview ? '已保留本地演示草稿，未真实拨号。' : result.startError || '请在任务详情中查看拨打进度或暂停任务。'}</p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => onView(result.id)}>{localPreview ? '查看演示任务' : '查看任务'}</Button>
    </div>}
  </section>;
}
