-- 中文导读：数据库迁移：20261020120000_company_ceo_role。记录这一版本的表结构或数据规则变更。
-- Add a company-level CEO to existing workspaces without changing members
-- or overwriting a role that an administrator already created or renamed.
INSERT INTO "CompanyRole" ("id", "workspaceId", "name", "description", "rank", "dataScope", "permissions", "presetKey", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'CEO', '管理全公司人员与业务，技术管理权限单独配置。', 5, 'WORKSPACE',
       '{"companyMembers":["read","create","update","delete","resetPassword"],"companyDepartments":["read","create","update","delete"],"companyRoles":["read"],"agentPreview":["create"],"lines":["read","assign"],"seats":["read","create","update","delete"],"crm":["read","create","update","delete","assign","import","export"],"agent":["read"],"agentConfiguration":["read"],"knowledgeSource":["read"],"outboundCalls":["read","create","delete"],"campaigns":["read","create","delete"],"callLogs":["read","delete"],"automation":["read","create","update","delete"],"wecom":["read","update"],"billing":[]}'::jsonb, 'company_ceo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE o."companyRolesInitialized" = true
  AND NOT EXISTS (SELECT 1 FROM "CompanyRole" r WHERE r."workspaceId" = o."id" AND (r."presetKey" = 'company_ceo' OR r."name" = 'CEO'))
ON CONFLICT DO NOTHING;
