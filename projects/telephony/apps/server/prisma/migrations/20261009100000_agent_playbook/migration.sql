-- 中文导读：数据库迁移：20261009100000_agent_playbook。记录这一版本的表结构或数据规则变更。
ALTER TABLE "AgentConfiguration" ADD COLUMN "conversationPlaybook" JSONB;
