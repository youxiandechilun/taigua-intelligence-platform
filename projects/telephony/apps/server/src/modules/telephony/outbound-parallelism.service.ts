/*
 * 中文导读：线路与语音外呼：outbound-parallelism.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { z } from 'zod';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { crmDb } from '../crm/crm.db.js';
import type { Scope } from '../crm/crm.service.js';
import { companyContext } from '../workspace/company-access.js';
import { taskParallelismLimit, taskParallelismLimitSchema } from './outbound-parallelism.settings.js';

const updateSchema = z.object({
  maxParallelism: taskParallelismLimitSchema,
  expectedMaxParallelism: taskParallelismLimitSchema,
}).strict();

export async function outboundParallelismPolicy(s: Scope) {
  const [limit, context] = await Promise.all([
    taskParallelismLimit(s.workspaceId), companyContext(s.workspaceId, s.userId),
  ]);
  return { maxParallelism: limit, canConfigure: context.isSystemAdmin };
}

export async function saveOutboundParallelismPolicy(s: Scope, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) {
    throw new ForbiddenError('外呼倍数上限仅系统超级管理员可以设置。');
  }
  const data = updateSchema.parse(input);
  await crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['outbound-parallelism:' + s.workspaceId]);
    const current = await taskParallelismLimit(s.workspaceId, db);
    if (current !== data.expectedMaxParallelism) throw new BadRequestError('外呼倍数上限已由其他管理员修改，请刷新后再保存。');
    await db.query(`INSERT INTO "WorkspaceCallPolicy" ("workspaceId","settings") VALUES ($1,jsonb_build_object('outboundParallelism',jsonb_build_object('maxParallelism',$2::int)))
      ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=COALESCE("WorkspaceCallPolicy"."settings",'{}'::jsonb)||jsonb_build_object('outboundParallelism',jsonb_build_object('maxParallelism',$2::int)),"updatedAt"=NOW() RETURNING "workspaceId"`, [s.workspaceId, data.maxParallelism]);
  });
  await recordAuditEvent({ organizationId: s.workspaceId, userId: s.userId, action: 'outbound.parallelism_policy.updated', resourceType: 'WorkspaceCallPolicy', resourceId: s.workspaceId, metadata: { previousMaxParallelism: data.expectedMaxParallelism, maxParallelism: data.maxParallelism } });
  return outboundParallelismPolicy(s);
}
