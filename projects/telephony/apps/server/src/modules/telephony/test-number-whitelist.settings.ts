/*
 * 中文导读：线路与语音外呼：test-number-whitelist.settings.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { mainlandPhone } from '../aliyun/aliyun.schema.js';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb } from '../crm/crm.service.js';

export const MAX_TEST_NUMBER_ENTRIES = 100;
export function normalizeTestNumberPhone(raw: string): string {
  try { return mainlandPhone(raw); }
  catch { throw new BadRequestError('请填写国内手机号或带区号的座机号码。'); }
}

const canonicalPhone = z.string().regex(/^(?:1[3-9]\d{9}|0\d{2,3}\d{7,8})$/);
export const testNumberWhitelistItemSchema = z.object({
  id: z.string().uuid(),
  phoneNumber: canonicalPhone,
  note: z.string().max(200),
  enabled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();
export type TestNumberWhitelistItem = z.infer<typeof testNumberWhitelistItemSchema>;
export const testNumberWhitelistItemsSchema = z.array(testNumberWhitelistItemSchema).max(MAX_TEST_NUMBER_ENTRIES)
  .refine(items => new Set(items.map(item => item.id)).size === items.length && new Set(items.map(item => item.phoneNumber)).size === items.length);

export async function readTestNumberWhitelist(workspaceId: string, db: CrmDb = crmDb): Promise<TestNumberWhitelistItem[]> {
  const row = (await db.query(`SELECT "settings"->'testNumberWhitelist' AS items FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1`, [workspaceId]))[0];
  const parsed = testNumberWhitelistItemsSchema.safeParse(row?.items ?? []);
  return parsed.success ? parsed.data : [];
}

export function normalizeTestNumberPhoneSql(phoneSql: string): string {
  return `regexp_replace(regexp_replace(COALESCE((${phoneSql})::text,''),'[[:space:]()-]','','g'),'^(\\+86|0086)','')`;
}
function whitelistItemsSql(settingsSql: string): string {
  const items = `(${settingsSql})->'testNumberWhitelist'`;
  return `CASE WHEN jsonb_typeof(${items})='array' THEN
      CASE WHEN jsonb_array_length(${items})<=${MAX_TEST_NUMBER_ENTRIES} THEN ${items} ELSE '[]'::jsonb END
      ELSE '[]'::jsonb END`;
}
const enabledItemSql = `test_number.item->'enabled'='true'::jsonb
  AND test_number.item->>'phoneNumber' ~ '^(1[3-9][0-9]{9}|0[0-9]{2,3}[0-9]{7,8})$'`;
// Expressions come only from server-owned SQL. Both worker priority and the
// authoritative quota check use this predicate, without a process-local cache.
export function testNumberWhitelistMatchSql(settingsSql: string, phoneSql: string): string {
  return `EXISTS (SELECT 1 FROM jsonb_array_elements(${whitelistItemsSql(settingsSql)}) AS test_number(item)
    WHERE ${enabledItemSql}
      AND test_number.item->>'phoneNumber'=(${phoneSql}))`;
}

export async function enabledTestNumberPhones(workspaceId: string, db: CrmDb = crmDb): Promise<Set<string>> {
  const rows = await db.query(`SELECT test_number.item->>'phoneNumber' AS phone
    FROM "WorkspaceModelSettings" w CROSS JOIN LATERAL jsonb_array_elements(${whitelistItemsSql('w."settings"')}) AS test_number(item)
    WHERE w."workspaceId"=$1 AND ${enabledItemSql}`, [workspaceId]);
  return new Set(rows.map(row => String(row.phone)));
}

export async function isTestNumberWhitelisted(workspaceId: string, phone: string, db: CrmDb = crmDb): Promise<boolean> {
  let normalized: string;
  try { normalized = normalizeTestNumberPhone(phone); } catch { return false; }
  const row = (await db.query(`SELECT ${testNumberWhitelistMatchSql('"settings"', '$2::text')} AS allowed
    FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1`, [workspaceId, normalized]))[0];
  return row?.allowed === true;
}

export async function writeTestNumberWhitelist(workspaceId: string, items: TestNumberWhitelistItem[], db: CrmDb) {
  testNumberWhitelistItemsSchema.parse(items);
  await db.query(`INSERT INTO "WorkspaceModelSettings" ("workspaceId","settings","updatedAt")
    VALUES ($1,jsonb_build_object('enabled','[]'::jsonb,'summaryModel',''::text,'testNumberWhitelist',$2::jsonb),NOW())
    ON CONFLICT ("workspaceId") DO UPDATE SET
      "settings"=jsonb_set("WorkspaceModelSettings"."settings",'{testNumberWhitelist}',$2::jsonb,true),"updatedAt"=NOW()
    RETURNING "workspaceId"`, [workspaceId, JSON.stringify(items)]);
}
