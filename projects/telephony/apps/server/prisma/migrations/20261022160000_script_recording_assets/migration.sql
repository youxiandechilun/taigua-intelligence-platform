-- 中文导读：数据库迁移：20261022160000_script_recording_assets。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "ScriptRecordingAsset" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "agentId" TEXT NOT NULL, "scope" TEXT NOT NULL CHECK ("scope" IN ('personal','template')),
 "voiceId" TEXT NOT NULL, "fileName" TEXT NOT NULL, "text" TEXT NOT NULL, "textHash" TEXT NOT NULL,
 "sha256" TEXT NOT NULL, "audio" BYTEA NOT NULL, "durationSeconds" DOUBLE PRECISION NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "deletedAt" TIMESTAMPTZ,
 UNIQUE ("workspaceId","ownerId","agentId","scope","voiceId","textHash","sha256")
);
CREATE INDEX IF NOT EXISTS "ScriptRecordingAsset_scope" ON "ScriptRecordingAsset" ("workspaceId","agentId","ownerId","scope");
