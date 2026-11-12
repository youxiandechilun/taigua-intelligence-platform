/*
 * 中文导读：线路与语音外呼的 VoiceOperationsBanner 组件，封装该界面的展示与交互。
 */
"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Activity, ArrowUpRight, Check } from 'lucide-react';
import { useVoiceOperations } from '@/src/lib/api/resources/voice-operations';
import { acknowledgeVoiceAlerts, emptyVoiceBannerSnapshot, parseVoiceBannerSnapshot, readVoiceBannerSnapshot, serializeVoiceBannerDismissals, subscribeVoiceBannerSnapshot, voiceAlertAcknowledged, voiceBannerStorageKey, writeVoiceBannerSnapshot } from '@/src/lib/voice-operations-banner-state';

function ScopedVoiceOperationsBanner({ state }: { state: ReturnType<typeof useVoiceOperations> }) {
  const { query, org, user } = state;
  const storageKey = voiceBannerStorageKey(user, org);
  const subscribe = useCallback((callback: () => void) => subscribeVoiceBannerSnapshot(storageKey, callback), [storageKey]);
  const getSnapshot = useCallback(() => readVoiceBannerSnapshot(storageKey), [storageKey]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, emptyVoiceBannerSnapshot);
  const dismissed = useMemo(() => parseVoiceBannerSnapshot(snapshot), [snapshot]);
  const active = useMemo(() => query.data?.alerts.filter(alert => alert.resolvedAt === null) ?? [], [query.data?.alerts]);

  useEffect(() => {
    const data = query.data;
    if (!query.isSuccess || !data) return;
    const next = {
      // Another tab may know a newer alert than this query snapshot. Remove
      // only confirmations this response explicitly identifies as resolved.
      alerts: dismissed.alerts.filter(item => {
        const observed = data.alerts.find(alert => alert.id === item.id);
        return !observed || observed.resolvedAt === null && observed.firstSeenAt === item.firstSeenAt;
      }),
      errorAcknowledgedAt: dismissed.errorAcknowledgedAt !== null && query.dataUpdatedAt > dismissed.errorAcknowledgedAt ? null : dismissed.errorAcknowledgedAt,
    };
    const updated = serializeVoiceBannerDismissals(next);
    if (updated !== snapshot && readVoiceBannerSnapshot(storageKey) === snapshot) writeVoiceBannerSnapshot(storageKey, updated);
  }, [query.isSuccess, query.data, query.dataUpdatedAt, dismissed, snapshot, storageKey]);

  const acknowledgeError = () => writeVoiceBannerSnapshot(storageKey, serializeVoiceBannerDismissals({ ...parseVoiceBannerSnapshot(readVoiceBannerSnapshot(storageKey)), errorAcknowledgedAt: Date.now() }));
  if (query.isError) return dismissed.errorAcknowledgedAt !== null ? null : <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><Activity aria-hidden="true" className="size-3.5" />语音运行监测暂时无法更新</span><div className="flex shrink-0 items-center gap-3"><Link className="inline-flex items-center gap-1 text-primary hover:underline" href="/settings/telephony#voice-operations-heading">查看监测<ArrowUpRight aria-hidden="true" className="size-3" /></Link><button type="button" onClick={acknowledgeError} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary" aria-label="已知晓，关闭监测更新失败提醒"><Check aria-hidden="true" className="size-3" />已知晓</button></div></div>;
  const alerts = active.filter(alert => !voiceAlertAcknowledged(alert, dismissed.alerts));
  if (!query.data?.settings.alertsEnabled || !alerts.length) return null;
  const critical = alerts.some(alert => alert.severity === 'critical');
  const acknowledge = () => writeVoiceBannerSnapshot(storageKey, serializeVoiceBannerDismissals(acknowledgeVoiceAlerts(parseVoiceBannerSnapshot(readVoiceBannerSnapshot(storageKey)), alerts)));
  return <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs">
    <span className="flex min-w-0 items-start gap-2"><Activity aria-hidden="true" className={'mt-0.5 size-3.5 shrink-0 ' + (critical ? 'text-destructive' : 'text-amber-700 dark:text-amber-300')} /><span className="break-words">语音运行有 {alerts.length} 项需关注：{alerts[0].title}</span></span>
    <div className="flex shrink-0 items-center gap-3"><Link className="inline-flex items-center gap-1 text-primary hover:underline" href="/settings/telephony#voice-operations-heading">查看详情<ArrowUpRight aria-hidden="true" className="size-3" /></Link><button type="button" onClick={acknowledge} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary" aria-label="已知晓，关闭当前语音运行提醒"><Check aria-hidden="true" className="size-3" />已知晓</button></div>
  </div>;
}

export function VoiceOperationsBanner() {
  const state = useVoiceOperations();
  if (!state.isSystemAdmin || !state.org || !state.user) return null;
  return <ScopedVoiceOperationsBanner key={state.user + ':' + state.org} state={state} />;
}
