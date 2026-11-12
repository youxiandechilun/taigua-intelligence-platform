/*
 * 中文导读：从当前有效成员和角色判断话术管理权限；增删改话术需要管理员权限。
 */
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb, Scope } from '../crm/crm.service.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
/* 中文注释：读取有效成员和当前角色，判断是否具备统一话术管理权限。 */


// The assigned company role takes precedence over a stale legacy member role.
export async function canManageScripts(s: Scope, db: CrmDb = crmDb): Promise<boolean> {
  const row = (await db.query(`SELECT m."role", m."companyRoleId", r."presetKey", u."role" AS "userRole"
    FROM "Member" m JOIN "User" u ON u."id"=m."userId"
    JOIN "Organization" o ON o."id"=m."organizationId"
    LEFT JOIN "CompanyRole" r ON r."workspaceId"=m."organizationId" AND r."id"=m."companyRoleId"
    WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND m."deletedAt" IS NULL
      AND u."banned"=false AND u."deletedAt" IS NULL AND o."deletedAt" IS NULL`, [s.workspaceId, s.userId]))[0];
  if (!row) return false;
  const roles = (value: unknown) => String(value || '').split(',').map(part => part.trim());
  if (roles(row.userRole).includes('admin') || roles(row.role).includes('owner')) return true;
  if (row.companyRoleId) return row.presetKey === 'workspace_admin';
  return roles(row.role).includes('admin');
}
/* 中文注释：话术写操作的服务端权限关卡；未获授权时直接拒绝。 */


export async function requireScriptManager(s: Scope, db: CrmDb = crmDb): Promise<void> {
  if (!await canManageScripts(s, db)) throw new ForbiddenError('只有管理员和超级管理员可以管理话术。');
}
