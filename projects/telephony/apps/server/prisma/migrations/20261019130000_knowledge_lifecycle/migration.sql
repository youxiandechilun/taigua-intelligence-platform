-- 中文导读：数据库迁移：20261019130000_knowledge_lifecycle。记录这一版本的表结构或数据规则变更。
CREATE TABLE IF NOT EXISTS "KnowledgeRetrievalSettings" (
 "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
 "semanticEnabled" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "KnowledgeRevision" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "knowledgeId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL,
 "snapshot" JSONB NOT NULL,
 "actorId" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY ("organizationId","knowledgeId","revision")
);
CREATE TABLE IF NOT EXISTS "KnowledgeIndexJob" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "knowledgeId" TEXT PRIMARY KEY REFERENCES "WorkspaceKnowledge"("id") ON DELETE CASCADE,
 "contentHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PROCESSING','READY','ERROR','INACTIVE')),
 "attemptId" TEXT,
 "leaseUntil" TIMESTAMPTZ,
 "error" TEXT NOT NULL DEFAULT '',
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "KnowledgePassage" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "knowledgeId" TEXT NOT NULL REFERENCES "WorkspaceKnowledge"("id") ON DELETE CASCADE,
 "contentHash" TEXT NOT NULL,
 "model" TEXT NOT NULL,
 "position" INTEGER NOT NULL,
 "content" TEXT NOT NULL,
 "vector" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE ("organizationId","knowledgeId","contentHash","model","position")
);
CREATE INDEX IF NOT EXISTS "KnowledgePassage_scope_idx" ON "KnowledgePassage" ("organizationId","knowledgeId","contentHash");
CREATE INDEX IF NOT EXISTS "KnowledgeIndexJob_pending_idx" ON "KnowledgeIndexJob" ("status","updatedAt");
CREATE TABLE IF NOT EXISTS "KnowledgeRetrievalLog" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" TEXT,
 "callId" TEXT,
 "channel" TEXT NOT NULL,
 "question" TEXT NOT NULL,
 "method" TEXT NOT NULL,
 "matched" BOOLEAN NOT NULL,
 "citations" JSONB NOT NULL DEFAULT '[]',
 "durationMs" INTEGER NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "KnowledgeRetrievalLog_scope_idx" ON "KnowledgeRetrievalLog" ("organizationId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "KnowledgeRetrievalLog_call_idx" ON "KnowledgeRetrievalLog" ("organizationId","callId");
CREATE TABLE IF NOT EXISTS "KnowledgeGap" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" TEXT,
 "question" TEXT NOT NULL,
 "occurrences" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RESOLVED','IGNORED')),
 "knowledgeId" TEXT,
 "lastCallId" TEXT,
 "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "resolvedBy" TEXT,
 "resolvedAt" TIMESTAMPTZ,
 "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "KnowledgeGap_scope_idx" ON "KnowledgeGap" ("organizationId","status","lastSeenAt" DESC);

CREATE OR REPLACE FUNCTION taigua_knowledge_lifecycle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h TEXT;
BEGIN
 INSERT INTO "KnowledgeRevision" ("organizationId","knowledgeId","revision","snapshot","actorId")
 VALUES (NEW."organizationId",NEW."id",NEW."revision",to_jsonb(NEW),COALESCE(current_setting('taigua.knowledge_actor',true),''))
 ON CONFLICT DO NOTHING;
 h := md5(NEW."title"||E'\n'||NEW."content"||E'\n'||array_to_string(NEW."tags",E'\n'));
 INSERT INTO "KnowledgeIndexJob" ("organizationId","knowledgeId","contentHash","status")
 VALUES (NEW."organizationId",NEW."id",h,CASE WHEN NEW."enabled" AND NEW."deletedAt" IS NULL AND (NEW."validUntil" IS NULL OR NEW."validUntil">NOW()) THEN 'PENDING' ELSE 'INACTIVE' END)
 ON CONFLICT ("knowledgeId") DO UPDATE SET
  "contentHash"=EXCLUDED."contentHash",
  "status"=CASE WHEN EXCLUDED."status"='INACTIVE' THEN 'INACTIVE' WHEN "KnowledgeIndexJob"."contentHash"=EXCLUDED."contentHash" AND "KnowledgeIndexJob"."status"='READY' THEN 'READY' ELSE 'PENDING' END,
  "attemptId"=NULL,"leaseUntil"=NULL,"error"='',"updatedAt"=NOW();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS taigua_knowledge_lifecycle_trigger ON "WorkspaceKnowledge";
CREATE TRIGGER taigua_knowledge_lifecycle_trigger AFTER INSERT OR UPDATE ON "WorkspaceKnowledge" FOR EACH ROW EXECUTE FUNCTION taigua_knowledge_lifecycle();
INSERT INTO "KnowledgeRevision" ("organizationId","knowledgeId","revision","snapshot") SELECT "organizationId","id","revision",to_jsonb(n) FROM "WorkspaceKnowledge" n ON CONFLICT DO NOTHING;
INSERT INTO "KnowledgeIndexJob" ("organizationId","knowledgeId","contentHash","status")
 SELECT "organizationId","id",md5("title"||E'\n'||"content"||E'\n'||array_to_string("tags",E'\n')),CASE WHEN "enabled" AND "deletedAt" IS NULL AND ("validUntil" IS NULL OR "validUntil">NOW()) THEN 'PENDING' ELSE 'INACTIVE' END FROM "WorkspaceKnowledge" ON CONFLICT DO NOTHING;
