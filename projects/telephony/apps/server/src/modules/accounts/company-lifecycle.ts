/*
 * 中文导读：员工账号：company-lifecycle.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { randomUUID } from "node:crypto";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import type { CrmDb } from "../crm/crm.service.js";

type Actor = { actorId: string; organizationId: string; activeOrganizationId?: string | null };
type Company = { id: string; name: string; deletedAt: Date | null; recycleState: unknown };

// External connections and unsettled work must be handled before archiving.
// Historical customers, employees, digital employees and results are retained.
const blockers = [
  ['SipAttempt', 'workspaceId', '"status" IN (\'QUEUED\',\'DISPATCHING\',\'DIALING\',\'CONNECTED\',\'NEEDS_REVIEW\')', '待处理或进行中的通话'],
  ['SipTask', 'workspaceId', '"status" IN (\'RUNNING\',\'NEEDS_REVIEW\')', '正在运行的通话任务'],
  ['CallLog', 'organizationId', '"status"::text IN (\'SCHEDULED\',\'IN_PROGRESS\')', '未结束的通话'],
  ['OutboundCall', 'organizationId', '"status"::text IN (\'SCHEDULED\',\'PROCESSED\',\'IN_PROGRESS\')', '待执行的外呼'],
  ['Campaign', 'organizationId', '"status"::text IN (\'SCHEDULED\',\'PROCESSED\',\'ACTIVE\')', '未结束的外呼任务'],
  ['AliyunTask', 'organizationId', '"status" NOT IN (\'DRAFT\',\'COMPLETED\',\'FAILED\',\'CANCELLED\',\'STOPPED\',\'CANCELED\')', '未结束的云通话任务'],
  ['AutomationRun', 'organizationId', '"status"=\'RUNNING\'', '正在执行的自动任务'],
  ['LeadSearchJob', 'organizationId', '"status"=\'SEARCHING\'', '正在搜索的线索'],
  ['KnowledgeSource', 'organizationId', '"status"::text=\'PROCESSING\'', '正在处理的知识文件'],
  ['AgentWidgetSession', 'organizationId', '"status"::text IN (\'CREATED\',\'ACTIVE\')', '未结束的网页通话'],
  ['WecomNotificationDelivery', 'organizationId', '"status"=\'SENDING\'', '正在发送的通知'],
  ['SipConnection', 'workspaceId', 'true', '通信线路连接'],
  ['SipRegionalLine', 'workspaceId', 'true', '省份通信线路'],
  ['AliyunConnection', 'organizationId', 'true', '云通话连接'],
  ['WecomConnection', 'organizationId', 'true', '企业微信连接'],
  ['PhoneNumber', 'organizationId', 'true', '使用中的主叫号码'],
  ['AutomationLearningDraft', 'organizationId', '"deletedAt" IS NULL', '自定义工作流（请先移入工作流回收站）'],
  ['BillingAccount', 'organizationId', '"paidBalanceMicros"<>0 OR "promotionalBalanceMicros"<>0 OR "reservedPaidMicros"<>0 OR "reservedPromotionalMicros"<>0 OR "debtMicros"<>0 OR "autoRechargeEnabled"=true', '待处理的账户余额或自动充值'],
  ['BillingReservation', 'organizationId', '"status"::text=\'ACTIVE\'', '未结算的费用'],
  ['TopUp', 'organizationId', '"status"::text NOT IN (\'SUCCEEDED\',\'COMPLETED\',\'FAILED\',\'CANCELLED\',\'CANCELED\',\'EXPIRED\')', '未结束的充值'],
  ['Subscription', 'referenceId', '"status" NOT IN (\'canceled\',\'incomplete_expired\')', '未结束的订阅'],
] as const;

async function lockCompany(db: CrmDb, actor: Actor) {
  const user = (await db.query('SELECT "role","banned","deletedAt" FROM "User" WHERE "id"=$1 FOR UPDATE', [actor.actorId]))[0];
  if (!user || user.banned || user.deletedAt || !String(user.role ?? "").split(",").some(role => role.trim() === "admin")) {
    throw new ForbiddenError("只有超级管理员可以删除或恢复公司工作区。");
  }
  const company = (await db.query('SELECT "id","name","deletedAt","recycleState" FROM "Organization" WHERE "id"=$1 FOR UPDATE', [actor.organizationId]))[0] as Company | undefined;
  if (!company) throw new BadRequestError("公司工作区不存在。");
  return company;
}

async function audit(db: CrmDb, actor: Actor, action: string) {
  await db.query('INSERT INTO "AuditLog" ("auditLogId","organizationId","userId","action","resourceType","resourceId","metadata","createdAt") VALUES ($1,$2,$3,$4,\'organization\',$2,\'{}\'::jsonb,NOW()) RETURNING "auditLogId"', [randomUUID(), actor.organizationId, actor.actorId, action]);
}

export async function deleteCompany(db: CrmDb, actor: Actor & { confirmationName: string }) {
  return db.transaction(async tx => {
    const company = await lockCompany(tx, actor);
    if (actor.organizationId === actor.activeOrganizationId) throw new BadRequestError("当前正在使用的公司不能删除，请先切换到其他公司。");
    if (actor.confirmationName.trim() !== company.name) throw new BadRequestError("请输入完整的公司工作区名称确认删除。");
    if (company.deletedAt) return { id: company.id, name: company.name, deleted: true };
    if (!(await tx.query('SELECT "id" FROM "Organization" WHERE "id"<>$1 AND "deletedAt" IS NULL LIMIT 1', [company.id])).length) {
      throw new BadRequestError("至少需要保留一个正常使用的公司工作区。");
    }

    // Coordinate the guard with worker claims. Busy companies fail safely;
    // archiving never interrupts an active call, search, or automation request.
    await tx.query("SET LOCAL lock_timeout = '3s'");
    await tx.query('LOCK TABLE "SipAttempt","SipTask","CallLog","OutboundCall","Campaign","AliyunTask","AutomationRun","LeadSearchJob","KnowledgeSource","AgentWidgetSession","WecomNotificationDelivery" IN SHARE ROW EXCLUSIVE MODE');
    const reasons = await tx.query(blockers.map(([table, key, condition], index) => `SELECT ${index} AS "blocker" WHERE EXISTS (SELECT 1 FROM "${table}" WHERE "${key}"=$1 AND (${condition}))`).join(' UNION ALL '), [company.id]);
    if (reasons.length) throw new BadRequestError("请先处理该工作区的：" + reasons.map(row => blockers[Number(row.blocker)]![3]).join("、") + "。");

    const members = await tx.query('SELECT "id" FROM "Member" WHERE "organizationId"=$1 AND "enabled"=true AND "deletedAt" IS NULL FOR UPDATE', [company.id]);
    const recycleState = { version: 1, enabledMemberIds: members.map(member => member.id) };
    await tx.query('UPDATE "Organization" SET "deletedAt"=NOW(),"deletedById"=$2,"recycleState"=$3::jsonb WHERE "id"=$1 RETURNING "id"', [company.id, actor.actorId, JSON.stringify(recycleState)]);
    await tx.query('UPDATE "Member" SET "enabled"=false WHERE "organizationId"=$1 RETURNING "id"', [company.id]);
    await tx.query('DELETE FROM "Session" WHERE "activeOrganizationId"=$1 RETURNING "id"', [company.id]);
    await tx.query('UPDATE "AutomationRule" SET "enabled"=false,"updatedAt"=NOW() WHERE "organizationId"=$1 RETURNING "id"', [company.id]);
    await tx.query('UPDATE "PersonalAutomationRule" SET "enabled"=false,"updatedAt"=NOW() WHERE "organizationId"=$1 RETURNING "id"', [company.id]);
    await tx.query('UPDATE "AutomationRun" SET "status"=\'FAILED\',"error"=\'公司工作区已删除，任务已停止\',"tokenHash"=NULL,"leaseUntil"=NULL,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "status"=\'QUEUED\' RETURNING "id"', [company.id]);
    await tx.query('UPDATE "SipSeat" SET "available"=false WHERE "workspaceId"=$1 RETURNING "userId"', [company.id]);
    await tx.query('UPDATE "AgentWidget" SET "enabled"=false WHERE "organizationId"=$1 RETURNING "widgetId"', [company.id]);
    await tx.query('UPDATE "Apikey" SET "enabled"=false,"updatedAt"=NOW() WHERE "referenceId"=$1 RETURNING "id"', [company.id]);
    await tx.query('UPDATE "Invitation" SET "status"=\'canceled\' WHERE "organizationId"=$1 AND "status"=\'pending\' RETURNING "id"', [company.id]);
    await audit(tx, actor, "company.workspace.deleted");
    return { id: company.id, name: company.name, deleted: true };
  });
}

export async function restoreCompany(db: CrmDb, actor: Actor) {
  return db.transaction(async tx => {
    const company = await lockCompany(tx, actor);
    if (!company.deletedAt) throw new BadRequestError("该工作区不在回收站中。");
    const state = company.recycleState as { version?: number; enabledMemberIds?: unknown } | null;
    if (state?.version !== 1 || !Array.isArray(state.enabledMemberIds) || !state.enabledMemberIds.every(id => typeof id === "string")) {
      throw new BadRequestError("工作区恢复记录不完整，请联系技术人员核对。");
    }
    await tx.query('UPDATE "Organization" SET "deletedAt"=NULL,"deletedById"=NULL,"recycleState"=NULL WHERE "id"=$1 RETURNING "id"', [company.id]);
    await tx.query('UPDATE "Member" m SET "enabled"=true FROM "User" u WHERE m."organizationId"=$1 AND m."id"=ANY($2::text[]) AND m."userId"=u."id" AND m."deletedAt" IS NULL AND u."deletedAt" IS NULL AND u."banned"=false RETURNING m."id"', [company.id, state.enabledMemberIds]);
    // Credentials, reception availability and automatic execution stay off.
    // Recovery restores records and previous membership, never starts calls.
    await audit(tx, actor, "company.workspace.restored");
    return { id: company.id, name: company.name, restored: true };
  });
}
