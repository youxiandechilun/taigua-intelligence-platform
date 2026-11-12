-- 中文导读：数据库迁移：20261023090000_voice_reference_versions。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "VoiceReferenceVersion" (
 "workspaceId" TEXT NOT NULL, "voiceId" TEXT NOT NULL, "voice" TEXT NOT NULL,
 "targetModel" TEXT NOT NULL, "sampleHash" TEXT NOT NULL, "sample" BYTEA,
 "providerRequestId" TEXT NOT NULL DEFAULT '', "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY ("workspaceId","voiceId","voice")
);
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"WorkspaceVoice"'::regclass;
 EXECUTE format('ALTER TABLE "VoiceReferenceVersion" OWNER TO %I',app_owner);
END $body$;
