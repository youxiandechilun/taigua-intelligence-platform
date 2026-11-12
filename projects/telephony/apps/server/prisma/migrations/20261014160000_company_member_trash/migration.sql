-- 中文导读：数据库迁移：20261014160000_company_member_trash。记录这一版本的表结构或数据规则变更。
ALTER TABLE "Member" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Member_organizationId_deletedAt_idx" ON "Member"("organizationId", "deletedAt");
