/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from '../client';
import type { CallDiagnostics } from '../call-diagnostics';

export type LineFailureRecord = {
  id: string; taskId: string; taskName: string; attemptNumber: number; status: string;
  occurredAt: string | null; lineName: string; provider: 'HAOKEHU_SIP'; phoneNumber: string;
  ownerName: string; callId: string | null; reason: string; diagnostics: CallDiagnostics;
};
export type LineFailurePage = { items: LineFailureRecord[]; nextCursor: string | null; scope: 'workspace' | 'self' };
export const lineFailuresApi = {
  list: (organizationId: string, cursor?: string) => unwrap<LineFailurePage>(apiClient.get('/telephony/line-failures', {
    headers: { 'x-workspace-id': organizationId }, params: { limit: 20, ...(cursor ? { cursor } : {}) },
  })),
};
