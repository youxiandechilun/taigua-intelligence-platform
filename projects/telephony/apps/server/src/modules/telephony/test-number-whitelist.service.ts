/*
 * 中文导读：线路与语音外呼：test-number-whitelist.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import CustomApiError from '../../common/errors/customApiError.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb, Scope } from '../crm/crm.service.js';
import { notifyDemoQueued } from './sip-demo-priority.js';
import { MAX_TEST_NUMBER_ENTRIES, normalizeTestNumberPhone, testNumberWhitelistItemsSchema, writeTestNumberWhitelist, type TestNumberWhitelistItem } from './test-number-whitelist.settings.js';

const phoneSchema = z.string().trim().min(1).max(32).transform(normalizeTestNumberPhone);
const createSchema = z.object({ phoneNumber: phoneSchema, note: z.string().trim().max(200).default(''), enabled: z.boolean().default(true) }).strict();
const updateSchema = z.object({ phoneNumber: phoneSchema.optional(), note: z.string().trim().max(200).optional(), enabled: z.boolean().optional(), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict()
  .refine(data => data.phoneNumber !== undefined || data.note !== undefined || data.enabled !== undefined, '请至少修改一项配置。');
const deleteSchema = z.object({ expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict();

async function assertAdmin(db: CrmDb, scope: Scope, lock = false) {
  const actor = (await db.query(`SELECT u."role" FROM "Member" m JOIN "User" u ON u."id"=m."userId"
    JOIN "Organization" o ON o."id"=m."organizationId"
    WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND m."deletedAt" IS NULL
      AND u."banned"=false AND u."deletedAt" IS NULL AND o."deletedAt" IS NULL ${lock ? 'FOR SHARE OF m,u,o' : ''}`, [scope.workspaceId, scope.userId]))[0];
  if (!actor || !String(actor.role || '').split(',').includes('admin')) throw new ForbiddenError('测试号码白名单仅系统超级管理员可以管理。');
}

async function storedItems(workspaceId: string, db: CrmDb) {
  const row = (await db.query(`SELECT jsonb_typeof("settings") AS "rootType","settings"->'testNumberWhitelist' AS items
    FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1`, [workspaceId]))[0];
  const parsed = testNumberWhitelistItemsSchema.safeParse(row?.items ?? []);
  if (row && row.rootType !== 'object') throw new BadRequestError('测试号码配置格式异常，请先核对工作区配置。');
  if (!parsed.success) throw new BadRequestError('测试号码配置格式异常，请先核对工作区配置。');
  return parsed.data;
}
const catalog = (items: TestNumberWhitelistItem[]) => ({ canManage: true, items, maxEntries: MAX_TEST_NUMBER_ENTRIES });
const conflict = () => { throw new CustomApiError('测试号码已被修改，请刷新后重新操作。', 409); };
function verifyVersion(item: TestNumberWhitelistItem, expected: string) {
  if (Date.parse(item.updatedAt) !== Date.parse(expected)) conflict();
}
function nextTimestamp(items: TestNumberWhitelistItem[]) {
  return new Date(Math.max(Date.now(), ...items.map(item => Date.parse(item.updatedAt) + 1))).toISOString();
}
async function mutate(scope: Scope, action: string, change: (items: TestNumberWhitelistItem[]) => { items: TestNumberWhitelistItem[]; item: TestNumberWhitelistItem }) {
  const result = await crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['test-number-whitelist:' + scope.workspaceId]);
    await assertAdmin(db, scope, true);
    const result = change(await storedItems(scope.workspaceId, db));
    await writeTestNumberWhitelist(scope.workspaceId, result.items, db);
    return result;
  });
  notifyDemoQueued();
  await recordAuditEvent({ organizationId: scope.workspaceId, userId: scope.userId, action: 'telephony.test-number.' + action, resourceType: 'WorkspaceModelSettings', resourceId: result.item.id, metadata: { phoneNumber: result.item.phoneNumber, enabled: result.item.enabled } });
  return catalog(result.items);
}

export async function testNumberWhitelistCatalog(scope: Scope) {
  await assertAdmin(crmDb, scope);
  return catalog(await storedItems(scope.workspaceId, crmDb));
}
export async function createTestNumberWhitelistItem(scope: Scope, raw: unknown) {
  const data = createSchema.parse(raw);
  return mutate(scope, 'created', items => {
    if (items.some(item => item.phoneNumber === data.phoneNumber)) throw new BadRequestError('这个号码已在测试白名单中，请直接编辑现有记录。');
    if (items.length >= MAX_TEST_NUMBER_ENTRIES) throw new BadRequestError('测试号码最多保存100个，请先移除不再使用的号码。');
    const timestamp = nextTimestamp(items), item = { id: randomUUID(), ...data, createdAt: timestamp, updatedAt: timestamp };
    return { items: [item, ...items], item };
  });
}
export async function updateTestNumberWhitelistItem(scope: Scope, id: string, raw: unknown) {
  const data = updateSchema.parse(raw);
  return mutate(scope, 'updated', items => {
    const existing = items.find(item => item.id === id);
    if (!existing) throw new NotFoundError('测试号码不存在或已被移除。');
    verifyVersion(existing, data.expectedUpdatedAt);
    if (data.phoneNumber !== undefined && items.some(item => item.id !== id && item.phoneNumber === data.phoneNumber)) throw new BadRequestError('这个号码已在测试白名单中。');
    const item = { ...existing,
      ...(data.phoneNumber !== undefined ? { phoneNumber: data.phoneNumber } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      updatedAt: nextTimestamp(items) };
    return { items: items.map(current => current.id === id ? item : current), item };
  });
}
export async function deleteTestNumberWhitelistItem(scope: Scope, id: string, raw: unknown) {
  const data = deleteSchema.parse(raw);
  return mutate(scope, 'deleted', items => {
    const item = items.find(item => item.id === id);
    if (!item) throw new NotFoundError('测试号码不存在或已被移除。');
    verifyVersion(item, data.expectedUpdatedAt);
    return { items: items.filter(current => current.id !== id), item };
  });
}
