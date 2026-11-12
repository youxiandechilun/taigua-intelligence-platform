-- 中文导读：数据库迁移：20261012130000_improve_lead_search。记录这一版本的表结构或数据规则变更。
ALTER TABLE "LeadSearchJob" ADD COLUMN "diagnostics" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "nextSearchAt" TIMESTAMP(3);
