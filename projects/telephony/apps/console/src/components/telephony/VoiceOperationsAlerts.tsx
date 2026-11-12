/*
 * 中文导读：线路与语音外呼的 VoiceOperationsAlerts 组件，封装该界面的展示与交互。
 */
"use client";

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { VoiceOperationAlert } from '@/src/lib/api/resources/voice-operations';

export function voiceOperationTime(value: string | null | undefined) {
  if (!value) return '暂无数据';
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '暂无数据';
}

export function VoiceOperationsAlerts({ alerts, enabled, checkedAt }: { alerts: VoiceOperationAlert[]; enabled: boolean; checkedAt: string | null }) {
  const active = alerts.filter(alert => alert.resolvedAt === null);
  const resolved = alerts.filter(alert => alert.resolvedAt !== null).slice(0, 10);
  return <section aria-labelledby="voice-operation-alerts" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="voice-operation-alerts" className="text-sm font-medium">异常与恢复记录</h3>
      <span className="text-xs text-muted-foreground">{enabled ? `${active.length} 条待关注` : '告警记录已关闭'}</span>
    </div>
    {!enabled && <p className="text-xs leading-5 text-muted-foreground">关闭期间不生成新的告警记录；下方历史记录和通话质量仍可查看。</p>}
    {active.length ? <ul className="divide-y rounded-lg border border-amber-500/30 bg-amber-500/5">
      {active.map(alert => <li key={alert.id} className="flex gap-2 p-3">
        <AlertTriangle aria-hidden="true" className={'mt-0.5 size-4 shrink-0 ' + (alert.severity === 'critical' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300')} />
        <div className="min-w-0"><p className="text-sm font-medium">{alert.severity === 'critical' ? '异常 · ' : '提醒 · '}{alert.title}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{alert.message}</p><p className="mt-1 text-xs text-muted-foreground">首次发现 {voiceOperationTime(alert.firstSeenAt)} · 最近发现 {voiceOperationTime(alert.lastSeenAt)}</p></div>
      </li>)}
    </ul> : <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{enabled ? checkedAt ? '当前没有待关注告警。此状态只反映已观测的服务与通话结果，不代表线路商一定在线。' : '后台尚未完成首次检查，告警记录会自动更新。' : '当前没有待关注告警记录。'}</p>}
    {resolved.length > 0 && <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">最近恢复记录（{resolved.length}）</summary>
      <ul className="divide-y border-t">{resolved.map(alert => <li key={alert.id} className="px-3 py-2"><p className="text-xs font-medium">已恢复 · {alert.title}</p><p className="mt-1 text-xs text-muted-foreground">{voiceOperationTime(alert.resolvedAt)}</p></li>)}</ul>
    </details>}
  </section>;
}
