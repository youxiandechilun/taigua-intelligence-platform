-- 中文导读：数据库迁移：20261003000000_align_index_names。记录这一版本的表结构或数据规则变更。
-- Earlier SQL migrations used names longer than PostgreSQL's 63-byte limit.
-- Rename the actual truncated indexes in place; preserve their data and uniqueness.
-- PromotionalGrant's organizationId and billingAccountId already have unique
-- indexes, so the redundant non-unique schema declarations were removed.
BEGIN;

ALTER INDEX "CampaignRecipientSnapshot_campaignId_recipientKey_schemaVersion"
  RENAME TO "CampaignRecipientSnapshot_recipient_version_key";

ALTER INDEX "TopUp_financialReconciliationPending_financialProcessingExpires"
  RENAME TO "TopUp_financial_reconciliation_idx";

COMMIT;
