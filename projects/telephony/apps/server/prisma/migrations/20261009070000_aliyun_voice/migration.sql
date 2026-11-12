-- 中文导读：数据库迁移：20261009070000_aliyun_voice。记录这一版本的表结构或数据规则变更。
CREATE TABLE "AliyunConnection" (
  "organizationId" TEXT NOT NULL PRIMARY KEY,
  "settings" JSONB NOT NULL,
  "credentials" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AliyunConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AliyunTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "regionId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "scriptId" TEXT NOT NULL,
  "callerNumber" TEXT NOT NULL,
  "remoteId" TEXT,
  "recipients" JSONB NOT NULL,
  "results" JSONB NOT NULL DEFAULT '[]',
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "errorMessage" TEXT,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AliyunTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AliyunTask_organizationId_createdAt_idx" ON "AliyunTask"("organizationId", "createdAt");
CREATE INDEX "AliyunTask_organizationId_status_idx" ON "AliyunTask"("organizationId", "status");
