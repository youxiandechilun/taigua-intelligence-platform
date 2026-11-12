-- 中文导读：数据库迁移：20261012110000_add_wecom_notifications。记录这一版本的表结构或数据规则变更。
ALTER TABLE "WecomConnection" ADD COLUMN "notificationVerifiedAt" TIMESTAMP(3);
CREATE TABLE "WecomNotificationPolicy" (
 "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "time" TEXT NOT NULL DEFAULT '18:05' CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5] CHECK ("weekdays" <@ ARRAY[1,2,3,4,5,6,7]),
 "recipientIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "contents" TEXT[] NOT NULL DEFAULT ARRAY['calls','customers','tasks']::TEXT[] CHECK ("contents" <@ ARRAY['calls','customers','tasks']::TEXT[]),
 "enabledAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WecomNotificationDelivery" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
 "recipientId" TEXT NOT NULL,
 "date" TEXT NOT NULL CHECK ("date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 "status" TEXT NOT NULL DEFAULT 'SENDING' CHECK ("status" IN ('SENDING','ACCEPTED','FAILED','UNKNOWN','SKIPPED')),
 "messageId" TEXT NOT NULL DEFAULT '', "error" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
 UNIQUE ("organizationId","recipientId","date")
);
CREATE INDEX "WecomNotificationDelivery_organizationId_createdAt_idx" ON "WecomNotificationDelivery"("organizationId","createdAt");
