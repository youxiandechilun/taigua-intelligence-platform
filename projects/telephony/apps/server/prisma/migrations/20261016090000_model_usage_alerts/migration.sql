-- 中文导读：数据库迁移：20261016090000_model_usage_alerts。记录这一版本的表结构或数据规则变更。
CREATE TABLE "ModelUsageRecord" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "provider" TEXT NOT NULL CHECK ("provider" IN ('qwen','stepfun','deepseek','zhipu')),
 "modelId" TEXT NOT NULL,
 "purpose" TEXT NOT NULL,
 "callId" TEXT,
 "inputTokens" BIGINT,
 "outputTokens" BIGINT,
 "totalTokens" BIGINT,
 "inputAudioTokens" BIGINT,
 "outputAudioTokens" BIGINT,
 "cachedTokens" BIGINT,
 "requests" INTEGER NOT NULL DEFAULT 1 CHECK ("requests">=0),
 "missingUsage" INTEGER NOT NULL DEFAULT 0 CHECK ("missingUsage">=0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("inputTokens">=0 AND "outputTokens">=0 AND "totalTokens">=0)
);
CREATE INDEX "ModelUsageRecord_workspace_provider_created_idx" ON "ModelUsageRecord"("workspaceId","provider","createdAt");
CREATE TABLE "WorkspaceModelAccount" (
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "provider" TEXT NOT NULL CHECK ("provider" IN ('qwen','stepfun','deepseek','zhipu')),
 "settings" JSONB NOT NULL DEFAULT '{}',
 "balances" JSONB,
 "balanceFingerprint" TEXT NOT NULL DEFAULT '',
 "balanceCheckedAt" TIMESTAMP(3),
 "balanceAttemptedAt" TIMESTAMP(3),
 "balanceError" TEXT NOT NULL DEFAULT '',
 "manualBalanceAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","provider")
);
CREATE TABLE "ModelUsageAlert" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "provider" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "message" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspaceId","provider","kind")
);
CREATE INDEX "ModelUsageAlert_workspace_active_idx" ON "ModelUsageAlert"("workspaceId","active");
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 IF app_owner IS NULL THEN RAISE EXCEPTION 'Existing application database role unavailable'; END IF;
 EXECUTE format('ALTER TABLE "ModelUsageRecord" OWNER TO %I',app_owner);
 EXECUTE format('ALTER TABLE "WorkspaceModelAccount" OWNER TO %I',app_owner);
 EXECUTE format('ALTER TABLE "ModelUsageAlert" OWNER TO %I',app_owner);
END $body$;
