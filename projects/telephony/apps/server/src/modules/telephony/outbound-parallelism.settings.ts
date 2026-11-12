/*
 * 中文导读：线路与语音外呼：outbound-parallelism.settings.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb } from '../crm/crm.service.js';

export const maximumTaskParallelism = 6;
export const taskParallelismLimitSchema = z.number().int().min(1).max(maximumTaskParallelism);

// Select only this workspace's policy. The other call rules share this JSON
// document, so writes must merge this key rather than replace the document.
export async function taskParallelismLimit(workspaceId: string, db: CrmDb = crmDb) {
  const row = (await db.query(`SELECT "settings"->'outboundParallelism'->'maxParallelism' AS "maxParallelism" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1`, [workspaceId]))[0];
  const value = taskParallelismLimitSchema.safeParse(row?.maxParallelism);
  return value.success ? value.data : maximumTaskParallelism;
}

export async function assertTaskParallelism(workspaceId: string, value: number, db: CrmDb) {
  const limit = await taskParallelismLimit(workspaceId, db);
  if (!Number.isInteger(value) || value < 1 || value > limit) {
    throw new BadRequestError(`当前工作区最多允许 ${limit} 倍外呼，请重新选择。`);
  }
}
