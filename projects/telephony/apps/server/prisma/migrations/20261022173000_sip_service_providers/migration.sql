-- 中文导读：数据库迁移：20261022173000_sip_service_providers。记录这一版本的表结构或数据规则变更。
CREATE TABLE "SipServiceProvider" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SipServiceProvider_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SipServiceProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "SipServiceProvider_workspaceId_name_key" ON "SipServiceProvider"("workspaceId","name");
