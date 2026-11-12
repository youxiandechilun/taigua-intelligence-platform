-- 中文导读：数据库迁移：20261016120000_employee_voice_preview。记录这一版本的表结构或数据规则变更。
CREATE TABLE "AgentVoicePreview" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" TEXT NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "signature" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "model" TEXT NOT NULL,
 "voice" TEXT NOT NULL,
 "status" TEXT NOT NULL CHECK ("status" IN ('GENERATING','READY','NEEDS_REVIEW')),
 "audio" BYTEA,
 "usage" JSONB,
 "error" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspaceId","agentId","signature")
);
CREATE INDEX "AgentVoicePreview_workspace" ON "AgentVoicePreview"("workspaceId","updatedAt");
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 EXECUTE format('ALTER TABLE "AgentVoicePreview" OWNER TO %I',app_owner);
END $body$;
