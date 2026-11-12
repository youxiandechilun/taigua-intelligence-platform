/*
 * 中文导读：外呼倍数与任务、线路槽位检查；页面可选倍数和实际容量是不同约束。
 */
import {withinCallLimit} from './call-limits.js';
import { z } from 'zod';
import type { CrmDb, Row } from '../crm/crm.service.js';
import { maximumTaskParallelism, taskParallelismLimit } from './outbound-parallelism.settings.js';

const historicalParallelismSchema = z.number().int().min(1, '外呼倍数至少为1。');
export const parallelismSchema = historicalParallelismSchema.max(maximumTaskParallelism, '外呼倍数最多为6，请选择1至6倍。');
export const parallelismUpdateSchema = z.object({ parallelism: parallelismSchema, expectedParallelism: historicalParallelismSchema }).strict();
// Keep the stored value for history and optimistic updates. Dispatch applies
// the current workspace limit separately, including to older 5/6x tasks.
export function taskParallelism(snapshot: Row): number {
  return historicalParallelismSchema.parse(snapshot.parallelism ?? Math.max(1, snapshot.line?.concurrency || 1));
}

// The caller holds the SipTask row lock. Count reservations as well as connected
// calls, so multiple workers and retries cannot take the same slot or recipient.
export async function hasTaskSlot(db: CrmDb, attempt: Row) {
  const active = await db.query(`SELECT "recipientIndex" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 AND ("status" IN ('DISPATCHING','DIALING','CONNECTED') OR ("status"='NEEDS_REVIEW' AND "leaseUntil">NOW()))`, [attempt.workspaceId, attempt.taskId]);
  const requested = taskParallelism(attempt.snapshot);
  const effective = attempt.snapshot.mode === 'MANUAL' ? requested : Math.min(requested, await taskParallelismLimit(attempt.workspaceId, db));
  return active.length < effective && !active.some(row => row.recipientIndex === attempt.recipientIndex);
}

// A physical trunk is shared by tasks, accounts and workspaces. Manual bridging
// reserves two provider channels; an AI call reserves one. Call under its lock.
export async function hasLineSlot(db: CrmDb, line: { trunkKey: string; concurrency: number }) {
  const used = (await db.query(`SELECT COALESCE(sum(CASE WHEN t."snapshot"->>'mode'='MANUAL' THEN 2 ELSE 1 END),0)::int AS count FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."trunkKey"=$1 AND (a."status" IN ('DISPATCHING','DIALING','CONNECTED') OR (a."status"='NEEDS_REVIEW' AND a."leaseUntil">NOW()))`, [line.trunkKey]))[0]?.count || 0;
  const handoffs=await handoffChannels(db,line.trunkKey);
  return withinCallLimit(line.concurrency,used+handoffs);
}
// An uncertain reservation stays occupied while its parent call is active; a
// delayed acknowledgement must never make a still-ringing seat appear free.
export async function handoffChannels(db:CrmDb,trunkKey:string){
 return Number((await db.query(`SELECT COUNT(*)::int count FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE a."trunkKey"=$1 AND h.status IN ('RESERVED','CONNECTED') AND (a.status IN ('DISPATCHING','DIALING','CONNECTED') OR (a.status='NEEDS_REVIEW' AND a."leaseUntil">NOW()))`,[trunkKey]))[0]?.count||0);
}
export async function recentHandoffDials(db:CrmDb,trunkKey:string){
 return Number((await db.query(`SELECT COUNT(*)::int count FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE a."trunkKey"=$1 AND h."createdAt">NOW()-INTERVAL '1 second'`,[trunkKey]))[0]?.count||0);
}
