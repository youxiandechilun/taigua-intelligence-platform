-- 中文导读：数据库迁移：20261017140000_knowledge_library。记录这一版本的表结构或数据规则变更。
CREATE TABLE "WorkspaceKnowledgeCategory" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE ("organizationId", "name"),
 UNIQUE ("organizationId", "id")
);
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "sourceTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "sourceQuote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "documentId" TEXT;
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "deletedAt" TIMESTAMPTZ;
ALTER TABLE "WorkspaceKnowledge" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkspaceKnowledge" ADD CONSTRAINT "WorkspaceKnowledge_category_scope" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "WorkspaceKnowledgeCategory"("organizationId", "id");
CREATE INDEX "WorkspaceKnowledge_library_idx" ON "WorkspaceKnowledge" ("organizationId", "deletedAt", "categoryId");
CREATE TABLE "WorkspaceKnowledgeDocument" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" TEXT REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "categoryId" TEXT,
 "createdBy" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "content" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL,
 "sourceKind" TEXT NOT NULL,
 "sourceRef" TEXT NOT NULL,
 "fileName" TEXT,
 "fileData" BYTEA,
 "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
 "analysis" JSONB NOT NULL DEFAULT '{}',
 "analysisModel" TEXT NOT NULL DEFAULT '',
 "attemptId" TEXT,
 "error" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "deletedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE ("organizationId", "sourceRef", "contentHash"),
 FOREIGN KEY ("organizationId", "categoryId") REFERENCES "WorkspaceKnowledgeCategory"("organizationId", "id")
);
CREATE INDEX "WorkspaceKnowledgeDocument_scope_idx" ON "WorkspaceKnowledgeDocument" ("organizationId", "deletedAt", "status");
INSERT INTO "WorkspaceKnowledgeCategory" ("id","organizationId","name")
 SELECT md5(o."id"||':knowledge:'||v.name),o."id",v.name
 FROM "Organization" o CROSS JOIN (VALUES ('公司业务'),('产品服务'),('合作条件'),('常见问答'),('异议处理'),('其他')) AS v(name)
 ON CONFLICT ("organizationId","name") DO NOTHING;
