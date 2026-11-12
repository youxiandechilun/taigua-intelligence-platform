/*
 * 中文导读：角色与资源动作的共享权限判断。
 */
import prisma from "../config/prisma.js";
import { ForbiddenError } from "../common/errors/forbidden.js";
import {policyFromRow} from '../modules/workspace/company-policy.js';

/** Platform roles live on User; company roles live on Member. */
export type AccessLevel = {
  isSystemAdmin: boolean;
  isWorkspaceOwner: boolean;
  isCompanyAdmin: boolean;
  isEmployee: boolean;
  canManageCompany: boolean;
  canManageSystem: boolean;
};

export function isSystemAdminRole(role: string | null | undefined) {
  return (role ?? "").split(",").map((item) => item.trim()).includes("admin");
}

export function isCompanyManagerRole(role: string | null | undefined) {
  return (role ?? "").split(",").some((item) => item === "owner" || item === "admin");
}

export async function getAccessLevel(userId: string, organizationId?: string | null): Promise<AccessLevel> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, banned: true, deletedAt: true } });
  const isSystemAdmin = Boolean(user&&!user.banned&&!user.deletedAt&&isSystemAdminRole(user.role));
  const member = organizationId
    ? await prisma.member.findFirst({ where: { organizationId, userId, enabled: true, deletedAt: null, organization: { deletedAt: null }, user: { banned: false, deletedAt: null } }, include: { companyRole: true } })
    : null;
  const isWorkspaceOwner = member?.role === "owner";
  const isCompanyAdmin = Boolean(member&&policyFromRow({...member,...member.companyRole,role:member.role,userRole:user?.role}).isWorkspaceAdmin);
  return {
    isSystemAdmin,
    isWorkspaceOwner,
    isCompanyAdmin,
    isEmployee: Boolean(member) && !isCompanyAdmin && !isSystemAdmin,
    canManageCompany: isSystemAdmin || isCompanyAdmin,
    canManageSystem: isSystemAdmin,
  };
}

export async function requireSystemAdminAccess(userId: string) {
  const access = await getAccessLevel(userId);
  if (!access.canManageSystem) throw new ForbiddenError("仅系统超级管理员可以使用此功能。");
  return access;
}

export async function requireCompanyAdminAccess(userId: string, organizationId: string) {
  const access = await getAccessLevel(userId, organizationId);
  if (!access.canManageCompany) throw new ForbiddenError("仅公司管理员可以执行此操作。");
  return access;
}
