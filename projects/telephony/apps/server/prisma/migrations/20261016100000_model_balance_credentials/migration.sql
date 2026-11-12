-- 中文导读：数据库迁移：20261016100000_model_balance_credentials。记录这一版本的表结构或数据规则变更。
ALTER TABLE "WorkspaceModelAccount" ADD COLUMN "billingCredentials" TEXT;
