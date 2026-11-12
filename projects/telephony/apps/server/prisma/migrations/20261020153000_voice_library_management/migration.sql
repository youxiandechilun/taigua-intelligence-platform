-- 中文导读：数据库迁移：20261020153000_voice_library_management。记录这一版本的表结构或数据规则变更。
ALTER TABLE "WorkspaceVoice" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
