-- 中文导读：数据库迁移：20261011020000_aliyun_task_policy。记录这一版本的表结构或数据规则变更。
ALTER TABLE "AliyunTask" ADD COLUMN "executionPolicy" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "AgentConfiguration" ADD COLUMN "communicationProfile" JSONB NOT NULL DEFAULT '{}';
