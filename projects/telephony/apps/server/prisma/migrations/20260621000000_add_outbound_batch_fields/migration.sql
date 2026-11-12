-- 中文导读：数据库迁移：20260621000000_add_outbound_batch_fields。记录这一版本的表结构或数据规则变更。
ALTER TABLE "Campaign"
  ADD COLUMN "sourceFileKey" TEXT,
  ADD COLUMN "sourceFileName" TEXT,
  ADD COLUMN "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validRecipients" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invalidRecipients" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ringingTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);
