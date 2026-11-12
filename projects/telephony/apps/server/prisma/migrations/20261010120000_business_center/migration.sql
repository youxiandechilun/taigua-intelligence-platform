-- 中文导读：数据库迁移：20261010120000_business_center。记录这一版本的表结构或数据规则变更。
CREATE TABLE "BusinessContact" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "companyName" TEXT NOT NULL, "phone" TEXT NOT NULL, "industry" TEXT NOT NULL DEFAULT '',
 "address" TEXT NOT NULL DEFAULT '', "business" TEXT NOT NULL DEFAULT '', "sourceUrl" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'NEW', "notes" TEXT NOT NULL DEFAULT '', "nextFollowUp" TIMESTAMP(3),
 "wecomStatus" TEXT NOT NULL DEFAULT 'NONE', "handoffStatus" TEXT NOT NULL DEFAULT 'NONE',
 "handoffReason" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId", "ownerId", "phone")
);
CREATE INDEX "BusinessContact_scope_idx" ON "BusinessContact" ("organizationId", "ownerId", "updatedAt");
CREATE TABLE "LeadSearchJob" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "industry" TEXT NOT NULL, "region" TEXT NOT NULL DEFAULT '中国大陆', "target" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'SEARCHING', "message" TEXT NOT NULL DEFAULT '正在搜索公开企业联系方式',
 "cursor" INTEGER NOT NULL DEFAULT 0, "sources" JSONB NOT NULL DEFAULT '[]', "visited" JSONB NOT NULL DEFAULT '[]',
 "results" JSONB NOT NULL DEFAULT '[]', "lockedUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LeadSearchJob_scope_idx" ON "LeadSearchJob" ("organizationId", "ownerId", "createdAt");
