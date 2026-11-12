-- 中文导读：数据库迁移：20260529001000_add_tts_model_to_agent_config。记录这一版本的表结构或数据规则变更。
-- AlterTable
ALTER TABLE "AgentConfiguration" ADD COLUMN     "ttsModel" TEXT NOT NULL DEFAULT 'aura-2';
