/*
 * 中文导读：线路与语音外呼的 TestNumberWhitelistPanel 组件，封装该界面的展示与交互。
 */
"use client";

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil, Plus, Power, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { useCompanyContext } from '@/src/lib/api/resources/company';
import { testNumberWhitelistApi, testNumberWhitelistKey, type TestNumberWhitelistEntry, type TestNumberWhitelistInput } from '@/src/lib/api/resources/test-number-whitelist';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { toast } from '@/src/lib/toast';

type Editor = { kind: 'new' } | { kind: 'edit' | 'remove'; item: TestNumberWhitelistEntry };
type Change = { kind: 'create'; input: TestNumberWhitelistInput }
  | { kind: 'update'; item: TestNumberWhitelistEntry; input: TestNumberWhitelistInput }
  | { kind: 'remove'; item: TestNumberWhitelistEntry };

function NumberEditor({ item, saving, canSave, blockedMessage, error, onSave, onClose }: {
  item?: TestNumberWhitelistEntry;
  saving: boolean;
  canSave: boolean;
  blockedMessage: string;
  error: string;
  onSave: (input: TestNumberWhitelistInput) => void;
  onClose: () => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState(item?.phoneNumber ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saving && canSave && phoneNumber.trim()) onSave({ phoneNumber: phoneNumber.trim(), note: note.trim(), enabled });
  }

  return <form className="space-y-4" onSubmit={submit}>
    <div className="space-y-2"><label htmlFor="test-whitelist-number" className="text-sm font-medium">测试号码</label><Input id="test-whitelist-number" type="tel" inputMode="tel" autoComplete="off" required maxLength={32} value={phoneNumber} disabled={saving} aria-describedby="test-whitelist-number-help" onChange={event => setPhoneNumber(event.target.value)} placeholder="输入中国手机号或带区号的座机" /><p id="test-whitelist-number-help" className="text-xs leading-5 text-muted-foreground">支持中国手机号及带区号的座机，可使用 +86 或 0086 前缀；保存后显示统一号码格式。</p></div>
    <div className="space-y-2"><label htmlFor="test-whitelist-note" className="text-sm font-medium">备注 <span className="font-normal text-muted-foreground">（选填）</span></label><Input id="test-whitelist-note" maxLength={200} value={note} disabled={saving} onChange={event => setNote(event.target.value)} placeholder="例如：演示手机、内部测试" /></div>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={enabled} disabled={saving} onChange={event => setEnabled(event.target.checked)} />启用此测试号码</label>
    {!canSave && !saving && <p role="status" className="text-xs leading-5 text-muted-foreground">{blockedMessage}</p>}
    {error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button><Button type="submit" disabled={saving || !canSave || !phoneNumber.trim()}>{saving ? '保存中…' : '保存号码'}</Button></DialogFooter>
  </form>;
}

function WhitelistManager({ org, user }: { org: string; user: string }) {
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const queryKey = testNumberWhitelistKey(user, org);
  const query = useQuery({ queryKey, queryFn: () => testNumberWhitelistApi.get(org), enabled: Boolean(org && user), staleTime: 15000, retry: false });
  const mutation = useMutation({
    retry: false,
    mutationFn: (change: Change) => change.kind === 'create'
      ? testNumberWhitelistApi.create(org, change.input)
      : change.kind === 'remove'
        ? testNumberWhitelistApi.remove(org, change.item.id, change.item.updatedAt)
        : testNumberWhitelistApi.update(org, change.item.id, { ...change.input, expectedUpdatedAt: change.item.updatedAt }),
    onSuccess: catalog => { client.setQueryData(queryKey, catalog); },
  });
  const data = query.data;
  const canManage = data?.canManage === true;
  const busy = mutation.isPending;
  const canAct = canManage && !busy && !query.isFetching && !query.error;
  const blockedMessage = query.isFetching ? '正在刷新配置，请稍候。' : '请关闭窗口并刷新列表后重试。';
  const atLimit = Boolean(data && data.items.length >= data.maxEntries);
  const openEditor = (next: Editor) => { setDialogError(''); setEditor(next); };
  const closeEditor = () => { if (!busy) { setEditor(null); setDialogError(''); } };

  async function save(input: TestNumberWhitelistInput) {
    if (!editor || !canAct || editor.kind === 'remove') return;
    setDialogError('');
    try {
      await mutation.mutateAsync(editor.kind === 'new' ? { kind: 'create', input } : { kind: 'update', item: editor.item, input });
      setEditor(null);
      setFeedback('测试号码已保存。');
      toast.success('测试号码已保存');
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : '保存失败，请重试；如配置已变化，请关闭后刷新列表。'); }
  }

  async function toggle(item: TestNumberWhitelistEntry) {
    if (!canAct) return;
    setActionError(''); setFeedback('');
    try {
      await mutation.mutateAsync({ kind: 'update', item, input: { phoneNumber: item.phoneNumber, note: item.note, enabled: !item.enabled } });
      setFeedback(`${item.phoneNumber} 已${item.enabled ? '停用' : '启用'}。`);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '状态修改失败，请刷新列表后重试。'); }
  }

  async function remove() {
    if (editor?.kind !== 'remove' || !canAct) return;
    setDialogError('');
    try {
      await mutation.mutateAsync({ kind: 'remove', item: editor.item });
      setEditor(null);
      setFeedback('测试号码已删除。');
      toast.success('测试号码已删除');
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : '删除失败，请刷新列表后重试。'); }
  }

  return <section aria-labelledby="test-number-whitelist-heading" className="rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div><h2 id="test-number-whitelist-heading" className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck aria-hidden="true" className="size-4 text-primary" />测试号码白名单{data && <span className="text-xs font-normal text-muted-foreground">{data.items.filter(item => item.enabled).length} 个启用 / 共 {data.items.length} 个</span>}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">供内部反复调试和演示使用，仅超级管理员可管理。</p></div>
      <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls="test-number-whitelist-content" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '管理白名单'}<ChevronDown aria-hidden="true" className={'size-3.5 transition-transform motion-reduce:transition-none ' + (expanded ? 'rotate-180' : '')} /></Button>
    </div>
    <div id="test-number-whitelist-content" hidden={!expanded} className="space-y-4 border-t p-4">
      <p className="text-xs leading-6 text-muted-foreground">演示、手动测试和外呼任务均可使用。启用号码放宽系统24小时重复拨打限制，并优先安排下一条空闲线路。正在进行的通话不会中断；仍须遵守线路时段、容量和线路商规则。</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{data ? `当前工作区 · 最多保存 ${data.maxEntries} 个测试号码` : '当前工作区的测试号码'}</p><div className="flex items-center gap-2"><Button type="button" size="sm" variant="ghost" disabled={query.isFetching || busy} onClick={() => { setActionError(''); void query.refetch(); }}><RefreshCw aria-hidden="true" className={'size-3.5 ' + (query.isFetching ? 'animate-spin motion-reduce:animate-none' : '')} />刷新</Button>{canManage && <Button type="button" size="sm" disabled={!canAct || atLimit} onClick={() => openEditor({ kind: 'new' })}><Plus aria-hidden="true" className="size-3.5" />新增号码</Button>}</div></div>
      {query.isPending && <p role="status" aria-live="polite" className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">正在读取测试号码…</p>}
      {query.error && <p role="alert" className="text-sm leading-6 text-destructive">读取失败：{query.error.message}{data ? '；下方保留上次读取结果，请刷新后操作。' : '，请点击刷新重试。'}</p>}
      {data && !canManage && <p role="alert" className="text-sm text-muted-foreground">当前账号无权管理测试号码。</p>}
      {data && canManage && <>
        {atLimit && <p className="text-xs text-muted-foreground">已达到号码数量上限，请删除不再使用的号码后再添加。</p>}
        {data.items.length ? <ul className="divide-y rounded-lg border" aria-label="测试号码列表">{data.items.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="break-all text-sm font-medium tabular-nums">{item.phoneNumber}</span><span className={'text-xs ' + (item.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>{item.enabled ? '已启用' : '已停用'}</span></div><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.note || '未填写备注'}</p></div>
          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto"><Button type="button" variant="ghost" size="sm" disabled={!canAct} aria-label={'编辑测试号码' + item.phoneNumber} onClick={() => openEditor({ kind: 'edit', item })}><Pencil aria-hidden="true" className="size-3.5" />编辑</Button><Button type="button" variant="ghost" size="sm" disabled={!canAct} aria-label={(item.enabled ? '停用' : '启用') + '测试号码' + item.phoneNumber} onClick={() => void toggle(item)}><Power aria-hidden="true" className="size-3.5" />{item.enabled ? '停用' : '启用'}</Button><Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={!canAct} aria-label={'删除测试号码' + item.phoneNumber} onClick={() => openEditor({ kind: 'remove', item })}><Trash2 aria-hidden="true" className="size-3.5" />删除</Button></div>
        </li>)}</ul> : <div className="rounded-lg border border-dashed p-6 text-center"><p className="text-sm font-medium">还没有测试号码</p><p className="mt-1 text-xs leading-5 text-muted-foreground">添加需要反复拨打的内部号码，便于演示和调试。</p></div>}
      </>}
      {actionError && <p role="alert" className="text-sm leading-6 text-destructive">{actionError}</p>}
      <p role="status" aria-live="polite" className="text-xs leading-5 text-muted-foreground">{busy && !editor ? '正在更新测试号码…' : feedback}</p>
    </div>
    <Dialog open={editor !== null} onOpenChange={value => { if (!value) closeEditor(); }}><DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{editor?.kind === 'remove' ? '删除测试号码' : editor?.kind === 'edit' ? '编辑测试号码' : '新增测试号码'}</DialogTitle><DialogDescription>{editor?.kind === 'remove' ? `确认删除 ${editor.item.phoneNumber}？删除后，后续拨打此号码将按普通号码规则处理。` : '配置需要反复调试的被叫号码。保存后对新发起的呼叫生效。'}</DialogDescription></DialogHeader>
      {editor?.kind === 'remove' ? <><p className="text-sm leading-6 text-muted-foreground">历史通话记录保留，正在进行的通话继续。</p>{!canAct && !busy && <p role="status" className="text-xs leading-5 text-muted-foreground">{blockedMessage}</p>}{dialogError && <p role="alert" className="text-sm leading-6 text-destructive">{dialogError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>取消</Button><Button type="button" variant="destructive" disabled={busy || !canAct} onClick={() => void remove()}>{busy ? '删除中…' : '删除号码'}</Button></DialogFooter></> : editor && <NumberEditor key={editor.kind === 'edit' ? editor.item.id + ':' + editor.item.updatedAt : 'new'} item={editor.kind === 'edit' ? editor.item : undefined} saving={busy} canSave={Boolean(canAct)} blockedMessage={blockedMessage} error={dialogError} onClose={closeEditor} onSave={input => void save(input)} />}
    </DialogContent></Dialog>
  </section>;
}

export function TestNumberWhitelistPanel() {
  const { org, user } = useAliyunIdentity();
  const company = useCompanyContext();
  if (!org || !user || company.data?.isSystemAdmin !== true) return null;
  return <WhitelistManager key={user + ':' + org} org={org} user={user} />;
}
