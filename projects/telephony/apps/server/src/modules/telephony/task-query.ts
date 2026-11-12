/*
 * 中文导读：线路与语音外呼：task-query.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {z} from 'zod';
import type {CrmDb, Row, Scope} from '../crm/crm.service.js';
import {outboundOwnerSql} from './task-visibility.js';
import type {TaskOutcome,TaskResultStats} from './task-outcomes.js';

export const taskPageSchema = z.object({
  page:z.coerce.number().int().min(1).max(100000).default(1),
  pageSize:z.coerce.number().int().min(1).max(100).default(20),
  search:z.string().trim().max(200).default(''),
  status:z.enum(['ALL','DRAFT','RUNNING','WAITING','PAUSED','NEEDS_REVIEW','COMPLETED','FAILED','CANCELLED']).default('ALL'),
  outcome:z.enum(['ALL','ANSWERED','UNANSWERED','FAILED','ASSISTANT','PENDING','ACTIVE','UNCERTAIN','CANCELLED']).default('ALL'),
});
export type TaskPageOptions=z.infer<typeof taskPageSchema>;

// Outcome priority matches taskRecipientOutcomes. The query applies visibility
// before reading attempts and filters before pagination, including old tasks.
export async function visibleOutboundTaskPage(db:CrmDb,scope:Scope,all:boolean,ownerId:string|undefined,kind:'AI'|'MANUAL'|undefined,options:TaskPageOptions){
 const rows=await db.query(`WITH base AS MATERIALIZED (
  SELECT t.*,COALESCE(a."name",'人工坐席') AS "agentName",COALESCE(u."name",'已停用账号') AS "createdByName"
  FROM "SipTask" t
  LEFT JOIN "Agent" a ON a."agentId"=t."agentId" AND a."organizationId"=t."workspaceId"
  LEFT JOIN "User" u ON u."id"=t."createdBy"
  WHERE t."workspaceId"=$1 AND t."deletedAt" IS NULL AND COALESCE(t."snapshot"->>'demoCall','false')<>'true'
   AND ${outboundOwnerSql('t."createdBy"')} AND ($4::text IS NULL OR t."createdBy"=$4)
   AND ($5::text IS NULL OR COALESCE(t."snapshot"->>'mode','AI')=$5)
   AND ($6::text='' OR strpos(lower(t."name"),lower($6))>0 OR strpos(lower(COALESCE(a."name",'人工坐席')),lower($6))>0 OR strpos(lower(COALESCE(u."name",'已停用账号')),lower($6))>0)
   AND ($7::text='ALL' OR t."status"=$7)
 ), attempt_groups AS MATERIALIZED (
  SELECT a."taskId",CASE WHEN a."recipientIndex"<0 THEN jsonb_array_length(b."recipients")+a."recipientIndex" ELSE a."recipientIndex" END AS "recipientIndex",
   bool_or(a."status" IN ('DISPATCHING','DIALING','CONNECTED')) AS active,
   bool_or(a."status"='NEEDS_REVIEW') AS uncertain,
   bool_or(a."result"->>'reason'='ANSWERING_MACHINE') AS assistant,
   bool_or(a."status" IN ('COMPLETED','CONNECTED') OR a."result"->>'wasConnected'='true' OR CASE WHEN COALESCE(a."result"->>'durationSeconds','') ~ '^[0-9]+([.][0-9]+)?$' THEN (a."result"->>'durationSeconds')::numeric>0 ELSE false END) AS answered,
   bool_or(a."status" IN ('COMPLETED','CONNECTED') OR a."result"->'wasConnected'='true'::jsonb OR CASE WHEN COALESCE(a."result"->>'durationSeconds','') ~ '^[0-9]+([.][0-9]+)?$' THEN (a."result"->>'durationSeconds')::numeric>0 ELSE false END) AS stats_answered,
   bool_or(a."startedAt" IS NOT NULL OR a."status" IN ('DIALING','NOT_ANSWERED')) AS stats_dialed,
   bool_or((a."startedAt" IS NOT NULL OR a."status"='NOT_ANSWERED' OR a."result"->>'reason'='ANSWERING_MACHINE' OR a."result"->'wasConnected'='true'::jsonb OR CASE WHEN COALESCE(a."result"->>'durationSeconds','') ~ '^[0-9]+([.][0-9]+)?$' THEN (a."result"->>'durationSeconds')::numeric>0 ELSE false END) AND a."status" IN ('NOT_ANSWERED','FAILED','CANCELLED')) AS stats_unanswered,
   (array_agg(a."status" ORDER BY a."attemptNumber" DESC,a."recipientIndex" ASC))[1] AS latest
  FROM "SipAttempt" a JOIN base b ON b."id"=a."taskId" AND b."workspaceId"=a."workspaceId"
  WHERE NOT(a."status"='CANCELLED' AND COALESCE(a."result"->>'retryPolicyCancelled','false')='true' AND a."startedAt" IS NULL)
  GROUP BY 1,2
 ), outcomes AS MATERIALIZED (
  SELECT b."id" AS "taskId",CASE WHEN g.active THEN 'ACTIVE' WHEN g.uncertain THEN 'UNCERTAIN' WHEN g.assistant THEN 'ASSISTANT' WHEN g.answered THEN 'ANSWERED' WHEN g.latest IS NULL OR g.latest='QUEUED' THEN 'PENDING' WHEN g.latest='NOT_ANSWERED' THEN 'UNANSWERED' WHEN g.latest='FAILED' THEN 'FAILED' ELSE 'CANCELLED' END AS outcome,
   (COALESCE(g.stats_dialed,false) OR COALESCE(g.stats_answered,false) OR COALESCE(g.assistant,false)) AS dialed,
   (COALESCE(g.stats_answered,false) OR COALESCE(g.assistant,false)) AS answered,
   (COALESCE(g.stats_unanswered,false) AND NOT COALESCE(g.stats_answered,false) AND NOT COALESCE(g.assistant,false) AND NOT COALESCE(g.active,false) AND NOT COALESCE(g.uncertain,false)) AS unanswered,
   COALESCE(g.assistant,false) AS assistant,
   (g.latest IS NULL OR g.latest='QUEUED') AS pending
  FROM base b CROSS JOIN LATERAL generate_series(0,jsonb_array_length(CASE WHEN jsonb_typeof(b."recipients")='array' THEN b."recipients" ELSE '[]'::jsonb END)-1) r(idx)
  LEFT JOIN attempt_groups g ON g."taskId"=b."id" AND g."recipientIndex"=r.idx
 ), matched AS MATERIALIZED (
  SELECT b.* FROM base b WHERE $8::text='ALL' OR EXISTS(SELECT 1 FROM outcomes o WHERE o."taskId"=b."id" AND o.outcome=$8)
 )
 SELECT (SELECT count(*)::int FROM matched) AS total,
  LEAST($10::int,GREATEST(1,CEIL((SELECT count(*) FROM matched)::numeric/$9)::int)) AS page,
  COALESCE((SELECT jsonb_agg(p ORDER BY p."createdAt" DESC,p."id" DESC) FROM (SELECT * FROM matched ORDER BY "createdAt" DESC,"id" DESC LIMIT $9 OFFSET (LEAST($10::int,GREATEST(1,CEIL((SELECT count(*) FROM matched)::numeric/$9)::int))-1)*$9) p),'[]'::jsonb) AS items,
  COALESCE((SELECT jsonb_object_agg(x.outcome,x.count) FROM (SELECT o.outcome,count(*)::int AS count FROM outcomes o JOIN matched m ON m."id"=o."taskId" GROUP BY o.outcome) x),'{}'::jsonb) AS "outcomeTotals",
  (SELECT jsonb_build_object('dialed',count(*) FILTER(WHERE o.dialed)::int,'answered',count(*) FILTER(WHERE o.answered)::int,'unanswered',count(*) FILTER(WHERE o.unanswered)::int,'assistant',count(*) FILTER(WHERE o.assistant)::int,'pending',count(*) FILTER(WHERE o.pending)::int) FROM outcomes o JOIN matched m ON m."id"=o."taskId") AS "resultStatsTotals"`,
  [scope.workspaceId,scope.userId,all,ownerId||null,kind||null,options.search,options.status,options.outcome,options.pageSize,options.page]);
 const result=rows[0];
 const outcomeTotals:Record<TaskOutcome,number>={ANSWERED:0,UNANSWERED:0,FAILED:0,ASSISTANT:0,PENDING:0,ACTIVE:0,UNCERTAIN:0,CANCELLED:0,...result?.outcomeTotals};
 const resultStatsTotals:TaskResultStats={dialed:0,answered:0,unanswered:0,assistant:0,pending:0,...result?.resultStatsTotals};
 return {items:(result?.items||[]) as Row[],total:Number(result?.total)||0,page:Number(result?.page)||1,pageSize:options.pageSize,outcomeTotals,resultStatsTotals};
}
