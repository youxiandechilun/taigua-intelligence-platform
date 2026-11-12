/*
 * 中文导读：线路与语音外呼的 NetworkBufferSetting 组件，封装该界面的展示与交互。
 */
"use client";

import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import type { NetworkJitterMs } from '@/src/lib/api/resources/voice-operations';

const choices: NetworkJitterMs[] = [0, 20, 40, 60, 80];

export function NetworkBufferSetting({ value, onSave }: {
  value: NetworkJitterMs;
  onSave: (value: NetworkJitterMs) => Promise<void>;
}) {
  const [draft, setDraft] = useState<NetworkJitterMs | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const selected = draft ?? value;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || selected === value) return;
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      await onSave(selected);
      setDraft(null);
      setFeedback('已保存，仅对新发起的通话生效。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '缓冲设置保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={submit} className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium"><label htmlFor="network-jitter-setting">外线网络缓冲</label></h3>
        <p id="network-jitter-description" className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">默认保持现状。下方数值为初始缓冲，波动时最高可增至两倍；增加缓冲可能减少吞字，也可能增加接话等待，建议先观察质量再小幅调整。</p>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Select value={String(selected)} disabled={saving} onValueChange={raw => {
          const next = Number(raw) as NetworkJitterMs;
          if (!choices.includes(next)) return;
          setDraft(next);
          setFeedback('');
          setError('');
        }}>
          <SelectTrigger id="network-jitter-setting" aria-describedby="network-jitter-description network-jitter-scope" className="min-w-44 flex-1 sm:flex-none"><SelectValue /></SelectTrigger>
          <SelectContent>{choices.map(choice => <SelectItem key={choice} value={String(choice)}>{choice === 0 ? '保持现状（0 ms）' : `${choice} ms`}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={saving || selected === value}><Save aria-hidden="true" className="size-3.5" />{saving ? '保存中…' : '保存'}</Button>
      </div>
    </div>
    <p id="network-jitter-scope" className="text-xs text-muted-foreground">仅超级管理员可调整；保存后对新发起的通话生效。</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <p role="status" aria-live="polite" className="text-xs text-emerald-700 dark:text-emerald-300">{feedback}</p>
  </form>;
}
