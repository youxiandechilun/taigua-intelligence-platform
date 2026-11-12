/*
 * 中文导读：线路与语音外呼：task-visibility.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CrmDb, Scope } from '../crm/crm.service.js';

type OutboundAccess = { isSystemAdmin: boolean; canManage: boolean; allData: boolean };

// Workspace administrators share the same data scope across tasks and calls.
export const canViewAllOutbound = (access: OutboundAccess) => access.isSystemAdmin===true||access.canManage===true&&access.allData===true;

// Callers provide fixed column/parameter expressions; values always remain bound parameters.
export const outboundOwnerSql = (owner: string, actor = '$2', all = '$3') => `(${all}::boolean OR ${owner}=${actor})`;

export async function visibleOutboundTasks(db: CrmDb, scope: Scope, all: boolean,ownerId?:string,kind?:'MANUAL') {
  return db.query(`SELECT t.*,COALESCE(a."name",'人工坐席') AS "agentName",COALESCE(u."name",'已停用账号') AS "createdByName"
    FROM "SipTask" t
    LEFT JOIN "Agent" a ON a."agentId"=t."agentId" AND a."organizationId"=t."workspaceId"
    LEFT JOIN "User" u ON u."id"=t."createdBy"
    WHERE t."workspaceId"=$1 AND t."deletedAt" IS NULL AND COALESCE(t."snapshot"->>'demoCall','false')<>'true' AND ${outboundOwnerSql('t."createdBy"')} AND ($4::text IS NULL OR t."createdBy"=$4) AND ($5::text IS NULL OR COALESCE(t."snapshot"->>'mode','AI')=$5)
    ORDER BY t."createdAt" DESC LIMIT 100`, [scope.workspaceId, scope.userId, all,ownerId||null,kind||null]);
}

export async function visibleOutboundTask(db: CrmDb, scope: Scope, id: string, all: boolean, lock = false) {
  return (await db.query(`SELECT * FROM "SipTask"
    WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL
    AND ${outboundOwnerSql('"createdBy"', '$3', '$4')} ${lock ? 'FOR UPDATE' : ''}`,
    [scope.workspaceId, id, scope.userId, all]))[0];
}

// Older cloud tasks have no creator column. New tasks freeze their server-side
// creator; historical tasks use only the original draft audit, never later operators.
// An unknown creator remains visible to administrators only.
export async function visibleAliyunTasks(db: CrmDb, scope: Scope, all: boolean, id?: string) {
  return db.query(`SELECT t.*,owner."userId" AS "createdBy",COALESCE(u."name",'未记录创建人') AS "createdByName"
    FROM "AliyunTask" t
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(t."executionPolicy"->>'createdByUserId',''),(
        SELECT a."userId" FROM "AuditLog" a
        WHERE a."organizationId"=t."organizationId" AND a."resourceId"=t."id"
        AND a."resourceType"='aliyunTask' AND a."action"='aliyun.task.draft'
        ORDER BY a."createdAt",a."auditLogId" LIMIT 1
      )) AS "userId"
    ) owner ON true
    LEFT JOIN "User" u ON u."id"=owner."userId"
    WHERE t."organizationId"=$1 AND ${outboundOwnerSql('owner."userId"')}
    ${id ? 'AND t."id"=$4' : ''}
    ORDER BY t."createdAt" DESC LIMIT ${id ? 1 : 100}`,
    [scope.workspaceId, scope.userId, all, ...(id ? [id] : [])]);
}
