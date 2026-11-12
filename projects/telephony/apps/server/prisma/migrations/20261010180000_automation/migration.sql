-- 中文导读：数据库迁移：20261010180000_automation。记录这一版本的表结构或数据规则变更。
CREATE TABLE "AutomationRule" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "kind" TEXT NOT NULL CHECK ("kind" IN ('LEAD_READY','CALL_SUMMARY','DAILY_REPORT')),
 "enabled" BOOLEAN NOT NULL DEFAULT true, "dailyHour" INTEGER NOT NULL DEFAULT 18 CHECK ("dailyHour" BETWEEN 0 AND 23),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","kind")
);
CREATE TABLE "AutomationRun" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "kind" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
 "tokenHash" TEXT, "leaseUntil" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "result" JSONB, "error" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("organizationId","kind","sourceId")
);
CREATE INDEX "AutomationRun_scope_idx" ON "AutomationRun"("organizationId","ownerId","createdAt");
CREATE INDEX "AutomationRun_dispatch_idx" ON "AutomationRun"("status","nextAttemptAt");
CREATE TABLE "AutomationTodo" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "runId" TEXT NOT NULL UNIQUE REFERENCES "AutomationRun"("id") ON DELETE CASCADE,
 "title" TEXT NOT NULL, "description" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AutomationTodo_scope_idx" ON "AutomationTodo"("organizationId","ownerId","status");
