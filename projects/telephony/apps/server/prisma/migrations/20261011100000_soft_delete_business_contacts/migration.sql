-- 中文导读：数据库迁移：20261011100000_soft_delete_business_contacts。记录这一版本的表结构或数据规则变更。
ALTER TABLE "BusinessContact" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "BusinessContact_deleted_scope_idx" ON "BusinessContact" ("organizationId", "ownerId", "deletedAt", "updatedAt");
