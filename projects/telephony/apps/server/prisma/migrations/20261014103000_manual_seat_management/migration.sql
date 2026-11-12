-- 中文导读：数据库迁移：20261014103000_manual_seat_management。记录这一版本的表结构或数据规则变更。
ALTER TABLE "SipSeat" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SipSeat" ADD COLUMN "department" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SipSeat" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "WorkspaceModelCheck" (
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "modelId" TEXT NOT NULL,
 "keyFingerprint" TEXT NOT NULL,
 "connected" BOOLEAN NOT NULL DEFAULT false,
 "message" TEXT NOT NULL DEFAULT '',
 "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","modelId")
);
-- Use the established database owner rather than the operating-system account.
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 IF app_owner IS NULL THEN RAISE EXCEPTION 'Existing application database role unavailable'; END IF;
 EXECUTE format('ALTER TABLE "WorkspaceModelCheck" OWNER TO %I',app_owner);
END $body$;
