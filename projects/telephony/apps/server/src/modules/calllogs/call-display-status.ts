/*
 * 中文导读：通话记录：call-display-status.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CrmDb } from '../crm/crm.service.js';

// Read projection only: provider result uncertainty is not a completed or failed call.
// Keep the persisted CallLog status available without changing attempts or dispatch.
export const CALL_REVIEW_STATUS = 'NEEDS_REVIEW';
export type CallWithDisplayStatus<T extends { status: string }> = Omit<T, 'status'> & {
  status: T['status'] | typeof CALL_REVIEW_STATUS;
  rawStatus?: string;
  statusLabel?: string;
  requiresReview?: boolean;
};
export async function withCallDisplayStatus<T extends { callId: string; status: string }>(db: CrmDb, workspaceId: string, calls: T[]): Promise<CallWithDisplayStatus<T>[]> {
  const ids = [...new Set(calls.filter(call => call.status === 'IN_PROGRESS').map(call => call.callId))];
  if (!ids.length)
    return calls;
  const rows = await db.query('SELECT "id" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) AND "status"=\'NEEDS_REVIEW\'', [workspaceId, ids]);
  const reviewIds = new Set(rows.map(row => row.id));
  return calls.map(call => call.status === 'IN_PROGRESS' && reviewIds.has(call.callId) ? {
    ...call,
    rawStatus: call.status,
    status: CALL_REVIEW_STATUS,
    statusLabel: '结果待核对',
    requiresReview: true,
  } : call);
}
