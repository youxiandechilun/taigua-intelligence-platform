-- 中文导读：数据库迁移：20261010150000_company_collaboration。记录这一版本的表结构或数据规则变更。
BEGIN;
DROP INDEX "Member_organizationId_key";
ALTER TABLE "Member" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "CompanyDepartment" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CompanyDepartment_organizationId_name_key" ON "CompanyDepartment"("organizationId","name");
CREATE INDEX "CompanyDepartment_organizationId_idx" ON "CompanyDepartment"("organizationId");
ALTER TABLE "Member" ADD COLUMN "companyDepartmentId" TEXT REFERENCES "CompanyDepartment"("id") ON DELETE SET NULL;
CREATE TABLE "ContactAssignment" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "previousOwnerId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ContactAssignment_scope_idx" ON "ContactAssignment"("organizationId","contactId","createdAt");
COMMIT;
