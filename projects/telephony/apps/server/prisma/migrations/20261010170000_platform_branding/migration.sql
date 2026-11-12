-- 中文导读：数据库迁移：20261010170000_platform_branding。记录这一版本的表结构或数据规则变更。
CREATE TABLE "PlatformBranding" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "loginSlogan" VARCHAR(120) NOT NULL DEFAULT '让国货之光在全球市场绽放',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBranding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformBranding_singleton" CHECK ("id" = 'global')
);
INSERT INTO "PlatformBranding" ("id") VALUES ('global');
