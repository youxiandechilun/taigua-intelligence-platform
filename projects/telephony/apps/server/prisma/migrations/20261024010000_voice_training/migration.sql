-- 中文导读：数据库迁移：20261024010000_voice_training。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "WorkspaceVoiceTraining" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "voiceId" TEXT NOT NULL REFERENCES "WorkspaceVoice"("id") ON DELETE CASCADE,
 "createdBy" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL,
 "openingHash" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "prompt" TEXT NOT NULL DEFAULT '',
 "audio" BYTEA NOT NULL,
 "durationSeconds" DOUBLE PRECISION NOT NULL,
 "transcript" TEXT NOT NULL DEFAULT '',
 "analysis" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROCESSING',
 "error" TEXT NOT NULL DEFAULT '',
 "beforeTuning" JSONB,
 "afterTuning" JSONB,
 "appliedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE("workspaceId","voiceId","sourceHash"),
 UNIQUE("workspaceId","requestId")
);
CREATE INDEX IF NOT EXISTS "WorkspaceVoiceTraining_voice_idx" ON "WorkspaceVoiceTraining"("workspaceId","voiceId","createdAt");
DO $body$ DECLARE app_owner text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"WorkspaceVoice"'::regclass;
 EXECUTE format('ALTER TABLE "WorkspaceVoiceTraining" OWNER TO %I',app_owner);
END $body$;
