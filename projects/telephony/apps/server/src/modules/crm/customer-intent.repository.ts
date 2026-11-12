/*
 * 中文导读：客户管理：customer-intent.repository.ts。封装数据库读写操作。
 */
import type { CrmDb } from './crm.service.js';
import { callVisibleSql } from '../workspace/company-policy.js';
import { groundCallSummary, summaryFromFields } from '../calllogs/call-analysis.js';
import { effectiveIntentCtes } from './customer-intent.live.js';

// Shared by the library and dashboard. "all" includes masked overviews in
// the library; it never grants access to another employee's customer details.
// These arguments are fixed SQL fragments supplied by this repository/route,
// never request data. Sharing the aggregate keeps list and dashboard semantics.
export const customerIntentCountColumns = (fromSql: string, toSql: string) => `count(*)::int AS contacts,
    count(*) FILTER (WHERE "createdAt">=${fromSql} AND "createdAt"<${toSql})::int AS "newContacts",
    count(*) FILTER (WHERE "intent"='interested')::int AS interested,
    count(*) FILTER (WHERE "intent"='interested' AND "stage" IN ('pending','requested','failed','deferred'))::int AS pending,
    count(*) FILTER (WHERE "intent"='interested' AND "profile"->>'hasAddedWechat'='true')::int AS added,
    count(*) FILTER (WHERE "intent"='interested' AND "stage"='sent')::int AS sent,
    count(*) FILTER (WHERE "intent"='optout')::int AS "optOuts"`;

export async function customerIntentCounts(db: CrmDb, workspaceId: string, userId: string, mine: boolean, from: Date = new Date(0), to: Date = new Date()) {
  const rows = await db.query(`${effectiveIntentCtes} SELECT ${customerIntentCountColumns('$4','$5')}
    FROM effective_customers WHERE "workspaceId"=$1 AND (NOT $2 OR "ownerId"=$3)`, [workspaceId, mine, userId, from, to]);
  return rows[0] as { contacts: number; newContacts: number; interested: number; pending: number; added: number; sent: number; optOuts: number };
}

export async function customerCallSummaries(db: CrmDb, workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { summary: string; evidence: string }>();
  const [calls, transcripts] = await Promise.all([
    db.query(`${effectiveIntentCtes} SELECT l."callId",l."dataExtracted",l."metadata",k."recognitionStatus",k."evidence" AS "liveEvidence" FROM "CallLog" l JOIN effective_calls k ON k."workspaceId"=l."organizationId" AND k."callId"=l."callId" WHERE l."organizationId"=$1 AND l."callId"=ANY($2::text[]) AND l."deleted"=false`, [workspaceId, ids]),
    db.query(`SELECT t."callLogId",t."speaker",t."messageText" FROM
      (SELECT t.*,row_number() OVER (PARTITION BY t."callLogId" ORDER BY t."timestamp",t."callTransId") AS rn
       FROM "CallTranscript" t JOIN "CallLog" l ON l."callId"=t."callLogId"
       WHERE l."organizationId"=$1 AND l."deleted"=false AND t."callLogId"=ANY($2::text[])) t WHERE rn<=1000 ORDER BY t."callLogId",rn`, [workspaceId, ids]),
  ]);
  const grouped = new Map<string, Array<{ speaker: string; messageText: string }>>();
  for (const row of transcripts) {
    const list = grouped.get(row.callLogId) || [];
    list.push({ speaker: row.speaker, messageText: row.messageText }); grouped.set(row.callLogId, list);
  }
  return new Map(calls.map(call => {
    if (call.recognitionStatus === 'provisional') return [call.callId, { summary: '通话中识别到意向表达，结束后核验。', evidence: String(call.liveEvidence || '') }];
    const safe = groundCallSummary(summaryFromFields(call.dataExtracted), grouped.get(call.callId) || [], call.metadata);
    return [call.callId, { summary: safe?.summary || '暂无可核对的客户原话，客户需求待核实。', evidence: safe?.need || '' }];
  }));
}

// An explicitly assigned customer grants access only to that customer's linked
// calls. The original call employee remains unchanged for historical attribution.
// The route supplies server-verified system administrator access. IDs never grant access.
export async function customerIntentCallRows(db: CrmDb, workspaceId: string, userId: string, isSystemAdmin: boolean, ids: string[] | null) {
  return db.query(`${effectiveIntentCtes} SELECT k.*,c."id" AS "customerId",c."ownerId" AS "customerOwner",c."stage",c."intent" AS "customerIntent",c."profile"->'intentConfirmation' AS "manualConfirmation",COALESCE(c.temporary,false) AS temporary
    FROM effective_calls k
    JOIN "CallLog" l ON l."organizationId"=k."workspaceId" AND l."callId"=k."callId"
    LEFT JOIN effective_customers c ON c."workspaceId"=k."workspaceId" AND c."phone"=k."phone"
    WHERE k."workspaceId"=$1 AND l."deleted"=false
    AND ($4::text[] IS NULL OR k."callId"=ANY($4::text[]))
    AND ($3::boolean OR c."ownerId"=$2 OR ${callVisibleSql('l','$1','$2')})
    ORDER BY k."at" DESC LIMIT 2000`, [workspaceId, userId, isSystemAdmin, ids]);
}
