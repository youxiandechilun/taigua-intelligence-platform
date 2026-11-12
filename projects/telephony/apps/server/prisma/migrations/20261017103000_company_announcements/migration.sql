-- 中文导读：数据库迁移：20261017103000_company_announcements。记录这一版本的表结构或数据规则变更。
CREATE TABLE "WorkspaceAnnouncement" (
 "id" TEXT PRIMARY KEY,
 "workspaceId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "text" TEXT NOT NULL CHECK (length(trim("text")) BETWEEN 1 AND 1000),
 "color" TEXT NOT NULL DEFAULT '#b83240' CHECK ("color" ~ '^#[0-9a-fA-F]{6}$'),
 "speed" TEXT NOT NULL DEFAULT 'normal' CHECK ("speed" IN ('slow','normal','fast')),
 "fontSize" INTEGER NOT NULL DEFAULT 14 CHECK ("fontSize" BETWEEN 12 AND 24),
 "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "endsAt" TIMESTAMP(3),
 "stoppedAt" TIMESTAMP(3),
 "deletedAt" TIMESTAMP(3),
 "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "requestId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspaceId","requestId"),
 CHECK ("endsAt" IS NULL OR "endsAt">"startsAt")
);
CREATE INDEX "WorkspaceAnnouncement_workspace_live" ON "WorkspaceAnnouncement"("workspaceId","deletedAt","stoppedAt","startsAt","endsAt");
DO $body$
DECLARE company RECORD; config JSONB; content TEXT; app_owner TEXT;
BEGIN
 FOR company IN SELECT "id","metadata" FROM "Organization" WHERE "deletedAt" IS NULL LOOP
  BEGIN config := company."metadata"::jsonb->'dashboardAnnouncement'; EXCEPTION WHEN OTHERS THEN CONTINUE; END;
  content := left(trim(config->>'text'),1000);
  IF COALESCE(length(content),0)>0 THEN
   INSERT INTO "WorkspaceAnnouncement" ("id","workspaceId","text","color","speed","stoppedAt","requestId")
   VALUES (md5('legacy-dashboard-announcement:'||company.id)::uuid::text,company.id,content,
    CASE WHEN config->>'color' ~ '^#[0-9a-fA-F]{6}$' THEN config->>'color' ELSE '#b83240' END,
    CASE WHEN config->>'speed' IN ('slow','normal','fast') THEN config->>'speed' ELSE 'normal' END,
    CASE WHEN config->>'enabled'='false' THEN CURRENT_TIMESTAMP ELSE NULL END,'legacy-dashboard-announcement');
  END IF;
 END LOOP;
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Organization"'::regclass;
 EXECUTE format('ALTER TABLE "WorkspaceAnnouncement" OWNER TO %I',app_owner);
END $body$;
