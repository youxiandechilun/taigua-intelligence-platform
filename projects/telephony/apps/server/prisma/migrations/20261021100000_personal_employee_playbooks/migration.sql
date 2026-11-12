-- 中文导读：数据库迁移：20261021100000_personal_employee_playbooks。记录这一版本的表结构或数据规则变更。
CREATE TABLE "EmployeePlaybook" (
 "workspaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "agentId" TEXT NOT NULL REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "playbook" JSONB,
 "configuration" JSONB,
 "placeholders" JSONB NOT NULL DEFAULT '{}',
 "baseReleaseId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","userId","agentId"),
 FOREIGN KEY ("workspaceId","userId") REFERENCES "Member"("organizationId","userId") ON DELETE CASCADE
);
CREATE INDEX "EmployeePlaybook_workspace_agent" ON "EmployeePlaybook"("workspaceId","agentId");
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 EXECUTE format('ALTER TABLE "EmployeePlaybook" OWNER TO %I',app_owner);
END $body$;
