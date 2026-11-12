-- 中文导读：数据库迁移：20261009190000_private_workspaces。记录这一版本的表结构或数据规则变更。
BEGIN;
-- One account may own multiple workspaces; each workspace still has one owner.
DROP INDEX "Member_userId_key";
COMMIT;
