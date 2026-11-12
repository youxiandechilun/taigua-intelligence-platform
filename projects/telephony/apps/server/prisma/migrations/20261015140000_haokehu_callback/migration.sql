-- 中文导读：数据库迁移：20261015140000_haokehu_callback。记录这一版本的表结构或数据规则变更。
-- Additive migration. Existing SIP tasks, lines and recordings are retained.
CREATE TABLE "CallbackConnection" (
 "workspaceId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "accountHash" TEXT NOT NULL UNIQUE,
 "hookHash" TEXT NOT NULL UNIQUE,
 "settings" JSONB NOT NULL DEFAULT '{}',
 "checkedAt" TIMESTAMP(3),
 "connected" BOOLEAN NOT NULL DEFAULT false,
 "lastWebhookAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CallbackEmployee" (
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "phone" TEXT NOT NULL,
 "registered" BOOLEAN NOT NULL DEFAULT false,
 "ready" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","userId"), UNIQUE ("workspaceId","phone")
);
CREATE TABLE "CallbackCall" (
 "workspaceId" TEXT NOT NULL,
 "attemptId" TEXT NOT NULL,
 "bindId" TEXT,
 "notifyToken" TEXT NOT NULL UNIQUE,
 "recordingUrl" TEXT NOT NULL DEFAULT '',
 "recordingState" TEXT NOT NULL DEFAULT 'WAITING',
 "recordingChecks" INTEGER NOT NULL DEFAULT 0,
 "cdrId" TEXT,
 "lastPollAt" TIMESTAMP(3),
 "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 minute',
 "pollCount" INTEGER NOT NULL DEFAULT 0,
 "receivedAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","attemptId"), UNIQUE ("workspaceId","bindId"), UNIQUE ("workspaceId","cdrId"),
 FOREIGN KEY ("workspaceId","attemptId") REFERENCES "SipAttempt"("workspaceId","id") ON DELETE RESTRICT
);
CREATE INDEX "CallbackCall_poll" ON "CallbackCall"("nextPollAt");
