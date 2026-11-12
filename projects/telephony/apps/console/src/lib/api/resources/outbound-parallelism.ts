/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { apiClient, unwrap } from '../client';

export type OutboundParallelismPolicy = { maxParallelism: number; canConfigure: boolean };
const options = (org: string) => ({ headers: { 'x-workspace-id': org } });
export const outboundParallelismKey = (user: string, org: string) => ['telephony', 'parallelism-policy', user, org] as const;
export const outboundParallelismApi = {
  get: (org: string) => unwrap<OutboundParallelismPolicy>(apiClient.get('/telephony/parallelism-policy', options(org))),
  save: (org: string, maxParallelism: number, expectedMaxParallelism: number) => unwrap<OutboundParallelismPolicy>(apiClient.put('/telephony/parallelism-policy', { maxParallelism, expectedMaxParallelism }, options(org))),
};

export function useOutboundParallelismPolicy(enabled = true) {
  const { user, org } = useAliyunIdentity();
  const query = useQuery({
    queryKey: outboundParallelismKey(user, org), queryFn: () => outboundParallelismApi.get(org),
    enabled: Boolean(enabled && user && org), staleTime: 10000, retry: false,
    refetchInterval: 30000, refetchIntervalInBackground: false,
  });
  return { query, user, org };
}
