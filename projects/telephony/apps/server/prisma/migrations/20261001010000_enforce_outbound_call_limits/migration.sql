-- 中文导读：数据库迁移：20261001010000_enforce_outbound_call_limits。记录这一版本的表结构或数据规则变更。
ALTER TABLE "OutboundCall"
ADD COLUMN "dispatchClaimedAt" TIMESTAMP(3);

CREATE INDEX "OutboundCall_agentId_dispatchClaimedAt_idx"
ON "OutboundCall"("agentId", "dispatchClaimedAt");
