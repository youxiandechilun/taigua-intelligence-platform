-- 中文导读：数据库迁移：20261010100000_aiccs_integration。记录这一版本的表结构或数据规则变更。
ALTER TABLE "AliyunTask" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'outboundbot',
  ADD COLUMN "cloudAgentId" TEXT, ADD COLUMN "cloudBranchId" TEXT, ADD COLUMN "cloudVersionId" TEXT;
CREATE TABLE "AliyunReceipt" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT
);
CREATE INDEX "AliyunReceipt_processedAt_receivedAt_idx" ON "AliyunReceipt" ("processedAt", "receivedAt");
