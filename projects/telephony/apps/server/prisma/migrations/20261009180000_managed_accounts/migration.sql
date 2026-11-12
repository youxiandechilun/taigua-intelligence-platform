-- 中文导读：数据库迁移：20261009180000_managed_accounts。记录这一版本的表结构或数据规则变更。
BEGIN;
CREATE TABLE "Department" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Department_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");
CREATE UNIQUE INDEX "Member_organizationId_key" ON "Member"("organizationId");
UPDATE "Session" s SET "activeOrganizationId" = m."organizationId" FROM "Member" m WHERE s."userId" = m."userId";
COMMIT;
