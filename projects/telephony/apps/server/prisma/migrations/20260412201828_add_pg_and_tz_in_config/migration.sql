-- 中文导读：数据库迁移：20260412201828_add_pg_and_tz_in_config。记录这一版本的表结构或数据规则变更。
-- AlterTable
ALTER TABLE "AgentConfiguration" ADD COLUMN     "preemptive_generation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
