/*
 * 中文导读：既有验证代码：company-lifecycle.test 的输入、输出及边界场景。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { deleteCompany, restoreCompany } from '../../src/modules/accounts/company-lifecycle.js';
import type { CrmDb } from '../../src/modules/crm/crm.service.js';

const actor = { actorId: 'super', organizationId: 'test-company', activeOrganizationId: 'live-company', confirmationName: '测试账号的工作区' };

async function fixture() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "User" (id text PRIMARY KEY, role text, banned boolean DEFAULT false, "deletedAt" timestamp);
    CREATE TABLE "Organization" (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE "Member" (id text PRIMARY KEY, "organizationId" text REFERENCES "Organization"(id), "userId" text REFERENCES "User"(id), enabled boolean, "deletedAt" timestamp);
    CREATE TABLE "Session" (id text PRIMARY KEY, "activeOrganizationId" text);
    CREATE TABLE "AutomationRule" (id text PRIMARY KEY, "organizationId" text, enabled boolean, "updatedAt" timestamp);
    CREATE TABLE "PersonalAutomationRule" (LIKE "AutomationRule" INCLUDING ALL);
    CREATE TABLE "AutomationRun" (id text PRIMARY KEY, "organizationId" text, status text, error text DEFAULT '', "tokenHash" text, "leaseUntil" timestamp, "updatedAt" timestamp);
    CREATE TABLE "SipSeat" ("workspaceId" text, "userId" text, available boolean);
    CREATE TABLE "AgentWidget" ("widgetId" text PRIMARY KEY, "organizationId" text, enabled boolean);
    CREATE TABLE "Apikey" (id text PRIMARY KEY, "referenceId" text, enabled boolean, "updatedAt" timestamp);
    CREATE TABLE "Invitation" (id text PRIMARY KEY, "organizationId" text, status text);
    CREATE TABLE "AuditLog" ("auditLogId" text PRIMARY KEY, "organizationId" text, "userId" text, action text, "resourceType" text, "resourceId" text, metadata jsonb, "createdAt" timestamp);
    CREATE TABLE "Agent" ("agentId" text, "organizationId" text);
    CREATE TABLE "CrmCompany" (id text, "workspaceId" text);
    CREATE TABLE "SipAttempt" (id text, "workspaceId" text, status text);
    CREATE TABLE "SipTask" (id text, "workspaceId" text, status text);
    CREATE TABLE "CallLog" ("organizationId" text, status text);
    CREATE TABLE "OutboundCall" ("organizationId" text, status text);
    CREATE TABLE "Campaign" ("organizationId" text, status text);
    CREATE TABLE "AliyunTask" ("organizationId" text, status text);
    CREATE TABLE "LeadSearchJob" ("organizationId" text, status text);
    CREATE TABLE "KnowledgeSource" ("organizationId" text, status text);
    CREATE TABLE "AgentWidgetSession" ("organizationId" text, status text);
    CREATE TABLE "WecomNotificationDelivery" ("organizationId" text, status text);
    CREATE TABLE "SipConnection" ("workspaceId" text);
    CREATE TABLE "SipRegionalLine" ("workspaceId" text);
    CREATE TABLE "AliyunConnection" ("organizationId" text);
    CREATE TABLE "WecomConnection" ("organizationId" text);
    CREATE TABLE "PhoneNumber" ("organizationId" text);
    CREATE TABLE "AutomationLearningDraft" ("organizationId" text, "deletedAt" timestamp);
    CREATE TABLE "BillingAccount" ("organizationId" text, "paidBalanceMicros" bigint DEFAULT 0, "promotionalBalanceMicros" bigint DEFAULT 0, "reservedPaidMicros" bigint DEFAULT 0, "reservedPromotionalMicros" bigint DEFAULT 0, "debtMicros" bigint DEFAULT 0, "autoRechargeEnabled" boolean DEFAULT false);
    CREATE TABLE "BillingReservation" ("organizationId" text, status text);
    CREATE TABLE "TopUp" ("organizationId" text, status text);
    CREATE TABLE "Subscription" ("referenceId" text, status text);
  `);
  await pg.exec(readFileSync(new URL('../../prisma/migrations/20261015110000_workspace_recycle/migration.sql', import.meta.url), 'utf8'));
  await pg.exec(`
    INSERT INTO "User" (id,role) VALUES ('super','admin'),('employee','user'),('disabled','user'),('deleted-member','user'),('banned','user');
    UPDATE "User" SET banned=true WHERE id='banned';
    INSERT INTO "Organization" (id,name) VALUES ('live-company','泰卦外贸'),('test-company','测试账号的工作区');
    INSERT INTO "Member" VALUES ('live-owner','live-company','super',true,NULL),('test-owner','test-company','employee',true,NULL),('test-disabled','test-company','disabled',false,NULL),('test-deleted','test-company','deleted-member',true,NOW()),('test-banned','test-company','banned',true,NULL);
    INSERT INTO "Session" VALUES ('live-session','live-company'),('test-session','test-company');
    INSERT INTO "AutomationRule" VALUES ('live-rule','live-company',true,NOW()),('test-rule','test-company',true,NOW());
    INSERT INTO "PersonalAutomationRule" VALUES ('personal','test-company',true,NOW());
    INSERT INTO "AutomationRun" (id,"organizationId",status) VALUES ('queued','test-company','QUEUED'),('history','test-company','SUCCESS');
    INSERT INTO "SipSeat" VALUES ('live-company','super',true),('test-company','employee',true);
    INSERT INTO "AgentWidget" VALUES ('test-widget','test-company',true),('live-widget','live-company',true);
    INSERT INTO "Apikey" VALUES ('test-key','test-company',true,NOW()),('live-key','live-company',true,NOW());
    INSERT INTO "Invitation" VALUES ('invite','test-company','pending');
    INSERT INTO "Agent" VALUES ('test-agent','test-company'),('live-agent','live-company');
    INSERT INTO "CrmCompany" VALUES ('customer','test-company');
    INSERT INTO "BillingAccount" ("organizationId") VALUES ('test-company'),('live-company');
  `);
  const dbFor = (source: Pick<PGlite, 'query'>): CrmDb => ({
    query: async (sql, values = []) => (await source.query<Record<string, any>>(sql, values)).rows,
    transaction: async fn => pg.transaction(tx => fn(dbFor(tx))),
  });
  return { pg, db: dbFor(pg), row: async (sql: string) => (await pg.query<Record<string, any>>(sql)).rows[0] };
}

test('recoverable deletion retains business data, stops execution, revokes only target sessions and membership', async () => {
  const { pg, db, row } = await fixture();
  try {
    assert.equal((await deleteCompany(db, actor)).deleted, true);
    assert.ok((await row(`SELECT "deletedAt" FROM "Organization" WHERE id='test-company'`))?.deletedAt);
    assert.equal((await row(`SELECT count(*)::int n FROM "Member" WHERE "organizationId"='test-company' AND enabled`))?.n, 0);
    assert.equal((await row(`SELECT count(*)::int n FROM "Session" WHERE "activeOrganizationId"='test-company'`))?.n, 0);
    assert.equal((await row(`SELECT status FROM "AutomationRun" WHERE id='queued'`))?.status, 'FAILED');
    assert.equal((await row(`SELECT status FROM "AutomationRun" WHERE id='history'`))?.status, 'SUCCESS');
    for (const table of ['AutomationRule','PersonalAutomationRule','AgentWidget']) assert.equal((await row(`SELECT count(*)::int n FROM "${table}" WHERE "organizationId"='test-company' AND enabled`))?.n, 0);
    assert.equal((await row(`SELECT available FROM "SipSeat" WHERE "workspaceId"='test-company'`))?.available, false);
    assert.equal((await row(`SELECT enabled FROM "Apikey" WHERE id='test-key'`))?.enabled, false);
    assert.equal((await row(`SELECT count(*)::int n FROM "Agent" WHERE "organizationId"='test-company'`))?.n, 1);
    assert.equal((await row(`SELECT count(*)::int n FROM "CrmCompany" WHERE "workspaceId"='test-company'`))?.n, 1);
    assert.equal((await row(`SELECT enabled FROM "Member" WHERE id='live-owner'`))?.enabled, true);
    assert.equal((await row(`SELECT enabled FROM "AutomationRule" WHERE id='live-rule'`))?.enabled, true);
    assert.equal((await row(`SELECT available FROM "SipSeat" WHERE "workspaceId"='live-company'`))?.available, true);
    assert.equal((await row(`SELECT enabled FROM "Apikey" WHERE id='live-key'`))?.enabled, true);
    assert.equal((await row(`SELECT count(*)::int n FROM "Session" WHERE id='live-session'`))?.n, 1);
    assert.equal((await row(`SELECT count(*)::int n FROM "AuditLog" WHERE action='company.workspace.deleted'`))?.n, 1);
    await deleteCompany(db, actor);
    assert.equal((await row(`SELECT count(*)::int n FROM "AuditLog" WHERE action='company.workspace.deleted'`))?.n, 1, 'A repeated request must not overwrite the recovery snapshot');
    await restoreCompany(db, actor);
    assert.equal((await row(`SELECT "deletedAt" FROM "Organization" WHERE id='test-company'`))?.deletedAt, null);
    assert.equal((await row(`SELECT enabled FROM "Member" WHERE id='test-owner'`))?.enabled, true);
    for (const id of ['test-disabled','test-deleted','test-banned']) assert.equal((await row(`SELECT enabled FROM "Member" WHERE id='${id}'`))?.enabled, false, 'Recovery cannot enable previously suspended or deleted accounts');
    assert.equal((await row(`SELECT enabled FROM "AutomationRule" WHERE id='test-rule'`))?.enabled, false);
    assert.equal((await row(`SELECT available FROM "SipSeat" WHERE "workspaceId"='test-company'`))?.available, false);
    assert.equal((await row(`SELECT enabled FROM "Apikey" WHERE id='test-key'`))?.enabled, false);
    await assert.rejects(restoreCompany(db, actor), /不在回收站/);
  } finally { await pg.close(); }
});

test('company administrators cannot delete or restore a workspace; current and final companies are protected', async () => {
  const { pg, db } = await fixture();
  try {
    await assert.rejects(deleteCompany(db, { ...actor, actorId: 'employee' }), /只有超级管理员/);
    await assert.rejects(restoreCompany(db, { ...actor, actorId: 'employee' }), /只有超级管理员/);
    await assert.rejects(deleteCompany(db, { ...actor, activeOrganizationId: 'test-company' }), /当前正在使用/);
    await assert.rejects(deleteCompany(db, { ...actor, confirmationName: '测试' }), /完整/);
    await pg.exec(`UPDATE "Organization" SET "deletedAt"=NOW() WHERE id='live-company'`);
    await assert.rejects(deleteCompany(db, actor), /至少需要保留/);
  } finally { await pg.close(); }
});

test('active calls, executing jobs, external connections and unsettled funds block deletion', async () => {
  const { pg, db, row } = await fixture();
  const cases = [
    ['SipAttempt', `INSERT INTO "SipAttempt" VALUES ('active','test-company','CONNECTED')`, /通话/],
    ['AutomationRun', `INSERT INTO "AutomationRun" (id,"organizationId",status) VALUES ('active','test-company','RUNNING')`, /自动任务/],
    ['LeadSearchJob', `INSERT INTO "LeadSearchJob" VALUES ('test-company','SEARCHING')`, /搜索/],
    ['SipConnection', `INSERT INTO "SipConnection" VALUES ('test-company')`, /通信线路连接/],
    ['WecomConnection', `INSERT INTO "WecomConnection" VALUES ('test-company')`, /企业微信连接/],
  ] as const;
  try {
    for (const [table, sql, message] of cases) {
      await pg.exec(sql);
      await assert.rejects(deleteCompany(db, actor), message);
      assert.equal((await row(`SELECT "deletedAt" FROM "Organization" WHERE id='test-company'`))?.deletedAt, null);
      await pg.exec(`DELETE FROM "${table}" WHERE ${table === 'AutomationRun' || table === 'SipAttempt' ? 'id=\'active\'' : 'true'}`);
    }
    await pg.exec(`UPDATE "BillingAccount" SET "paidBalanceMicros"=1 WHERE "organizationId"='test-company'`);
    await assert.rejects(deleteCompany(db, actor), /余额/);
    assert.equal((await row(`SELECT enabled FROM "Member" WHERE id='test-owner'`))?.enabled, true);
  } finally { await pg.close(); }
});

test('audit failure rolls back the entire deletion and restores session and automation state', async () => {
  const { pg, db, row } = await fixture();
  try {
    await pg.exec(`ALTER TABLE "AuditLog" ADD CONSTRAINT force_failure CHECK (action <> 'company.workspace.deleted')`);
    await assert.rejects(deleteCompany(db, actor));
    assert.equal((await row(`SELECT "deletedAt" FROM "Organization" WHERE id='test-company'`))?.deletedAt, null);
    assert.equal((await row(`SELECT enabled FROM "Member" WHERE id='test-owner'`))?.enabled, true);
    assert.equal((await row(`SELECT count(*)::int n FROM "Session" WHERE id='test-session'`))?.n, 1);
    assert.equal((await row(`SELECT status FROM "AutomationRun" WHERE id='queued'`))?.status, 'QUEUED');
    assert.equal((await row(`SELECT enabled FROM "Apikey" WHERE id='test-key'`))?.enabled, true);
  } finally { await pg.close(); }
});
