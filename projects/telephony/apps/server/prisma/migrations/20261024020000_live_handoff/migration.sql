-- 中文导读：数据库迁移：20261024020000_live_handoff。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "SipLiveHandoff" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "attemptId" TEXT NOT NULL UNIQUE REFERENCES "SipAttempt"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL,
 "phone" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'RESERVED',
 "reason" TEXT NOT NULL DEFAULT '',
 "leaseUntil" TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '45 seconds',
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "SipLiveHandoff_seat_idx" ON "SipLiveHandoff"("workspaceId","userId","status");
DO $body$ DECLARE app_owner text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"SipAttempt"'::regclass;
 EXECUTE format('ALTER TABLE "SipLiveHandoff" OWNER TO %I',app_owner);
END $body$;
