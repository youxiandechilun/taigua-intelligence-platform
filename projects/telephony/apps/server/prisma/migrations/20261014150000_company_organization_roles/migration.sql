-- 中文导读：数据库迁移：20261014150000_company_organization_roles。记录这一版本的表结构或数据规则变更。
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "companyRolesInitialized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "companyRoleId" TEXT,
ADD COLUMN     "scopeDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "CompanyDepartment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DEPARTMENT',
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "CompanyRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rank" INTEGER NOT NULL DEFAULT 100,
    "dataScope" TEXT NOT NULL DEFAULT 'SELF',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "presetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_workspaceId_id_key" ON "CompanyRole"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_workspaceId_name_key" ON "CompanyRole"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_workspaceId_presetKey_key" ON "CompanyRole"("workspaceId", "presetKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDepartment_organizationId_id_key" ON "CompanyDepartment"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_companyRoleId_fkey" FOREIGN KEY ("organizationId", "companyRoleId") REFERENCES "CompanyRole"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDepartment" ADD CONSTRAINT "CompanyDepartment_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "CompanyDepartment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRole" ADD CONSTRAINT "CompanyRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
