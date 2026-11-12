-- 中文导读：数据库迁移：20261017110000_company_announcements_utc。记录这一版本的表结构或数据规则变更。
-- Prisma represents timestamp-without-time-zone values as UTC. Use UTC
-- explicitly so database sessions in Asia/Shanghai do not shift schedules.
ALTER TABLE "WorkspaceAnnouncement"
 ALTER COLUMN "startsAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 ALTER COLUMN "updatedAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

-- Only untouched legacy imports used database-local defaults. Their actual
-- import instant is recorded independently in the migration ledger.
UPDATE "WorkspaceAnnouncement" AS announcement
SET "startsAt" = imported.at,
    "createdAt" = imported.at,
    "updatedAt" = imported.at,
    "stoppedAt" = CASE WHEN announcement."stoppedAt" IS NULL THEN NULL ELSE imported.at END
FROM (
 SELECT ("started_at" AT TIME ZONE 'UTC')::timestamp(3) AS at
 FROM "_prisma_migrations"
 WHERE "migration_name" = '20261017103000_company_announcements'
   AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
 ORDER BY "finished_at" DESC LIMIT 1
) AS imported
WHERE announcement."requestId" = 'legacy-dashboard-announcement'
  AND announcement."createdById" IS NULL
  AND announcement."deletedAt" IS NULL
  AND announcement."updatedAt" = announcement."createdAt";
