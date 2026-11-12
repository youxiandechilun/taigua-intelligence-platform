/*
 * 中文导读：线路与语音外呼的 VoiceOperationsPanel 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/src/components/ui/button';
import { useVoiceOperations, voiceOperationsApi, voiceOperationsKey, type VoiceOperationSettings, type VoiceOperations } from '@/src/lib/api/resources/voice-operations';
import { NetworkBufferSetting } from './NetworkBufferSetting';
import { VoiceOperationsAlerts, voiceOperationTime } from './VoiceOperationsAlerts';
import { VoiceQualityTable } from './VoiceQualityTable';

const dependencyLabels = { healthy: '已就绪', warning: '需关注', critical: '异常', unknown: '未观测' };
const lineLabels = { healthy: '近期可达', degraded: '连续失败', offline: '历史失败待验证', unknown: '未观测' };
const statusTone = (state: string) => state === 'critical' || state === 'offline' ? 'text-destructive' : state === 'warning' || state === 'degraded' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground';

function ServiceStatus({ data }: { data: VoiceOperations }) {
  return <section aria-labelledby="voice-service-status" className="space-y-3">
    <h3 id="voice-service-status" className="text-sm font-medium">服务与线路状态</h3>
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">{data.dependencies.map(item => <div key={item.key} className="min-w-0"><dt className="flex items-center justify-between gap-2 text-xs"><span>{item.label}</span><span className={statusTone(item.state)}>{dependencyLabels[item.state]}</span></dt><dd className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.detail}</dd></div>)}</dl>
    <div className="rounded-lg border">
      {data.lines.length ? <ul className="divide-y">{data.lines.map(line => <li key={line.id} className="space-y-1 px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{line.name}{line.enabled ? '' : ' · 未启用'}</span><span className={statusTone(line.state)}>{lineLabels[line.state]}{line.consecutiveFailures > 0 ? ` · 连续失败 ${line.consecutiveFailures} 次` : ''}</span></div>{line.lastFailureReason && line.consecutiveFailures > 0 && <p className="break-words text-xs leading-5 text-muted-foreground">{line.lastFailureReason}</p>}<p className="text-xs leading-5 text-muted-foreground">最近成功 {voiceOperationTime(line.lastSuccessAt)}</p></li>)}</ul> : <p className="p-3 text-xs text-muted-foreground">尚未配置线路。</p>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">线路状态依据实际呼叫结果更新。失败记录不会暂停线路调度；当前采用IP鉴权直连，服务就绪和无告警均不能代替线路商在线验证。</p>
  </section>;
}

export function VoiceOperationsPanel() {
  const { query, org, user, isSystemAdmin } = useVoiceOperations();
  const client = useQueryClient();
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertFeedback, setAlertFeedback] = useState('');
  const [alertError, setAlertError] = useState('');
  if (!isSystemAdmin) return null;
  const data = query.data;

  async function save(settings: Partial<VoiceOperationSettings>) {
    const result = await voiceOperationsApi.save(org, settings);
    client.setQueryData(voiceOperationsKey(user, org), result);
  }
  async function changeAlerts(enabled: boolean) {
    setSavingAlerts(true); setAlertFeedback(''); setAlertError('');
    try {
      await save({ alertsEnabled: enabled });
      setAlertFeedback(enabled ? '异常与恢复告警记录已开启。' : '新的告警记录已关闭，历史记录保留。');
    } catch (cause) {
      setAlertError(cause instanceof Error ? cause.message : '告警设置保存失败，请重试。');
    } finally { setSavingAlerts(false); }
  }

  return <section aria-labelledby="voice-operations-heading" className="space-y-4 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="voice-operations-heading" className="flex items-center gap-2 text-sm font-semibold"><Activity aria-hidden="true" className="size-4 text-primary" />语音运行监测</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">超级管理员可见 · 页面打开时每15秒刷新</p></div>
      <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className={'size-3.5 ' + (query.isFetching ? 'animate-spin motion-reduce:animate-none' : '')} />{query.isFetching ? '读取中…' : '刷新'}</Button>
    </div>
    {query.isPending && <p role="status" aria-live="polite" className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">正在读取语音服务和线路状态…</p>}
    {query.error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">监测数据更新失败：{query.error.message}{data ? '；下方保留上次读取结果。' : ''}</p>}
    {data && <>
      <ServiceStatus data={data} />
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.alertsEnabled} disabled={savingAlerts} onChange={event => void changeAlerts(event.target.checked)} className="size-4 accent-primary" />记录线路与语音服务异常</label><span className="text-xs text-muted-foreground">自动检查 {voiceOperationTime(data.checkedAt)}</span></div>
        <p className="text-xs leading-5 text-muted-foreground">后台每30秒检查本机服务及近期通话结果，记录异常与恢复；提醒显示在系统内，不向外部发送消息。</p>
        {alertError && <p role="alert" className="text-xs text-destructive">{alertError}</p>}
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{savingAlerts ? '正在保存告警设置…' : alertFeedback}</p>
        <VoiceOperationsAlerts alerts={data.alerts} enabled={data.settings.alertsEnabled} checkedAt={data.checkedAt} />
      </div>
      <VoiceQualityTable quality={data.quality} error={data.qualityError} />
      <NetworkBufferSetting value={data.settings.networkJitterMs} onSave={networkJitterMs => save({ networkJitterMs })} />
    </>}
  </section>;
}
