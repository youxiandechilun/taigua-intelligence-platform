-- 中文导读：数据库迁移：20261010200000_employee_automation。记录这一版本的表结构或数据规则变更。
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "PersonalAutomationRule" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('LEAD_READY','MY_REPORT','FOLLOW_UP')),
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "dailyHour" INTEGER NOT NULL DEFAULT 18 CHECK ("dailyHour" BETWEEN 0 AND 23),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","ownerId","kind")
);
CREATE TABLE "AutomationLearningDraft" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "templateId" TEXT NOT NULL, "name" TEXT NOT NULL, "notes" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AutomationLearningDraft_scope_idx" ON "AutomationLearningDraft"("organizationId","ownerId");
