/*
 * 中文导读：线路与语音外呼的 LineFailureHistory 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { lineFailuresApi } from '@/src/lib/api/resources/line-failures';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { useCompanyContext } from '@/src/lib/api/resources/company';
import { callFailure, callReasonText } from '@/src/lib/api/call-diagnostics';
import { downloadRowsAsExcel } from '@/src/lib/export-excel';
import { voiceOperationTime } from './VoiceOperationsAlerts';

export function LineFailureHistory() {
  const { org, user } = useAliyunIdentity();
  return <ScopedLineFailureHistory key={`${user}:${org}`} org={org} user={user} />;
}

function ScopedLineFailureHistory({ org, user }: { org: string; user: string }) {
  const context = useCompanyContext();
  const access = context.data?.organizationId === org ? context.data : undefined;
  const canRead = access?.isSystemAdmin === true || access?.permissions.callLogs?.includes('read') === true;
  const [cursors, setCursors] = useState<string[]>([]);
  const client = useQueryClient();
  const cursor = cursors.at(-1);
  const query = useQuery({ queryKey: ['line-failures', user, org, cursor ?? 'first'], queryFn: () => lineFailuresApi.list(org, cursor), enabled: Boolean(org && user && canRead), staleTime: 15000, retry: false });
  if (!canRead) return null;
  const rows = query.data?.items ?? [];
  const exportPage = () => downloadRowsAsExcel('线路失败明细.xlsx', rows, [
    { header: '时间（北京时间）', value: row => voiceOperationTime(row.occurredAt) },
    { header: '线路', value: row => row.lineName }, { header: '被叫号码', value: row => row.phoneNumber },
    { header: '所属员工', value: row => row.ownerName }, { header: '任务', value: row => row.taskName },
    { header: '本号码第几次拨打', value: row => row.attemptNumber }, { header: 'SIP 返回码', value: row => row.diagnostics.sipStatus ?? '未记录' },
    { header: '系统原因代码', value: row => row.reason || '未记录' }, { header: '挂断原因', value: row => row.diagnostics.cause || '未记录' },
    { header: '说明', value: row => callReasonText(row.reason, row.diagnostics) }, { header: '拨打编号', value: row => row.id },
  ]);
  async function refreshLatest() {
    await client.invalidateQueries({ queryKey: ['line-failures', user, org], refetchType: 'none' });
    if (cursors.length) setCursors([]); else await query.refetch();
  }
  return <section id="line-failures" aria-labelledby="line-failures-heading" className="space-y-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 id="line-failures-heading" className="text-sm font-medium">逐次失败明细</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">按真实拨打记录展示未接通、失败和待核对结果。每页20条，时间为北京时间。</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!rows.length || query.isFetching} onClick={exportPage}><Download aria-hidden="true" className="size-3.5" />导出本页</Button><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void refreshLatest()}><RefreshCw aria-hidden="true" className="size-3.5" />刷新最新</Button></div>
    </div>
    {query.isPending ? <p role="status" className="p-3 text-sm text-muted-foreground">正在读取失败明细…</p> : query.isError ? <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm text-destructive"><p>失败明细读取失败：{query.error.message}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>重试</Button></div> : <>
      <div className="max-h-[480px] overflow-auto rounded-lg border"><table className="w-full min-w-[900px] text-left text-xs">
        <thead className="sticky top-0 bg-muted"><tr>{['时间 / 线路', '被叫 / 员工', '错误码 / 原因', '说明 / 详情'].map(label => <th key={label} scope="col" className="px-3 py-2.5 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y">{rows.map(row => {
          const failure = callFailure({ disposition: row.reason, diagnostics: row.diagnostics }, row.status);
          return <tr key={row.id} className="align-top"><td className="space-y-1 px-3 py-3"><p className="whitespace-nowrap tabular-nums">{voiceOperationTime(row.occurredAt)}</p><p className="font-medium">{row.lineName}</p></td>
            <td className="space-y-1 px-3 py-3"><p className="tabular-nums">{row.phoneNumber || '未记录'}</p><p className="text-muted-foreground">{row.ownerName} · 第{row.attemptNumber}次</p></td>
            <td className="max-w-64 space-y-1 break-all px-3 py-3"><p className="font-mono font-medium">{failure?.code || '错误码未记录'}</p><p className="font-mono text-muted-foreground">{row.reason || '系统原因未记录'}</p>{row.diagnostics.cause && row.diagnostics.cause !== row.reason && <p className="font-mono text-muted-foreground">挂断：{row.diagnostics.cause}</p>}{row.diagnostics.leg && <p className="text-muted-foreground">{row.diagnostics.leg === 'EMPLOYEE' ? '员工接听侧' : '客户接听侧'}</p>}</td>
            <td className="max-w-96 space-y-1 px-3 py-3"><p className="leading-5">{callReasonText(row.reason, row.diagnostics)}</p><p className="text-muted-foreground">任务：{row.taskName}</p><details><summary className="cursor-pointer text-primary">拨打编号与诊断</summary><dl className="mt-2 space-y-1 break-all text-muted-foreground"><div><dt className="inline">拨打编号：</dt><dd className="inline font-mono">{row.id}</dd></div><div><dt className="inline">SIP 返回码：</dt><dd className="inline font-mono">{row.diagnostics.sipStatus ?? '未记录'}</dd></div><div><dt className="inline">SIP 结束标记：</dt><dd className="inline font-mono">{row.diagnostics.sipDisposition || '未记录'}</dd></div></dl></details>{row.callId && <Link className="inline-block text-primary hover:underline" href={`/calls/${encodeURIComponent(row.callId)}`}>查看通话</Link>}</td></tr>;
        })}{!rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">当前没有可显示的失败记录。</td></tr>}</tbody>
      </table></div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>第 {cursors.length + 1} 页 · 本页 {rows.length} 条</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!cursors.length || query.isFetching} onClick={() => setCursors(value => value.slice(0, -1))}>上一页</Button><Button size="sm" variant="outline" disabled={!query.data?.nextCursor || query.isFetching} onClick={() => { const next = query.data?.nextCursor; if (next) setCursors(value => [...value, next]); }}>下一页</Button></div></div>
    </>}
  </section>;
}
