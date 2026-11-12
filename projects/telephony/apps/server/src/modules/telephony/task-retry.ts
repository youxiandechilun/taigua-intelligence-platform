/*
 * 中文导读：线路与语音外呼：task-retry.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {CrmDb,Row} from '../crm/crm.service.js';
import { retryRouteAfterResume } from './resume-line.js';

export const taskRetrySchema=z.object({retries:z.number().int().min(0).max(3),retryIntervalMinutes:z.number().int().min(1).max(720)}).strict();
export const taskRetryUpdateSchema=z.object({policy:taskRetrySchema,expectedPolicy:taskRetrySchema,includePrevious:z.boolean().default(false)}).strict();
export function taskRetryPolicy(snapshot:Row){
 const source=snapshot.testCall?{retries:0,retryIntervalMinutes:60}:snapshot.retryPolicy||snapshot.policy||{};
 return taskRetrySchema.parse({retries:source.retries??0,retryIntervalMinutes:source.retryIntervalMinutes??60});
}
const transientReasons=new Set(['NO_ANSWER','NO_USER_RESPONSE','USER_BUSY','NORMAL_TEMPORARY_FAILURE','NETWORK_OUT_OF_ORDER','DESTINATION_OUT_OF_ORDER','RECOVERY_ON_TIMER_EXPIRE','NORMAL_CIRCUIT_CONGESTION','SWITCH_CONGESTION','SERVICE_BUSY','REDIAL_LINE_UNAVAILABLE']);
export function retryEligible(attempt:Row){
 return ['NOT_ANSWERED','FAILED'].includes(attempt.status)&&transientReasons.has(attempt.result?.reason)&&!(attempt.result?.durationSeconds>0)&&!attempt.result?.wasConnected&&!attempt.result?.optOutRequested;
}
export function retryCandidates(attempts:Row[]){
 const latest=new Map<number,Row>();
 for(const a of attempts){
  if(a.status==='CANCELLED'&&a.result?.retryPolicyCancelled===true&&!a.startedAt)continue;
  const old=latest.get(a.recipientIndex);if(!old||a.attemptNumber>old.attemptNumber)latest.set(a.recipientIndex,a);
 }
 return [...latest.values()].filter(retryEligible);
}
// Call under the parent task row lock. The unique attempt key and the guards
// below prevent duplicate receipts/settings saves from scheduling twice.
export async function queueTaskRetry(db:CrmDb,task:Row,attempt:Row,now=new Date(),includePrevious=false){
 const policy=taskRetryPolicy(task.snapshot);
 if(attempt.result?.manualRedial===true)return false;
 if(Object.values(task.snapshot.manualRedials||{}).some((request:any)=>Array.isArray(request?.attemptIds)&&request.attemptIds.includes(attempt.id)))return false;
 if(task.snapshot.mode==='MANUAL'||task.snapshot.testCall||(task.snapshot.provider||'HAOKEHU_SIP')!=='HAOKEHU_SIP'||!retryEligible(attempt)||attempt.attemptNumber>policy.retries)return false;
 const finished=new Date(attempt.finishedAt||now).getTime();
 const next=new Date((includePrevious?now.getTime():Math.min(now.getTime(),finished))+policy.retryIntervalMinutes*60000);
 if(!Number.isFinite(next.getTime())||next.getTime()>=new Date(task.endTime).getTime())return false;
 const retryRoute=retryRouteAfterResume(task.snapshot,attempt);
 const inserted=await db.query(`INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","attemptNumber","trunkKey","nextAttemptAt","result")
 SELECT $1,$2,$3,$4,$5,$6,$7,$9::jsonb WHERE NOT EXISTS (
  SELECT 1 FROM "SipAttempt" a WHERE a."workspaceId"=$2 AND a."taskId"=$3 AND a."recipientIndex"=$4 AND (
   a."status" IN ('COMPLETED','DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW','QUEUED') OR
   (a."attemptNumber">$8 AND NOT(a."status"='CANCELLED' AND a."startedAt" IS NULL AND COALESCE(a."result"->>'retryPolicyCancelled','false')='true'))))
 ON CONFLICT ("taskId","recipientIndex","attemptNumber") DO UPDATE SET "status"='QUEUED',"nextAttemptAt"=EXCLUDED."nextAttemptAt","finishedAt"=NULL,"trunkKey"=EXCLUDED."trunkKey","result"=EXCLUDED."result"
 WHERE "SipAttempt"."status"='CANCELLED' AND "SipAttempt"."startedAt" IS NULL AND "SipAttempt"."result"->>'retryPolicyCancelled'='true' RETURNING "id"`,[randomUUID(),task.workspaceId,task.id,attempt.recipientIndex,attempt.attemptNumber+1,retryRoute.trunkKey,next,attempt.attemptNumber,JSON.stringify(retryRoute.result)]);
 return inserted.length>0;
}
