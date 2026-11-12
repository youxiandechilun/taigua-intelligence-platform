-- 中文导读：数据库迁移：20260529000000_add_stt_model_to_agent_config。记录这一版本的表结构或数据规则变更。
-- AlterTable
ALTER TABLE "AgentConfiguration" ADD COLUMN     "sttModel" TEXT NOT NULL DEFAULT 'nova-3';
