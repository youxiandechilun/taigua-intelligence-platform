/*
 * 中文导读：线路与语音外呼的 TaskRecipients 组件，封装该界面的展示与交互。
 */
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { callReasonText, phoneStatus, type SipTask } from '@/src/lib/api/resources/telephony';
import { Button } from '../ui/button';

const PAGE_SIZE = 10;

export function TaskRecipients({ task }: { task: SipTask }) {
  const [page, setPage] = useState(1);
  const total = task.recipients.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const attempts = useMemo(() => {
    const latest = new Map<number, SipTask['attempts'][number]>();
    for (const attempt of task.attempts) {
      if(attempt.status==='CANCELLED'&&attempt.result.retryPolicyCancelled&&!attempt.startedAt)continue;
      const prior = latest.get(attempt.recipientIndex);
      if (!prior || attempt.attemptNumber >= prior.attemptNumber) latest.set(attempt.recipientIndex, attempt);
    }
    return latest;
  }, [task.attempts]);

  return <section aria-label="任务客户名单" className="flex min-h-32 min-w-0 flex-col overflow-hidden rounded-lg border">
    <div key={current} className="min-h-0 max-h-[38vh] overflow-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{task.name}的客户名单</caption>
        <thead className="sticky top-0 z-10 bg-card"><tr><th className="px-3 py-2.5">客户</th><th className="px-3 py-2.5">号码</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">结果</th></tr></thead>
        <tbody>{task.recipients.slice(start, start + PAGE_SIZE).map((recipient, offset) => {
          const attempt = attempts.get(start + offset);
          return <tr className="border-t" key={recipient.phoneNumber}>
            <td className="px-3 py-2.5">{recipient.crmCompanyId ? <Link className="hover:text-primary" href={'/crm/companies/' + recipient.crmCompanyId}>{recipient.name || '客户资料'}</Link> : recipient.name || '未填写'}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{recipient.phoneNumber}</td>
            <td className="whitespace-nowrap px-3 py-2.5">{attempt ? (attempt.status==='QUEUED'&&attempt.attemptNumber>1?'待重拨':phoneStatus[attempt.status] || '待确认') : '未拨打'}{attempt&&attempt.attemptNumber>1&&<p className="mt-1 text-xs text-muted-foreground">第 {attempt.attemptNumber-1} 次重拨</p>}</td>
            <td className="px-3 py-2.5">{attempt?.status==='QUEUED'&&attempt.attemptNumber>1&&attempt.nextAttemptAt?<span className="text-xs text-muted-foreground">最早 {new Date(attempt.nextAttemptAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>:attempt?.result.reason ? callReasonText(attempt.result.reason,attempt.result.diagnostics) : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
      {!total && <p className="p-4 text-sm text-muted-foreground">此任务暂无客户号码。</p>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-3 py-2.5">
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground tabular-nums">共 {total} 位客户{total > 0 ? `，当前 ${start + 1}–${Math.min(start + PAGE_SIZE, total)} 位` : ''}</p>
      <nav aria-label="客户名单分页" className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label="上一页客户" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft aria-hidden="true" className="size-4"/></Button>
        <span className="min-w-14 text-center text-xs tabular-nums">{current} / {pages}</span>
        <Button type="button" variant="outline" size="icon-sm" aria-label="下一页客户" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight aria-hidden="true" className="size-4"/></Button>
      </nav>
    </div>
  </section>;
}
