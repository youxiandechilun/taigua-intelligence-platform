-- 中文导读：数据库迁移：20261013100000_automation_recycle。记录这一版本的表结构或数据规则变更。
-- Additive, recoverable deletion. Existing workflows and drafts are retained.
ALTER TABLE "AutomationLearningDraft" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "AutomationTemplateState" (
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "templateId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId", "templateId")
);
