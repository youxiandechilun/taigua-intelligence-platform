-- 中文导读：数据库迁移：20260725000000_add_kb_processing_errors。记录这一版本的表结构或数据规则变更。
-- Persist user-safe knowledge processing failures so the console can explain
-- why a source failed and what the user can do next.
ALTER TABLE "KnowledgeSource"
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "errorRetryable" BOOLEAN;
