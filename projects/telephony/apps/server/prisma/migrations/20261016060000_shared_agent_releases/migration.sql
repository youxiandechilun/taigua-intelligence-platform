-- 中文导读：数据库迁移：20261016060000_shared_agent_releases。记录这一版本的表结构或数据规则变更。
CREATE TABLE "AgentRelease" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "publishedBy" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("workspaceId", "agentId", "version"),
  UNIQUE ("workspaceId", "agentId", "id")
);
CREATE TABLE "AgentDeployment" (
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
  "releaseId" TEXT,
  "audience" JSONB NOT NULL DEFAULT '{"allEmployees":true,"userIds":[],"departmentIds":[]}',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("workspaceId", "agentId"),
  FOREIGN KEY ("workspaceId", "agentId", "releaseId") REFERENCES "AgentRelease"("workspaceId", "agentId", "id")
);
CREATE TABLE "AgentReleaseMigration" (
  "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "WorkspaceCallPolicy" (
  "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
  "settings" JSONB NOT NULL DEFAULT '{"companyConcurrent":10,"departmentConcurrent":4,"employeeConcurrent":1}',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "CallDispatchTurn" (
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "lastDispatchedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("workspaceId", "userId", "provider")
);
CREATE TABLE "AliyunEngineConnection" (
  "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "AliyunEngineCall" (
  "attemptId" TEXT PRIMARY KEY REFERENCES "SipAttempt"("id") ON DELETE CASCADE,
  "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "outId" TEXT NOT NULL UNIQUE,
  "remoteId" TEXT UNIQUE,
  "releaseId" TEXT NOT NULL REFERENCES "AgentRelease"("id"),
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "recordingUrl" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "SipAttempt_dispatch_fair" ON "SipAttempt" ("workspaceId", "status", "nextAttemptAt") WHERE "status"='QUEUED';
CREATE INDEX "AgentRelease_recent" ON "AgentRelease" ("workspaceId", "agentId", "version" DESC);

CREATE TABLE "AliyunEngineReceipt" (
 "id" TEXT PRIMARY KEY, "payload" JSONB NOT NULL, "processedAt" TIMESTAMPTZ,
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "AliyunEngineReceipt_pending" ON "AliyunEngineReceipt" ("nextAt") WHERE "processedAt" IS NULL;
