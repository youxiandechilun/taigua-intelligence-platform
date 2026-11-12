/*
 * 中文导读：线路与语音外呼：task-creation.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash, randomUUID } from 'node:crypto';
import { BadRequestError } from '../../common/errors/badRequest.js';
import type { CrmDb, Row, Scope } from '../crm/crm.service.js';
import { assertTaskParallelism } from './outbound-parallelism.settings.js';

type DraftInput = {
  requestId?: string; agentId: string; name: string; recipients: unknown[];
  startTime: string; endTime: string;
};

function fingerprint(input: DraftInput) {
  const { requestId: _requestId, ...payload } = input;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function requestedTask(db: CrmDb, scope: Scope, input: DraftInput) {
  if (!input.requestId) return null;
  const row = (await db.query('SELECT "id","workspaceId","createdBy","status","deletedAt","snapshot" FROM "SipTask" WHERE "id"=$1', [input.requestId]))[0];
  if (!row) return null;
  if (row.workspaceId !== scope.workspaceId || row.createdBy !== scope.userId || row.deletedAt || row.snapshot.creationFingerprint !== fingerprint(input)) {
    throw new BadRequestError('此次创建请求已被使用，请刷新页面后重新创建。');
  }
  return { id: row.id as string, status: row.status as string, ...(row.snapshot.carrierCheck?.summary || {}) };
}

export async function storeTaskDraft(db: CrmDb, scope: Scope, input: DraftInput, snapshot: Row) {
  if (snapshot.mode !== 'MANUAL') await assertTaskParallelism(scope.workspaceId, snapshot.parallelism ?? 1, db);
  const id = input.requestId || randomUUID();
  const frozen = input.requestId ? { ...snapshot, creationFingerprint: fingerprint(input) } : snapshot;
  const row = (await db.query('INSERT INTO "SipTask" ("id","workspaceId","createdBy","agentId","name","recipients","snapshot","startTime","endTime") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) ON CONFLICT ("id") DO NOTHING RETURNING "id","status"', [id, scope.workspaceId, scope.userId, input.agentId, input.name, JSON.stringify(input.recipients), JSON.stringify(frozen), new Date(input.startTime), new Date(input.endTime)]))[0];
  if (row) return { id: row.id as string, status: row.status as string, ...(snapshot.carrierCheck?.summary || {}) };
  const existing = await requestedTask(db, scope, input);
  if (!existing) throw new BadRequestError('创建结果待核对，请刷新任务列表。');
  return existing;
}
