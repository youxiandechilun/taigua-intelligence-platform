-- 中文导读：数据库迁移：20261023110000_voice_control_center。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "WorkspaceVoiceOpening" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "voiceId" TEXT NOT NULL REFERENCES "WorkspaceVoice"("id") ON DELETE CASCADE,
 "createdBy" TEXT NOT NULL,
 "fileName" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL,
 "sha256" TEXT NOT NULL,
 "audio" BYTEA NOT NULL,
 "durationSeconds" DOUBLE PRECISION NOT NULL,
 "text" TEXT NOT NULL DEFAULT '',
 "analysis" JSONB NOT NULL DEFAULT '{}',
 "status" TEXT NOT NULL DEFAULT 'ANALYZING',
 "error" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE ("workspaceId","voiceId")
);
CREATE INDEX IF NOT EXISTS "WorkspaceVoiceOpening_source_idx" ON "WorkspaceVoiceOpening"("workspaceId","sourceHash");
CREATE TABLE IF NOT EXISTS "WorkspaceVoiceTuning" (
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "voiceId" TEXT NOT NULL REFERENCES "WorkspaceVoice"("id") ON DELETE CASCADE,
 "settings" JSONB NOT NULL,
 "volume" INTEGER NOT NULL DEFAULT 100 CHECK ("volume" BETWEEN 50 AND 150),
 "updatedBy" TEXT NOT NULL,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY ("workspaceId","voiceId")
);
CREATE TABLE IF NOT EXISTS "WorkspaceVoiceAudition" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "voiceId" TEXT NOT NULL REFERENCES "WorkspaceVoice"("id") ON DELETE CASCADE,
 "signature" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "status" TEXT NOT NULL,
 "text" TEXT NOT NULL,
 "audio" BYTEA,
 "usage" JSONB,
 "error" TEXT NOT NULL DEFAULT '',
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE ("workspaceId","voiceId","signature"),
 UNIQUE ("workspaceId","requestId")
);
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"WorkspaceVoice"'::regclass;
 EXECUTE format('ALTER TABLE "WorkspaceVoiceOpening" OWNER TO %I',app_owner);
 EXECUTE format('ALTER TABLE "WorkspaceVoiceTuning" OWNER TO %I',app_owner);
 EXECUTE format('ALTER TABLE "WorkspaceVoiceAudition" OWNER TO %I',app_owner);
END $body$;
