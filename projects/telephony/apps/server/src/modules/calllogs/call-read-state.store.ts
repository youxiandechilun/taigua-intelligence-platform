/*
 * 中文导读：通话记录：call-read-state.store.ts。维护共享状态及读写辅助。
 */
import { NotFoundError } from '../../common/errors/notFound.js';
import type { CrmDb } from '../crm/crm.service.js';

export type CallReadState = { callId: string; readAt: string | null };

// Call visibility is checked before enrichment. Reading a shared call only
// changes this viewer's state, never the shared call metadata.
export async function withCallReadStates<T extends { callId: string }>(
  db: CrmDb,
  organizationId: string,
  viewerId: string | undefined,
  calls: T[],
): Promise<(T & { readAt: string | null })[]> {
  if (!viewerId || !calls.length) return calls.map(call => ({ ...call, readAt: null }));
  const rows = await db.query(`SELECT "callId", "readAt" FROM "CallLogReadState"
    WHERE "organizationId"=$1 AND "userId"=$2
    AND "callId" IN (SELECT jsonb_array_elements_text($3::jsonb))`,
    [organizationId, viewerId, JSON.stringify(calls.map(call => call.callId))]);
  const states = new Map(rows.map(row => [String(row.callId), new Date(row.readAt).toISOString()]));
  return calls.map(call => ({ ...call, readAt: states.get(call.callId) ?? null }));
}

// The caller verifies the viewer can access this exact call. Locking the call
// here also prevents a concurrent soft deletion from leaving a new read mark.
export async function saveCallReadState(
  db: CrmDb, organizationId: string, userId: string, callId: string, read: boolean,
): Promise<CallReadState> {
  return db.transaction(async tx => {
    const call = await tx.query(`SELECT "callId" FROM "CallLog"
      WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false FOR UPDATE`,
      [organizationId, callId]);
    if (!call.length) throw new NotFoundError('通话不存在或无权查看。');
    if (!read) {
      await tx.query(`DELETE FROM "CallLogReadState"
        WHERE "organizationId"=$1 AND "userId"=$2 AND "callId"=$3 RETURNING "callId"`,
        [organizationId, userId, callId]);
      return { callId, readAt: null };
    }
    const rows = await tx.query(`INSERT INTO "CallLogReadState" ("organizationId", "userId", "callId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("organizationId", "userId", "callId") DO UPDATE
      SET "readAt"="CallLogReadState"."readAt" RETURNING "readAt"`,
      [organizationId, userId, callId]);
    return { callId, readAt: new Date(rows[0]!.readAt).toISOString() };
  });
}
