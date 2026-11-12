/*
 * 中文导读：线路与语音外呼的 OutboundParallelismSettings 组件，封装该界面的展示与交互。
 */
'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Settings2 } from 'lucide-react';
import { useCompanyContext } from '@/src/lib/api/resources/company';
import { outboundParallelismApi, outboundParallelismKey, useOutboundParallelismPolicy } from '@/src/lib/api/resources/outbound-parallelism';
import { toast } from '@/src/lib/toast';
import { Button } from '../ui/button';
import { NativeSelect } from '../ui/native-select';

export function OutboundParallelismSettings() {
  const company = useCompanyContext();
  const { query, org, user } = useOutboundParallelismPolicy(company.data?.isSystemAdmin === true);
  const client = useQueryClient(), selectId = useId(), helpId = useId();
  const [draft, setDraft] = useState<{ value: number; expected: number } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('请先选择外呼倍数上限。');
      return outboundParallelismApi.save(org, draft.value, draft.expected);
    },
    onSuccess: result => {
      client.setQueryData(outboundParallelismKey(user, org), result);
      setDraft(null);
      void client.invalidateQueries({ queryKey: ['telephony'] });
      toast.success(`外呼倍数上限已保存为 ${result.maxParallelism} 倍`);
    },
    onError: (error: Error) => { toast.error(error.message); void query.refetch(); }, retry: false,
  });
  if (company.data?.isSystemAdmin !== true) return null;
  const data = query.data;
  return <section aria-labelledby={helpId} className="space-y-3 rounded-xl border bg-card p-4">
    <h2 id={helpId} className="flex items-center gap-2 text-sm font-semibold"><Settings2 aria-hidden="true" className="size-4 text-primary" />外呼并发设置</h2>
    <p className="text-xs leading-5 text-muted-foreground">超级管理员设置当前工作区的任务倍数上限，最高 6 倍。</p>
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">正在读取外呼倍数设置…</p>}
    {query.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p className="text-destructive">读取设置失败：{query.error.message}</p><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-3.5" />重新读取</Button></div>}
    {data?.canConfigure && <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><label htmlFor={selectId} className="block text-sm font-medium">任务倍数上限</label><NativeSelect id={selectId} value={draft?.value ?? data.maxParallelism} disabled={save.isPending} onChange={event => setDraft({ value: Number(event.target.value), expected: draft?.expected ?? data.maxParallelism })}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value} 倍</option>)}</NativeSelect></div>
        <Button type="button" size="sm" disabled={save.isPending || !draft || draft.value === data.maxParallelism} onClick={() => save.mutate()}>{save.isPending ? '保存中…' : '保存设置'}</Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">每倍代表单个任务同时拨打 1 个不同号码，实际数量还受线路和服务容量限制。调低上限后，进行中的通话继续完成，空出的席位按新上限调度。</p>
    </>}
  </section>;
}
