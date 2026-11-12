/*
 * 中文导读：客户管理：customer-read-state.ts。相关类型、配置或辅助实现集中在本文件。
 */
// A phone can have a temporary live ID before becoming a saved customer.
// Use a workspace-scoped key so that transition keeps the viewer's identity.
export const customerReadKeySql = `md5(c."workspaceId"||':'||c."phone")`;
export const customerReadRevisionSql = `md5(jsonb_build_array(c."version",to_char(c."latestAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US'),to_char(c."updatedAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US'),c."recognitionStatus",c."intent",c."ownerId")::text)`;
export const customerReadAtSql = `CASE WHEN reading."seenRevision"=${customerReadRevisionSql} THEN reading."readAt" ELSE NULL END`;

export const customerReadJoinSql = `LEFT JOIN "CustomerIntentReadState" reading
  ON reading."workspaceId"=c."workspaceId" AND reading."userId"=$2
  AND reading."customerKey"=${customerReadKeySql}`;
