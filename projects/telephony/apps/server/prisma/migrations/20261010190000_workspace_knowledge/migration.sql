-- 中文导读：数据库迁移：20261010190000_workspace_knowledge。记录这一版本的表结构或数据规则变更。
CREATE TABLE "WorkspaceKnowledge" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "agentId" TEXT REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "title" TEXT NOT NULL,
 "content" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkspaceKnowledge_scope_idx" ON "WorkspaceKnowledge" ("organizationId","agentId","enabled");
