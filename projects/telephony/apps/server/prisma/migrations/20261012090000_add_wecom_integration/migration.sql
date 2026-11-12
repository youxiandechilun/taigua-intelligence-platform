-- 中文导读：数据库迁移：20261012090000_add_wecom_integration。记录这一版本的表结构或数据规则变更。
-- CreateTable
CREATE TABLE "WecomConnection" (
    "organizationId" TEXT NOT NULL,
    "corpId" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "callbackVerifiedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WecomConnection_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "WecomMember" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wecomUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WecomMember_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "WecomContactWay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "wecomUserId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WecomContactWay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WecomExternalContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "wecomUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "companyName" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "companyId" TEXT,
    "contactId" TEXT,
    "addedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WecomExternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WecomEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WecomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WecomConnection_corpId_key" ON "WecomConnection"("corpId");

-- CreateIndex
CREATE UNIQUE INDEX "WecomMember_organizationId_wecomUserId_key" ON "WecomMember"("organizationId", "wecomUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WecomContactWay_organizationId_configId_key" ON "WecomContactWay"("organizationId", "configId");

-- CreateIndex
CREATE UNIQUE INDEX "WecomContactWay_organizationId_state_key" ON "WecomContactWay"("organizationId", "state");

-- CreateIndex
CREATE INDEX "WecomExternalContact_organizationId_companyId_idx" ON "WecomExternalContact"("organizationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "WecomExternalContact_organizationId_wecomUserId_externalUse_key" ON "WecomExternalContact"("organizationId", "wecomUserId", "externalUserId");

-- CreateIndex
CREATE INDEX "WecomEvent_processedAt_createdAt_idx" ON "WecomEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WecomEvent_organizationId_eventKey_key" ON "WecomEvent"("organizationId", "eventKey");

-- AddForeignKey
ALTER TABLE "WecomConnection" ADD CONSTRAINT "WecomConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomMember" ADD CONSTRAINT "WecomMember_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "Member"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomMember" ADD CONSTRAINT "WecomMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomContactWay" ADD CONSTRAINT "WecomContactWay_organizationId_ownerId_fkey" FOREIGN KEY ("organizationId", "ownerId") REFERENCES "WecomMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomContactWay" ADD CONSTRAINT "WecomContactWay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomExternalContact" ADD CONSTRAINT "WecomExternalContact_organizationId_wecomUserId_fkey" FOREIGN KEY ("organizationId", "wecomUserId") REFERENCES "WecomMember"("organizationId", "wecomUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomExternalContact" ADD CONSTRAINT "WecomExternalContact_organizationId_companyId_fkey" FOREIGN KEY ("organizationId", "companyId") REFERENCES "CrmCompany"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WecomExternalContact" ADD CONSTRAINT "WecomExternalContact_organizationId_companyId_contactId_fkey" FOREIGN KEY ("organizationId", "companyId", "contactId") REFERENCES "CrmContact"("workspaceId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "WecomExternalContact" ADD CONSTRAINT "WecomExternalContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WecomEvent" ADD CONSTRAINT "WecomEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "WecomExternalContact" ADD CONSTRAINT "WecomExternalContact_contact_requires_company" CHECK ("contactId" IS NULL OR "companyId" IS NOT NULL);
