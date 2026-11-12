-- 中文导读：数据库迁移：20261013210000_regional_lines_voice_library。记录这一版本的表结构或数据规则变更。
CREATE TABLE "SipRegionalLine" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "settings" JSONB NOT NULL,
 "provinces" TEXT[] NOT NULL DEFAULT '{}',
 "note" TEXT NOT NULL DEFAULT '',
 "enabled" BOOLEAN NOT NULL DEFAULT true,
 "assignedUserIds" TEXT[] NOT NULL DEFAULT '{}',
 "deletedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspaceId","id")
);
CREATE INDEX "SipRegionalLine_workspace" ON "SipRegionalLine"("workspaceId","enabled");
CREATE TABLE "WorkspaceVoice" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "name" TEXT NOT NULL,
 "targetModel" TEXT NOT NULL,
 "voice" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "previewStatus" TEXT NOT NULL DEFAULT 'NONE',
 "preview" BYTEA,
 "sample" BYTEA,
 "mime" TEXT NOT NULL DEFAULT 'audio/wav',
 "sampleHash" TEXT NOT NULL DEFAULT '',
 "consentedAt" TIMESTAMP(3),
 "providerRequestId" TEXT NOT NULL DEFAULT '',
 "error" TEXT NOT NULL DEFAULT '',
 "deletedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspaceId","id")
);
CREATE INDEX "WorkspaceVoice_workspace" ON "WorkspaceVoice"("workspaceId","createdAt");
-- Match the established application owner even when an admin applies this migration.
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 EXECUTE format('ALTER TABLE "SipRegionalLine" OWNER TO %I',app_owner);
 EXECUTE format('ALTER TABLE "WorkspaceVoice" OWNER TO %I',app_owner);
END $body$;
