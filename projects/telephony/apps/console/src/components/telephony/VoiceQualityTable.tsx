/*
 * 中文导读：线路与语音外呼的 VoiceQualityTable 组件，封装该界面的展示与交互。
 */
"use client";

import type { BridgeOperations, CallQuality } from '@/src/lib/api/resources/voice-operations';
import { voiceOperationTime } from './VoiceOperationsAlerts';

function metric(value: number | null | undefined, unit = '', digits = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '未观测';
}

function QualityRow({ row, active }: { row: CallQuality; active: boolean }) {
  const local = row.localRtp;
  const latency = row.turnLatency && row.turnLatency.samples > 0 ? row.turnLatency : null;
  return <tr className="align-top">
    <td className="px-3 py-3"><p className="font-medium">{active ? '通话中' : '已结束'}</p><p className="mt-1 text-muted-foreground">{voiceOperationTime(row.startedAt)}</p><p className="mt-1 font-mono text-muted-foreground" title={row.attemptId}>记录 {row.attemptId.slice(0, 8)}</p></td>
    <td className="px-3 py-3"><p>抖动 {metric(local?.jitterMs, ' ms', 1)}</p><p className="mt-1 text-muted-foreground">丢帧 {metric(local?.lostFrames)} · 丢弃 {metric(local?.droppedFrames)} · 补帧 {metric(local?.filledFrames)}</p><p className="mt-1 text-muted-foreground">收 / 发包 {metric(local?.receivedPackets)} / {metric(local?.sentPackets)}</p></td>
    <td className="px-3 py-3"><p>到本地播放队列 {metric(latency?.lastTotalMs, ' ms')}</p><p className="mt-1 text-muted-foreground">到模型首音频 {metric(latency?.lastProviderMs, ' ms')}</p><p className="mt-1 text-muted-foreground">已观测 {latency?.samples ?? 0} 轮 · 最长 {metric(latency?.maxTotalMs, ' ms')}</p></td>
    <td className="px-3 py-3">{row.publicRtp ? <><p>收 / 发包 {metric(row.publicRtp.receivedPackets)} / {metric(row.publicRtp.sentPackets)}</p><p className="mt-1 text-muted-foreground">跳包 {metric(row.publicRtp.skipPackets)} · 缺陷 {metric(row.publicRtp.flawCount)}</p><p className="mt-1 text-muted-foreground">MOS {metric(row.publicRtp.mos, '', 2)}</p></> : <p className="text-muted-foreground">{active ? '通话结束后读取' : '未获得外线媒体统计'}</p>}<p className="mt-1 text-muted-foreground">本次缓冲 {row.networkJitterMs ? `${row.networkJitterMs} ms` : '保持现状'}</p></td>
  </tr>;
}

export function VoiceQualityTable({ quality, error }: { quality: BridgeOperations | null; error: string | null }) {
  const active = quality?.active ?? [];
  const recent = quality?.recent ?? [];
  const rows = [...active.map(row => ({ row, active: true })), ...recent.map(row => ({ row, active: false }))].slice(0, 20);
  return <section aria-labelledby="voice-quality-heading" className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="voice-quality-heading" className="text-sm font-medium">通话质量与接话耗时</h3><span className="text-xs text-muted-foreground">活动样本 {active.length} · 近15分钟结束样本 {recent.length}</span></div>
    <p className="text-xs leading-5 text-muted-foreground">此处为近期采样，活动样本最多50通，结束样本全系统共用50条，不代表全量统计。本机媒体统计覆盖交换机与语音桥之间。外线统计在通话结束后读取；接话耗时从客户停说信号开始，到本地首帧进入播放队列为止，不等于客户实际听到声音的时间。</p>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs leading-5 text-destructive">{error}</p>}
    {!quality ? <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">通话质量暂未读取到，请稍后刷新。未知指标不会按零值展示。</p> : !rows.length ? <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">当前没有通话样本。新通话开始后自动采集；最多保留50条近期记录，服务重启后重新积累。</p> : <div role="region" aria-label="通话质量记录，可横向滚动" tabIndex={0} className="overflow-x-auto rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><table className="w-full min-w-3xl divide-y text-left text-xs"><caption className="sr-only">最近通话的本机媒体、接话耗时与外线统计，未知数值显示为未观测</caption><thead className="bg-muted/40 text-muted-foreground"><tr><th scope="col" className="px-3 py-2 font-medium">通话记录</th><th scope="col" className="px-3 py-2 font-medium">本机媒体</th><th scope="col" className="px-3 py-2 font-medium">最近一轮接话</th><th scope="col" className="px-3 py-2 font-medium">外线媒体</th></tr></thead><tbody className="divide-y">{rows.map(({ row, active: isActive }) => <QualityRow key={row.attemptId} row={row} active={isActive} />)}</tbody></table></div>}
    {quality && <p className="text-xs text-muted-foreground">采集时间 {voiceOperationTime(quality.observedAt)}{active.length + recent.length > rows.length ? ' · 此处展示最近20条' : ''}</p>}
  </section>;
}
