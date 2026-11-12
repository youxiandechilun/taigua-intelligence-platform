/*
 * 中文导读：工作区与权限：workspace.announcements.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import type { Prisma } from '../../../prisma/generated/prisma/client.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { companyContext } from './company-access.js';

type Actor = { workspaceId: string; userId: string };
type Row = {
  id: string; workspaceId: string; text: string; color: string;
  speed: 'slow' | 'normal' | 'fast'; fontSize: number;
  startsAt: Date; endsAt: Date | null; stoppedAt: Date | null;
  deletedAt: Date | null; createdAt: Date; updatedAt: Date;
  createdById: string | null; requestId: string;
};
export const announcementInput = z.object({
  text: z.string().trim().min(1, '请填写公告内容。').max(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '文字颜色格式无效。'),
  speed: z.enum(['slow', 'normal', 'fast']),
  fontSize: z.number().int().min(12).max(24),
  startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable(),
}).strict();
export const publishAnnouncementInput = announcementInput.extend({ requestId: z.string().uuid() });
export const editAnnouncementInput = announcementInput.extend({ updatedAt: z.iso.datetime() });
export const announcementRevision = z.object({ updatedAt: z.iso.datetime() }).strict();
export const announcementListInput = z.object({
  view: z.enum(['current', 'history']).default('current'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

async function manager(s: Actor) {
  const access = await companyContext(s.workspaceId, s.userId);
  if (!access.canManageAnnouncements) throw new ForbiddenError('公告管理仅限公司管理员和超级管理员。');
}
function present(row: Row, now = Date.now()) {
  return { ...row, status: row.stoppedAt ? 'STOPPED' : row.endsAt && row.endsAt.getTime() <= now ? 'EXPIRED' : row.startsAt.getTime() > now ? 'SCHEDULED' : 'ACTIVE' };
}
function dates(input: z.infer<typeof announcementInput>, publishing: boolean) {
  const now = new Date(), startsAt = input.startsAt ? new Date(input.startsAt) : now;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && (endsAt <= startsAt || endsAt <= now)) throw new BadRequestError('结束时间须晚于开始时间和当前时间。');
  if (publishing && input.startsAt && startsAt.getTime() < now.getTime() - 60000) throw new BadRequestError('开始时间已过去，请选择立即发布或未来时间。');
  return { startsAt, endsAt };
}
async function audit(tx: Prisma.TransactionClient, s: Actor, action: string, id: string) {
  await tx.$executeRaw`INSERT INTO "AuditLog" ("auditLogId","organizationId","userId","action","resourceType","resourceId","metadata","createdAt") VALUES (${randomUUID()},${s.workspaceId},${s.userId},${action},'company-announcement',${id},'{}'::jsonb,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`;
}
async function target(tx: Prisma.TransactionClient, s: Actor, id: string, updatedAt: string) {
  const row = (await tx.$queryRaw<Row[]>`SELECT * FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "id"=${id} AND "deletedAt" IS NULL FOR UPDATE`)[0];
  if (!row) throw new NotFoundError('公告不存在或已删除。');
  if (row.updatedAt.getTime() !== new Date(updatedAt).getTime()) throw new BadRequestError('公告已被其他管理员更新，请刷新后再操作。');
  return row;
}
export async function activeAnnouncements(s: Actor) {
  const now = new Date();
  const [rows, next] = await Promise.all([
    prisma.$queryRaw<Row[]>`SELECT * FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL AND "stoppedAt" IS NULL AND "startsAt"<=${now} AND ("endsAt" IS NULL OR "endsAt">${now}) ORDER BY "startsAt" DESC,"createdAt" DESC LIMIT 100`,
    prisma.$queryRaw<{ at: Date | null }[]>`SELECT MIN(t.at) AS at FROM (SELECT "startsAt" AS at FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL AND "stoppedAt" IS NULL AND "startsAt">${now} UNION ALL SELECT "endsAt" AS at FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL AND "stoppedAt" IS NULL AND "endsAt">${now}) t`,
  ]);
  return { workspaceId: s.workspaceId, serverNow: now.toISOString(), nextChangeAt: next[0]?.at?.toISOString() ?? null,
    announcements: rows.map(({ id, text, color, speed, fontSize, startsAt, endsAt, updatedAt }) => ({ id, text, color, speed, fontSize, startsAt, endsAt, updatedAt })) };
}
export async function listAnnouncements(s: Actor, input: z.infer<typeof announcementListInput>) {
  await manager(s);
  const current = input.view === 'current';
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<Row[]>`SELECT * FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL AND ("stoppedAt" IS NULL AND ("endsAt" IS NULL OR "endsAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))=${current} ORDER BY "createdAt" DESC,"id" LIMIT 20 OFFSET ${(input.page - 1) * 20}`,
    prisma.$queryRaw<{ current: number; history: number }[]>`SELECT (COUNT(*) FILTER (WHERE "stoppedAt" IS NULL AND ("endsAt" IS NULL OR "endsAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))))::int AS current,(COUNT(*) FILTER (WHERE "stoppedAt" IS NOT NULL OR "endsAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))::int AS history FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL`,
  ]);
  return { workspaceId: s.workspaceId, rows: rows.map(row => present(row)), counts: totals[0] ?? { current: 0, history: 0 }, page: input.page, pageSize: 20 };
}
export async function publishAnnouncement(s: Actor, raw: unknown) {
  await manager(s);
  const input = publishAnnouncementInput.parse(raw);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${s.workspaceId} FOR UPDATE`;
    const prior = (await tx.$queryRaw<Row[]>`SELECT * FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "requestId"=${input.requestId}`)[0];
    if (prior) {
      if (prior.deletedAt || prior.text !== input.text || prior.color !== input.color || prior.speed !== input.speed || prior.fontSize !== input.fontSize || prior.endsAt?.toISOString() !== (input.endsAt ?? undefined) || (input.startsAt && prior.startsAt.toISOString() !== input.startsAt)) throw new BadRequestError('该发布请求已处理，请刷新列表后再新增公告。');
      return present(prior);
    }
    const { startsAt, endsAt } = dates(input, true);
    const count = await tx.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "WorkspaceAnnouncement" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL AND "stoppedAt" IS NULL AND ("endsAt" IS NULL OR "endsAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`;
    if ((count[0]?.n ?? 0) >= 100) throw new BadRequestError('当前及待播公告已满100条，请先下架不再使用的公告。');
    const row = (await tx.$queryRaw<Row[]>`INSERT INTO "WorkspaceAnnouncement" ("id","workspaceId","text","color","speed","fontSize","startsAt","endsAt","createdById","requestId") VALUES (${randomUUID()},${s.workspaceId},${input.text},${input.color},${input.speed},${input.fontSize},${startsAt},${endsAt},${s.userId},${input.requestId}) RETURNING *`)[0]!;
    await audit(tx, s, 'announcement.published', row.id);
    return present(row);
  });
}
export async function editAnnouncement(s: Actor, id: string, raw: unknown) {
  await manager(s);
  const input = editAnnouncementInput.parse(raw);
  return prisma.$transaction(async tx => {
    const row = await target(tx, s, id, input.updatedAt);
    if (row.stoppedAt || (row.endsAt && row.endsAt <= new Date())) throw new BadRequestError('历史公告请使用“再次发布”。');
    const { startsAt, endsAt } = dates(input, false);
    const updated = (await tx.$queryRaw<Row[]>`UPDATE "WorkspaceAnnouncement" SET "text"=${input.text},"color"=${input.color},"speed"=${input.speed},"fontSize"=${input.fontSize},"startsAt"=${startsAt},"endsAt"=${endsAt},"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "workspaceId"=${s.workspaceId} AND "id"=${id} RETURNING *`)[0]!;
    await audit(tx, s, 'announcement.updated', id);
    return present(updated);
  });
}
export async function stopOrDeleteAnnouncement(s: Actor, id: string, raw: unknown, remove: boolean) {
  await manager(s);
  const input = announcementRevision.parse(raw);
  return prisma.$transaction(async tx => {
    await target(tx, s, id, input.updatedAt);
    if (remove) await tx.$executeRaw`UPDATE "WorkspaceAnnouncement" SET "deletedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "workspaceId"=${s.workspaceId} AND "id"=${id}`;
    else await tx.$executeRaw`UPDATE "WorkspaceAnnouncement" SET "stoppedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "workspaceId"=${s.workspaceId} AND "id"=${id}`;
    await audit(tx, s, remove ? 'announcement.deleted' : 'announcement.stopped', id);
    return { id };
  });
}
