-- 中文导读：数据库迁移：20261011050000_add_workspace_crm。记录这一版本的表结构或数据规则变更。
-- CreateEnum
CREATE TYPE "CrmStatus" AS ENUM ('REVIEW', 'READY', 'CONNECTED', 'INTERESTED', 'FOLLOW_UP', 'WON', 'INVALID', 'OPT_OUT');

-- CreateTable
CREATE TABLE "CrmCompany" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "business" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "creditCode" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "authorizedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CrmStatus" NOT NULL DEFAULT 'REVIEW',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextFollowUp" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL DEFAULT '',
    "landline" TEXT NOT NULL DEFAULT '',
    "areaCode" TEXT NOT NULL DEFAULT '',
    "extension" TEXT NOT NULL DEFAULT '',
    "phoneKey" TEXT NOT NULL DEFAULT '',
    "wechatNote" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "status" "CrmStatus" NOT NULL DEFAULT 'REVIEW',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "status" "CrmStatus" NOT NULL DEFAULT 'REVIEW',
    "notes" TEXT NOT NULL DEFAULT '',
    "nextFollowUp" TIMESTAMP(3),
    "sourceContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCallLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "callId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCallLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmCompany_workspaceId_ownerId_updatedAt_idx" ON "CrmCompany"("workspaceId", "ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrmCompany_workspaceId_status_industry_region_idx" ON "CrmCompany"("workspaceId", "status", "industry", "region");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_workspaceId_id_key" ON "CrmCompany"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "CrmContact_workspaceId_phoneKey_idx" ON "CrmContact"("workspaceId", "phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_workspaceId_companyId_id_key" ON "CrmContact"("workspaceId", "companyId", "id");

-- CreateIndex
CREATE INDEX "CrmLead_workspaceId_status_nextFollowUp_idx" ON "CrmLead"("workspaceId", "status", "nextFollowUp");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_workspaceId_sourceContactId_key" ON "CrmLead"("workspaceId", "sourceContactId");

-- CreateIndex
CREATE INDEX "CrmTask_workspaceId_ownerId_status_dueAt_idx" ON "CrmTask"("workspaceId", "ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmActivity_workspaceId_companyId_createdAt_idx" ON "CrmActivity"("workspaceId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmCallLink_workspaceId_companyId_idx" ON "CrmCallLink"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCallLink_workspaceId_callId_key" ON "CrmCallLink"("workspaceId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_organizationId_callId_key" ON "CallLog"("organizationId", "callId");

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_workspaceId_companyId_contactId_fkey" FOREIGN KEY ("workspaceId", "companyId", "contactId") REFERENCES "CrmContact"("workspaceId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_workspaceId_companyId_contactId_fkey" FOREIGN KEY ("workspaceId", "companyId", "contactId") REFERENCES "CrmContact"("workspaceId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_workspaceId_companyId_contactId_fkey" FOREIGN KEY ("workspaceId", "companyId", "contactId") REFERENCES "CrmContact"("workspaceId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCallLink" ADD CONSTRAINT "CrmCallLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCallLink" ADD CONSTRAINT "CrmCallLink_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCallLink" ADD CONSTRAINT "CrmCallLink_workspaceId_companyId_contactId_fkey" FOREIGN KEY ("workspaceId", "companyId", "contactId") REFERENCES "CrmContact"("workspaceId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCallLink" ADD CONSTRAINT "CrmCallLink_workspaceId_callId_fkey" FOREIGN KEY ("workspaceId", "callId") REFERENCES "CallLog"("organizationId", "callId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Active records deduplicate within a workspace; soft-deleted originals remain recoverable.
CREATE UNIQUE INDEX "CrmCompany_active_name_key" ON "CrmCompany" ("workspaceId","nameKey") WHERE "deletedAt" IS NULL AND "mergedIntoId" IS NULL;
CREATE UNIQUE INDEX "CrmCompany_active_credit_key" ON "CrmCompany" ("workspaceId","creditCode") WHERE "creditCode" <> '' AND "deletedAt" IS NULL AND "mergedIntoId" IS NULL;
CREATE UNIQUE INDEX "CrmContact_active_phone_key" ON "CrmContact" ("workspaceId","companyId","phoneKey") WHERE "phoneKey" <> '' AND "deletedAt" IS NULL;
ALTER TABLE "CrmLead" ALTER CONSTRAINT "CrmLead_workspaceId_companyId_contactId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CrmTask" ALTER CONSTRAINT "CrmTask_workspaceId_companyId_contactId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CrmActivity" ALTER CONSTRAINT "CrmActivity_workspaceId_companyId_contactId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "CrmCallLink" ALTER CONSTRAINT "CrmCallLink_workspaceId_companyId_contactId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
