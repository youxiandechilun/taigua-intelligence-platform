-- 中文导读：数据库迁移：20260715190000_add_ivr_navigation_agent_config。记录这一版本的表结构或数据规则变更。
-- Add per-agent IVR navigation control for LiveKit DTMF menu traversal.
ALTER TABLE "AgentConfiguration"
  ADD COLUMN "ivr_navigation_enabled" BOOLEAN NOT NULL DEFAULT true;
