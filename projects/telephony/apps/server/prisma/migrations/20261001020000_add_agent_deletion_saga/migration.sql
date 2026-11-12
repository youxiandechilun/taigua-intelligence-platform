-- 中文导读：数据库迁移：20261001020000_add_agent_deletion_saga。记录这一版本的表结构或数据规则变更。
ALTER TABLE "Agent"
ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletionAttemptedAt" TIMESTAMP(3),
ADD COLUMN "deletionError" TEXT;

CREATE INDEX "Agent_deletionRequestedAt_idx"
ON "Agent"("deletionRequestedAt");
