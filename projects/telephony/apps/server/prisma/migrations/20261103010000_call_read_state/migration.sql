-- 中文导读：数据库迁移：20261103010000_call_read_state。记录这一版本的表结构或数据规则变更。
-- Additive migration. Existing calls stay unread until viewed by each user.
CREATE TABLE "CallLogReadState" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallLogReadState_pkey" PRIMARY KEY ("organizationId", "userId", "callId"),
    CONSTRAINT "CallLogReadState_organizationId_callId_fkey"
      FOREIGN KEY ("organizationId", "callId") REFERENCES "CallLog"("organizationId", "callId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CallLogReadState_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CallLogReadState_organizationId_callId_idx" ON "CallLogReadState"("organizationId", "callId");
CREATE INDEX "CallLogReadState_userId_idx" ON "CallLogReadState"("userId");

-- The maintenance account may apply the migration; retain application access.
DO $body$
DECLARE app_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"CallLog"'::regclass;
  EXECUTE format('ALTER TABLE "CallLogReadState" OWNER TO %I', app_owner);
END $body$;
