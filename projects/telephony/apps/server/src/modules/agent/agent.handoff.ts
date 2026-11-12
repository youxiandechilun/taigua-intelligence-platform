/*
 * 中文导读：数字员工与话术：agent.handoff.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { memberAccess, type CrmDb } from '../crm/crm.service.js';
import { customerVisibleSql, grants, scopedOwnerSql } from '../workspace/company-policy.js';

type Handoff = { enabled?: boolean; target?: string; assigneeUserId?: string | null };

export async function validateHandoff(db: CrmDb, workspaceId: string, userId: string | null | undefined, next: Handoff, previous?: Handoff, personal = false) {
  if (!next.assigneeUserId) return;
  if (!userId) throw new ForbiddenError('请登录后选择人工接管负责人。');
  const access = await memberAccess(db, { workspaceId, userId });
  if (!(personal && next.assigneeUserId === userId) && next.assigneeUserId !== previous?.assigneeUserId && !grants(access.permissions, 'crm', 'assign'))
    throw new ForbiddenError('人工接管负责人由有客户分配权限的管理员设置。');
  const member = (await db.query(`SELECT u."name",d."name" AS "departmentName" FROM "Member" m JOIN "User" u ON u."id"=m."userId" LEFT JOIN "CompanyDepartment" d ON d."id"=m."companyDepartmentId" AND d."organizationId"=m."organizationId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."banned"=false AND u."deletedAt" IS NULL AND ${scopedOwnerSql('m."userId"', '$1', '$3')}`, [workspaceId, next.assigneeUserId, userId]))[0];
  if (!member) throw new BadRequestError('接管员工已停用、删除或不在你的授权范围，请重新选择。');
  const target = await memberAccess(db, { workspaceId, userId: next.assigneeUserId });
  if (!grants(target.permissions, 'crm', 'read') || !grants(target.permissions, 'automation', 'read'))
    throw new BadRequestError('接管员工需要客户库与跟进待办的查看权限。');
  next.target = [member.departmentName, member.name].filter(Boolean).join(' / ').slice(0, 300);
}

// Never grant access while routing a task. A disabled or out-of-scope target
// falls back to an existing customer owner or caller who can see the customer.
export async function resolveHandoffOwner(db: CrmDb, workspaceId: string, handoff: Handoff | undefined, fallbackIds: Array<string | null | undefined>, companyId?: string | null) {
  const selected = handoff?.enabled ? handoff.assigneeUserId : null;
  for (const userId of [...new Set([selected, ...fallbackIds].filter((id): id is string => !!id))]) {
    const active = (await db.query(`SELECT u."name" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."banned"=false AND u."deletedAt" IS NULL`, [workspaceId, userId]))[0];
    if (!active) continue;
    const access = await memberAccess(db, { workspaceId, userId });
    if (!grants(access.permissions, companyId ? 'crm' : 'automation', 'read')) continue;
    if (companyId && !(await db.query(`SELECT c."id" FROM "CrmCompany" c WHERE c."workspaceId"=$1 AND c."id"=$2 AND c."deletedAt" IS NULL AND ${customerVisibleSql('c', '$1', '$3')}`, [workspaceId, companyId, userId])).length) continue;
    return { userId, name: active.name as string, configured: userId === selected };
  }
  return null;
}
