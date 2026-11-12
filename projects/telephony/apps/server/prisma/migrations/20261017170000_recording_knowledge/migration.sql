-- 中文导读：数据库迁移：20261017170000_recording_knowledge。记录这一版本的表结构或数据规则变更。
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN IF NOT EXISTS "validUntil" timestamptz;
CREATE INDEX IF NOT EXISTS "WorkspaceKnowledgeDocument_recording_idx" ON "WorkspaceKnowledgeDocument" ("organizationId","sourceRef") WHERE "sourceKind"='RECORDING';
