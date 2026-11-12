/*
 * 中文导读：线路与语音外呼：task-deletion.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CrmDb } from '../crm/crm.service.js';
import {detachTaskPauseBatch} from './task-bulk-state.js';

// Called after locking and authorizing the task, inside the same transaction.
// deletedAt is the removal marker; task status must remain valid on older databases.
export async function softDeleteOutboundTask(db: CrmDb, workspaceId: string, id: string) {
  const cancelled=await db.query(`UPDATE "SipAttempt" SET "status"='CANCELLED',"finishedAt"=NOW(),
    "result"='{"reason":"任务已删除，取消后续拨号"}'::jsonb
    WHERE "workspaceId"=$1 AND "taskId"=$2 AND "status"='QUEUED' RETURNING "id"`,[workspaceId,id]);
  await db.query(`UPDATE "SipTask" SET "deletedAt"=NOW(),
    "status"=CASE WHEN "status"='RUNNING' THEN 'PAUSED' ELSE "status" END,"updatedAt"=NOW()
    WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL RETURNING "id"`,[workspaceId,id]);
  await detachTaskPauseBatch(db,workspaceId,id);
  return {deleted:true,cancelledQueued:cancelled.length};
}
