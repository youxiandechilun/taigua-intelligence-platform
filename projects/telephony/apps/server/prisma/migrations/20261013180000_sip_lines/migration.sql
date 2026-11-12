-- 中文导读：数据库迁移：20261013180000_sip_lines。记录这一版本的表结构或数据规则变更。
CREATE UNIQUE INDEX IF NOT EXISTS "Agent_organizationId_agentId_key" ON "Agent"("organizationId","agentId");
-- Additive only: existing provider data and credentials are not changed.
CREATE TABLE "SipConnection" (
  "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "SipAgentProfile" (
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "agentId" TEXT NOT NULL,
  FOREIGN KEY ("workspaceId","agentId") REFERENCES "Agent"("organizationId","agentId") ON DELETE CASCADE,
  "profile" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspaceId", "agentId")
);
CREATE TABLE "SipTask" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "agentId" TEXT,
  FOREIGN KEY ("workspaceId","agentId") REFERENCES "Agent"("organizationId","agentId") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','RUNNING','PAUSED','COMPLETED','NEEDS_REVIEW')),
  "recipients" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("workspaceId","id")
);
CREATE INDEX "SipTask_workspace_created" ON "SipTask"("workspaceId","createdAt");
CREATE TABLE "SipAttempt" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "recipientIndex" INTEGER NOT NULL,
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "trunkKey" TEXT NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "result" JSONB NOT NULL DEFAULT '{}',
  FOREIGN KEY ("workspaceId","taskId") REFERENCES "SipTask"("workspaceId","id") ON DELETE RESTRICT,
  UNIQUE ("workspaceId","id"),
  UNIQUE ("taskId","recipientIndex","attemptNumber")
);
CREATE INDEX "SipAttempt_queue" ON "SipAttempt"("status","nextAttemptAt");
CREATE INDEX "SipAttempt_trunk" ON "SipAttempt"("trunkKey","status");
CREATE TABLE "SipEvent" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  FOREIGN KEY ("workspaceId","attemptId") REFERENCES "SipAttempt"("workspaceId","id") ON DELETE RESTRICT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SipSeat" (
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "phone" TEXT NOT NULL DEFAULT '',
 "available" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("workspaceId","userId")
);
CREATE TABLE "WorkspaceModelSettings" (
 "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "settings" JSONB NOT NULL DEFAULT '{}',
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AgentModelSelection" (
 "workspaceId" TEXT NOT NULL,
 "agentId" TEXT NOT NULL,
 "modelId" TEXT NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("workspaceId","agentId"),
 FOREIGN KEY("workspaceId","agentId") REFERENCES "Agent"("organizationId","agentId") ON DELETE CASCADE
);
