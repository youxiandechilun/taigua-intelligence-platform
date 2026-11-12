-- 中文导读：数据库迁移：20261015183000_employee_recording_learning。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "AgentLearningRecording" (
 "id" text PRIMARY KEY,
 "workspaceId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" text NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "createdBy" text NOT NULL,
 "name" text NOT NULL,
 "audio" bytea NOT NULL,
 "durationSeconds" integer NOT NULL,
 "transcript" text NOT NULL DEFAULT '',
 "analysis" jsonb,
 "status" text NOT NULL DEFAULT 'UPLOADED',
 "error" text NOT NULL DEFAULT '',
 "createdAt" timestamptz NOT NULL DEFAULT NOW(),
 "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
 "deletedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "AgentLearningRecording_scope_idx" ON "AgentLearningRecording" ("workspaceId","agentId","createdAt" DESC);
CREATE TABLE IF NOT EXISTS "AgentRehearsal" (
 "id" text PRIMARY KEY,
 "workspaceId" text NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" text NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "createdBy" text NOT NULL,
 "messages" jsonb NOT NULL,
 "revision" text NOT NULL DEFAULT '',
 "correction" text NOT NULL DEFAULT '',
 "createdAt" timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "AgentRehearsal_scope_idx" ON "AgentRehearsal" ("workspaceId","agentId","createdAt" DESC);
