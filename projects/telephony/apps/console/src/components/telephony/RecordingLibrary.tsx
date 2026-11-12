"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgents } from '@/src/hooks/queries/agents';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { playbookApi, type ConversationPlaybook } from '@/src/lib/api/resources/playbook';
import { LearningStudio } from '@/src/components/agents/studio/LearningStudio';
import { Button } from '@/src/components/ui/button';
import { toast } from '@/src/lib/toast';

export function RecordingLibrary() {
  const { org, user } = useAliyunIdentity();
  const agents = useAgents();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const agentId = agents.data?.some(agent => agent.agentId === selected) ? selected : agents.data?.[0]?.agentId || '';
  const queryKey = ['recording-library-playbook', org, user, agentId];
  const playbook = useQuery({
    queryKey,
    queryFn: () => playbookApi.get(agentId),
    enabled: Boolean(org && agentId),
  });
  const save = useMutation({
    mutationFn: (patch: Partial<ConversationPlaybook>) => {
      if (!playbook.data) throw new Error('请等待数字员工资料加载完成。');
      return playbookApi.save(agentId, {
        playbook: { ...playbook.data.playbook, ...patch },
        placeholders: playbook.data.placeholders,
        expectedUpdatedAt: playbook.data.updatedAt,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success('学习建议已保存到数字员工话术草稿');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return <main className="space-y-6 p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">录音学习</h1><p className="mt-2 text-sm text-muted-foreground">管理录音素材，审核提取的知识并用于数字员工。</p></div>
      <label className="flex items-center gap-3 text-sm">数字员工
        <select className="min-h-10 rounded-md border bg-background px-3" value={agentId} onChange={event => setSelected(event.target.value)} disabled={agents.isPending || save.isPending}>
          {!agents.data?.length && <option value="">暂无数字员工</option>}
          {agents.data?.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}
        </select>
      </label>
    </header>
    {agents.isPending && <p role="status">正在读取数字员工…</p>}
    {agents.isError && <div role="alert"><p>数字员工加载失败，请重试。</p><Button className="mt-3" onClick={() => void agents.refetch()}>重新加载</Button></div>}
    {agents.isSuccess && !agents.data.length && <div className="rounded-lg border p-6"><p>先创建数字员工，再上传需要学习的录音。</p><Link className="mt-3 inline-block underline" href="/agents">前往数字员工</Link></div>}
    {agentId && playbook.isPending && <p role="status">正在读取话术和录音资料…</p>}
    {playbook.isError && <div role="alert"><p>话术资料加载失败，请重试。</p><Button className="mt-3" onClick={() => void playbook.refetch()}>重新加载</Button></div>}
    {playbook.data && <LearningStudio key={org + agentId} agentId={agentId} playbook={playbook.data.playbook} placeholders={playbook.data.placeholders} initialTab="recording" canEdit={!save.isPending} onApply={patch => save.mutate(patch)} />}
  </main>;
}
