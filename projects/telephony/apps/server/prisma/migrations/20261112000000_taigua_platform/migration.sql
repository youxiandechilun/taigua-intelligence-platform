CREATE TABLE IF NOT EXISTS "TaiguaMerchant" (
  "organizationId" TEXT PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "agentSlug" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaiguaMerchant_merchantId_agentSlug_key"
  ON "TaiguaMerchant"("merchantId", "agentSlug");

CREATE TABLE IF NOT EXISTS "TaiguaSession" (
  "sessionTokenHash" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "platformToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "TaiguaSession_organizationId_idx" ON "TaiguaSession"("organizationId");
CREATE INDEX IF NOT EXISTS "TaiguaSession_expiresAt_idx" ON "TaiguaSession"("expiresAt");

CREATE TABLE IF NOT EXISTS "TaiguaCallCharge" (
  "attemptId" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "holdId" TEXT NOT NULL,
  "reservedQuantity" INTEGER NOT NULL,
  "actualQuantity" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaiguaCallCharge_holdId_key" ON "TaiguaCallCharge"("holdId");
CREATE INDEX IF NOT EXISTS "TaiguaCallCharge_status_updatedAt_idx" ON "TaiguaCallCharge"("status", "updatedAt");
