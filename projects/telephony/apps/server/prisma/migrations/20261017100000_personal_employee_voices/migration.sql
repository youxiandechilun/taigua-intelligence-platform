-- 中文导读：数据库迁移：20261017100000_personal_employee_voices。记录这一版本的表结构或数据规则变更。
ALTER TABLE "WorkspaceVoice"
 ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'HAOKEHU_SIP',
 ADD COLUMN "gender" TEXT NOT NULL DEFAULT 'neutral',
 ADD COLUMN "employeeVisible" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "assignedUserIds" TEXT[] NOT NULL DEFAULT '{}',
 ADD COLUMN "auditionUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkspaceVoice" ADD CONSTRAINT "WorkspaceVoice_provider_check" CHECK ("provider" IN ('HAOKEHU_SIP','ALIYUN_ENGINE'));
ALTER TABLE "WorkspaceVoice" ADD CONSTRAINT "WorkspaceVoice_gender_check" CHECK ("gender" IN ('neutral','female','male'));

CREATE TABLE "EmployeeVoicePreference" (
 "workspaceId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "scopeKey" TEXT NOT NULL,
 "agentId" TEXT REFERENCES "Agent"("agentId") ON DELETE CASCADE,
 "provider" TEXT NOT NULL CHECK ("provider" IN ('HAOKEHU_SIP','ALIYUN_ENGINE')),
 "choice" TEXT,
 "volume" INTEGER,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("workspaceId","userId","scopeKey","provider"),
 FOREIGN KEY ("workspaceId","userId") REFERENCES "Member"("organizationId","userId") ON DELETE CASCADE,
 CHECK ("scopeKey"=COALESCE("agentId",'default')),
 CHECK ("volume" IS NULL OR "volume" BETWEEN 50 AND CASE WHEN "provider"='ALIYUN_ENGINE' THEN 100 ELSE 150 END)
);
CREATE INDEX "EmployeeVoicePreference_workspace_agent" ON "EmployeeVoicePreference"("workspaceId","agentId");
CREATE INDEX "WorkspaceVoice_provider" ON "WorkspaceVoice"("workspaceId","provider","deletedAt");
ALTER TABLE "AgentVoicePreview" ADD COLUMN "requestedBy" TEXT;
CREATE INDEX "AgentVoicePreview_requester" ON "AgentVoicePreview"("workspaceId","requestedBy","updatedAt");
DO $body$
DECLARE app_owner text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='"Agent"'::regclass;
 EXECUTE format('ALTER TABLE "EmployeeVoicePreference" OWNER TO %I',app_owner);
END $body$;
