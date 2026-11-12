/*
 * 中文导读：通话记录：call-owner.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CrmDb } from '../crm/crm.service.js';

type CallOwnerRecord = {
  callId: string;
  userId?: string | null;
  metadata?: unknown;
};
type CallOwner = { ownerId: string | null; ownerName: string };

// Enrich only records already authorized by the call-log repository. An exact
// attempt/task link identifies the human who created the outbound task; the
// digital agent's creator is never used as the calling employee.
export async function withCallOwners<T extends CallOwnerRecord>(
  db: CrmDb, organizationId: string, records: T[],
): Promise<(T & CallOwner)[]> {
  if (!records.length) return [];
  const requested = records.map(record => {
    const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown> : {};
    return {
      callId: record.callId,
      userId: record.userId || null,
      taskId: typeof metadata.taskId === 'string' && metadata.taskId.trim() ? metadata.taskId.trim() : null,
    };
  });
  const rows = await db.query(`SELECT l."callId",
    COALESCE(attempt_task."createdBy", metadata_task."createdBy", m."userId") AS "ownerId",
    NULLIF(btrim(u."name"), '') AS "ownerName"
    FROM jsonb_to_recordset($2::jsonb) AS requested("callId" text,"userId" text,"taskId" text)
    JOIN "CallLog" l ON l."callId"=requested."callId" AND l."organizationId"=$1 AND l."deleted"=false
    LEFT JOIN "SipAttempt" a ON a."id"=l."callId" AND a."workspaceId"=$1
    LEFT JOIN "SipTask" attempt_task ON attempt_task."id"=a."taskId" AND attempt_task."workspaceId"=$1
    LEFT JOIN "SipTask" metadata_task ON metadata_task."id"=requested."taskId" AND metadata_task."workspaceId"=$1
    LEFT JOIN "Member" m ON m."organizationId"=$1 AND m."userId"=requested."userId"
    LEFT JOIN "User" u ON u."id"=COALESCE(attempt_task."createdBy", metadata_task."createdBy", m."userId")`,
    [organizationId, JSON.stringify(requested)]);
  const owners = new Map(rows.map(row => [String(row.callId), {
    ownerId: typeof row.ownerId === 'string' ? row.ownerId : null,
    ownerName: typeof row.ownerName === 'string' && row.ownerName.trim() ? row.ownerName.trim() : '未记录员工',
  }]));
  return records.map(record => ({ ...record, ...(owners.get(record.callId) || { ownerId: null, ownerName: '未记录员工' }) }));
}
