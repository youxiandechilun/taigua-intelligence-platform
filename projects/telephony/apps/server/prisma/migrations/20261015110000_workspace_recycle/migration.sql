-- 中文导读：数据库迁移：20261015110000_workspace_recycle。记录这一版本的表结构或数据规则变更。
-- Recoverable company deletion; business records and relationships are retained.
ALTER TABLE "Organization" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Organization" ADD COLUMN "recycleState" JSONB;
CREATE INDEX "Organization_deletedAt_idx" ON "Organization"("deletedAt");
