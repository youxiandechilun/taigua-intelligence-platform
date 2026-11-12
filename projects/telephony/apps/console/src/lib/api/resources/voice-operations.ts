/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
"use client";

import { useQuery } from '@tanstack/react-query';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { useCompanyContext } from './company';
import { apiClient, unwrap } from '../client';

export type NetworkJitterMs = 0 | 20 | 40 | 60 | 80;
export type VoiceOperationSettings = { networkJitterMs: NetworkJitterMs; alertsEnabled: boolean };
export type VoiceOperationAlert = {
  id: string; key: string; kind: 'line' | 'bridge' | 'quality'; severity: 'warning' | 'critical';
  title: string; message: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null;
};
export type CallQuality = {
  attemptId: string; startedAt: string; endedAt?: string; networkJitterMs: NetworkJitterMs;
  localRtp: {
    receivedPackets: number; sentPackets: number; lostFrames: number; droppedFrames: number;
    filledFrames: number; lateSendTicks: number; jitterMs: number | null; lastPacketAgeMs: number | null;
    remoteLossPercent: number | null; remoteJitterMs: number | null;
  } | null;
  publicRtp: {
    receivedPackets: number | null; sentPackets: number | null; jitterBufferPackets: number | null;
    skipPackets: number | null; flawCount: number | null; mos: number | null;
  } | null;
  turnLatency: { samples: number; lastTotalMs: number; lastProviderMs: number | null; maxTotalMs: number } | null;
};
export type BridgeOperations = {
  version: 1; observedAt: string; retentionSeconds: number; limit: number; scope: 'workspace';
  localScope: 'freeswitch_bridge'; publicScope: 'freeswitch_external_hangup';
  active: CallQuality[]; recent: CallQuality[];
};
export type VoiceOperations = {
  canConfigure: true; settings: VoiceOperationSettings; checkedAt: string | null;
  dependencies: { key: 'bridge' | 'switch' | 'external' | 'execution' | 'model'; label: string;
    state: 'healthy' | 'warning' | 'critical' | 'unknown'; detail: string; checkedAt: string | null }[];
  lines: { id: string; name: string; enabled: boolean; state: 'healthy' | 'degraded' | 'offline' | 'unknown';
    consecutiveFailures: number; cooldownUntil: string | null; lastSuccessAt: string | null;
    lastFailureAt: string | null; lastFailureReason: string; observation: 'call-results' }[];
  alerts: VoiceOperationAlert[]; quality: BridgeOperations | null; qualityError: string | null;
};

const options = (org: string) => ({ headers: { 'x-workspace-id': org } });
export const voiceOperationsApi = {
  get: (org: string) => unwrap<VoiceOperations>(apiClient.get('/telephony/voice-operations', options(org))),
  save: (org: string, settings: Partial<VoiceOperationSettings>) => unwrap<VoiceOperations>(apiClient.patch('/telephony/voice-operations', settings, options(org))),
};

export const voiceOperationsKey = (user: string, org: string) => ['voice-operations', user, org] as const;
export function useVoiceOperations() {
  const { org, user } = useAliyunIdentity();
  const company = useCompanyContext();
  const isSystemAdmin = company.data?.isSystemAdmin === true;
  const query = useQuery({
    queryKey: voiceOperationsKey(user, org), queryFn: () => voiceOperationsApi.get(org),
    enabled: Boolean(org && user && isSystemAdmin), retry: false, staleTime: 10000,
    refetchInterval: 15000, refetchIntervalInBackground: false,
  });
  return { query, org, user, isSystemAdmin };
}
