/*
 * 中文导读：线路与语音外呼：resume-line.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';
import type { CrmDb, Row, Scope } from '../crm/crm.service.js';
import type { RedialLineOverride } from './redial-line.js';

export type ResumeLine = { override: RedialLineOverride; trunkKey: string };

// The task row is locked by the caller. Update only attempts that have never
// started so an in-flight or uncertain call cannot be redirected or repeated.
export async function switchQueuedResumeLine(db: CrmDb, scope: Scope, taskId: string, attempts: Row[], line: ResumeLine) {
  const queued = attempts.filter(attempt => attempt.status === 'QUEUED');
  if (!queued.length || queued.some(attempt => attempt.startedAt != null))
    throw new BadRequestError('待拨号码状态已变化，请刷新后重新继续。');
  const updated = await db.query(`UPDATE "SipAttempt" SET "trunkKey"=$4,
    "result"=COALESCE("result",'{}'::jsonb)||jsonb_build_object('lineOverride',$5::jsonb,'resumeLineSwitch',true)
    WHERE "workspaceId"=$1 AND "taskId"=$2 AND "id"=ANY($3::text[])
      AND "status"='QUEUED' AND "startedAt" IS NULL RETURNING "id"`,
    [scope.workspaceId, taskId, queued.map(attempt => attempt.id), line.trunkKey, JSON.stringify(line.override)]);
  if (updated.length !== queued.length) throw new BadRequestError('待拨号码状态已变化，请刷新后重新继续。');
  return updated.length;
}

// A call already in progress may schedule an automatic retry after the task
// switches lines. New retries use the task's most recently confirmed line.
export function retryRouteAfterResume(snapshot: Row, attempt: Row) {
  const selected = snapshot.resumeLine as ResumeLine | undefined;
  if (selected?.override && typeof selected.trunkKey === 'string' && selected.trunkKey)
    return { trunkKey: selected.trunkKey, result: { lineOverride: selected.override, resumeLineSwitch: true } };
  const override = attempt.result?.lineOverride;
  return { trunkKey: attempt.trunkKey, result: override ? { lineOverride: override, ...(attempt.result?.resumeLineSwitch === true ? { resumeLineSwitch: true } : {}) } : {} };
}
