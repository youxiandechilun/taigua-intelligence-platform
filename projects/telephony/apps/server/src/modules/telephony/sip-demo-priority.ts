/*
 * 中文导读：演示通话与普通任务的调度辅助规则。
 */
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {CrmDb} from '../crm/crm.service.js';
import {normalizeTestNumberPhone,normalizeTestNumberPhoneSql} from './test-number-whitelist.settings.js';

// Committed test calls and whitelist changes also invalidate the candidate cache.
// The two-second refresh remains the fallback across server processes.
let queuedRevision = 0;
export function notifyCallPriorityQueued(): void { queuedRevision += 1; }
export function callPriorityQueueRevision(): number { return queuedRevision; }
export const notifyDemoQueued = notifyCallPriorityQueued;
export const demoQueueRevision = callPriorityQueueRevision;

export type SipCapacity={switchMaxSessions:number;maxStartsPerSecond:number};

export async function dispatchMaintenanceHeld(){
  let file;
  try{file=await open('/opt/taigua-sales/shared/sip-dispatch-hold-until',constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  try{
    const info=await file.stat();
    if(!info.isFile()||info.uid!==0||(info.mode&0o022)!==0||info.size>128)throw new Error('Invalid dispatch hold');
    const until=Date.parse((await file.readFile('utf8')).trim());
    if(!Number.isFinite(until))throw new Error('Invalid dispatch hold time');
    return until>Date.now();
  }finally{await file.close();}
}

export async function sipCapacity():Promise<SipCapacity>{
  let file;
  try{file=await open('/opt/taigua-sales/shared/sip-capacity.json',constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {switchMaxSessions:40,maxStartsPerSecond:2};throw error;}
  try{
    const info=await file.stat();
    if(!info.isFile()||info.uid!==0||(info.mode&0o022)!==0||info.size>1024)throw new Error('Invalid SIP capacity file');
    const value:unknown=JSON.parse(await file.readFile('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='maxStartsPerSecond,switchMaxSessions')throw new Error('Invalid SIP capacity settings');
    const capacity=value as SipCapacity;
    if(!Number.isInteger(capacity.switchMaxSessions)||capacity.switchMaxSessions<20||capacity.switchMaxSessions>80||!Number.isInteger(capacity.maxStartsPerSecond)||capacity.maxStartsPerSecond<1||capacity.maxStartsPerSecond>25)throw new Error('Invalid SIP capacity range');
    return capacity;
  }finally{await file.close();}
}

// Take this before a trunk/task/recipient lock. A try-lock cannot wait while a
// configuration/maintenance operation is waiting for an existing trunk claim.
// The lock covers database reservation only, never the external dial request.
export async function trySipDispatchBudgetLock(db:CrmDb){
  return (await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired',['sip-engine-dispatch-budget']))[0]?.acquired===true;
}
export async function trySipTrunkDispatchLock(db:CrmDb,trunkKey:string){
  return (await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired',['sip-trunk:'+trunkKey]))[0]?.acquired===true;
}

export async function hasSipEngineBudget(db:CrmDb,capacity:SipCapacity,reserve=2){
  const row=(await db.query(`WITH active_attempts AS MATERIALIZED (
    SELECT "id","taskId","workspaceId","status" FROM "SipAttempt"
    WHERE "status" IN ('DISPATCHING','DIALING','CONNECTED')
      OR ("status"='NEEDS_REVIEW' AND "leaseUntil">statement_timestamp())
  ), active_task_ids AS MATERIALIZED (
    SELECT DISTINCT "taskId","workspaceId" FROM active_attempts
  ), active_tasks AS MATERIALIZED (
    SELECT t."id",t."workspaceId",t."snapshot"->>'mode' AS mode,
      COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP') AS provider FROM "SipTask" t
    JOIN active_task_ids x ON t."id"=x."taskId" AND t."workspaceId"=x."workspaceId"
  ), occupied AS MATERIALIZED (
    SELECT a."id",(CASE WHEN a."status"='DIALING' THEN 1 ELSE 2 END)
      +CASE WHEN t.mode='MANUAL' THEN 1 ELSE 0 END AS sessions
    FROM active_attempts a JOIN active_tasks t
      ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId"
    WHERE t.provider='HAOKEHU_SIP'
  ) SELECT (COALESCE((SELECT SUM(sessions) FROM occupied),0)
    +(SELECT COUNT(*) FROM "SipLiveHandoff" h JOIN occupied a ON a."id"=h."attemptId"
      WHERE h."status" IN ('RESERVED','CONNECTED')))::int AS used`))[0];
  const used=Number(row?.used);
  return Number.isSafeInteger(used)&&used>=0&&used+reserve<=Math.floor(capacity.switchMaxSessions*0.8);
}

// This database check is authoritative across API requests and worker processes;
// the worker's monotonic-clock list only avoids unnecessary claim transactions.
export async function hasSipStartBudget(db:CrmDb,capacity:SipCapacity,reserve=1){
  const row=(await db.query(`SELECT (
    (SELECT COUNT(*)
      FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId"
      WHERE a."startedAt">statement_timestamp()-INTERVAL '1 second' AND COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP')='HAOKEHU_SIP')
    +(SELECT COUNT(*) FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a."id"=h."attemptId"
      JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId"
      WHERE h."createdAt">statement_timestamp()-INTERVAL '1 second' AND COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP')='HAOKEHU_SIP')
  )::int AS used`))[0];
  const used=Number(row?.used);
  return Number.isSafeInteger(used)&&used>=0&&used+reserve<=capacity.maxStartsPerSecond;
}

export async function claimRecipientDispatchSlot(db:CrmDb,workspaceId:string,phone:string){
  const normalized=normalizeTestNumberPhone(phone);
  const lock=(await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired',['sip-recipient:'+workspaceId+':'+normalized]))[0];
  if(lock?.acquired!==true)return false;
  // An uncertain submission remains protected even after its lease expires.
  // A whitelist removes daily quota only, never permission to submit it twice.
  const busy=await db.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t
    ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId"
    WHERE a."workspaceId"=$1 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')
      AND ${normalizeTestNumberPhoneSql('t."recipients"->a."recipientIndex"->>\'phoneNumber\'')}=$2
    LIMIT 1`,[workspaceId,normalized]);
  return busy.length===0;
}
