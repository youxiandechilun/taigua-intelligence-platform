/*
 * 中文导读：线路与语音外呼：call-capacity.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {resolveDataOwner} from '../workspace/company-access.js';
import { crmDb } from '../crm/crm.db.js';
import { type Scope,memberAccess } from '../crm/crm.service.js';
import { canViewAllOutbound, outboundOwnerSql } from './task-visibility.js';

export async function capacityCatalog(s:Scope,requestedOwner='mine'){
 const access=await memberAccess(crmDb,s);
 const ownerId=await resolveDataOwner(s.workspaceId,s.userId,requestedOwner);
 const rows=await crmDb.query(`SELECT a."status",count(*)::int AS count FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."workspaceId"=$1 AND COALESCE(t."snapshot"->>'mode','AI')<>'MANUAL' AND a."status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') AND ${outboundOwnerSql('t."createdBy"')} AND ($4::text IS NULL OR t."createdBy"=$4) GROUP BY a."status"`,[s.workspaceId,s.userId,canViewAllOutbound(access),ownerId||null]);
 return {canConfigure:false,policy:{companyConcurrent:0,departmentConcurrent:0,employeeConcurrent:0},queued:rows.find(r=>r.status==='QUEUED')?.count||0,active:rows.filter(r=>!['QUEUED','NEEDS_REVIEW'].includes(r.status)).reduce((n,r)=>n+r.count,0),needsReview:rows.find(r=>r.status==='NEEDS_REVIEW')?.count||0};
}
