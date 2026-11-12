/*
 * 中文导读：数据看板的 ModelUsageAlerts 组件，封装该界面的展示与交互。
 */
"use client";

import Link from 'next/link';
import { ArrowUpRight, Bell, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { telephonyApi } from '@/src/lib/api/resources/telephony';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';

export function ModelUsageAlerts() {
  const { org, user } = useAliyunIdentity();
  const query = useQuery({
    queryKey: ['model-alerts', user, org],
    queryFn: () => telephonyApi.modelAlerts(org),
    enabled: !!org && !!user,
    retry: false,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  if (query.isError) {
    return <button type="button" aria-label="用量提醒暂时无法更新，点击重新加载" title="用量提醒暂时无法更新，点击重新加载" className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted" onClick={() => void query.refetch()}><Bell className="size-3.5" />用量提醒</button>;
  }
  const alerts = query.data?.alerts;
  if (!alerts?.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={'查看 ' + alerts.length + ' 条用量提醒详情'} title={alerts.map(alert => alert.title).join(' · ')} className="inline-flex h-9 max-w-full shrink-0 items-center gap-2 rounded-md px-2.5 text-xs text-amber-800 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400">
          <Bell aria-hidden="true" className="size-3.5" /><span>用量提醒</span><span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 tabular-nums">{alerts.length}</span><ChevronDown aria-hidden="true" className="size-3" />
        </button>
      </PopoverTrigger>
        <PopoverContent align="end" aria-label="用量提醒详情" className="max-h-80 w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto rounded-lg p-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">用量与余额提醒</h2>
            <Link href="/settings/models" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">模型设置<ArrowUpRight aria-hidden="true" className="size-3" /></Link>
          </div>
          <div className="divide-y">
            {alerts.map(alert => <div key={alert.id} className="px-4 py-3"><p className="text-xs font-medium">{alert.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{alert.message}</p></div>)}
          </div>
        </PopoverContent>
    </Popover>
  );
}
