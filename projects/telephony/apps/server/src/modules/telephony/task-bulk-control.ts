/*
 * 中文导读：线路与语音外呼：task-bulk-control.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {crmDb} from '../crm/crm.db.js';
import {memberAccess,type CrmDb,type Scope} from '../crm/crm.service.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {taskAction} from './sip.service.js';

const normalAi=`"deletedAt" IS NULL AND COALESCE("snapshot"->>'mode','AI')<>'MANUAL' AND COALESCE("snapshot"->>'demoCall','false')<>'true' AND COALESCE("snapshot"->>'testCall','false')<>'true'`;
const marker=`"snapshot"->'adminPauseControl'`;
const pauseInput=z.object({requestId:z.string().uuid(),confirmed:z.literal(true)}).strict();
const resumeInput=z.object({batchId:z.string().uuid(),confirmed:z.literal(true)}).strict();
async function assertSuperAdmin(db:CrmDb,s:Scope){
 if(!(await memberAccess(db,s)).isSystemAdmin)throw new ForbiddenError('仅超级管理员可以一键暂停或恢复所有员工的外呼任务。');
}
export async function taskControlStatus(s:Scope){
 const access=await memberAccess(crmDb,s);
 if(!access.isSystemAdmin)return {canControl:false,runningCount:0,activeBatch:null};
 const rows=await crmDb.query(`SELECT count(*) FILTER(WHERE "status"='RUNNING')::int AS "runningCount",
  (SELECT jsonb_build_object('id',${marker}->>'batchId','pausedCount',count(*),'pausedAt',min(${marker}->>'pausedAt')) FROM "SipTask" WHERE "workspaceId"=$1 AND ${normalAi} AND "status"='PAUSED' AND ${marker}->>'state'='PAUSED' GROUP BY ${marker}->>'batchId' ORDER BY min(${marker}->>'pausedAt') DESC LIMIT 1) AS "activeBatch"
  FROM "SipTask" WHERE "workspaceId"=$1 AND ${normalAi}`,[s.workspaceId]);
 return {canControl:true,runningCount:Number(rows[0]?.runningCount)||0,activeBatch:rows[0]?.activeBatch||null};
}
export async function pauseAllTasks(s:Scope,raw:unknown){
 const data=pauseInput.parse(raw);
 return crmDb.transaction(async db=>{
  await assertSuperAdmin(db,s);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-bulk-control:'+s.workspaceId]);
  await assertSuperAdmin(db,s);
  const replay=(await db.query(`SELECT "metadata" FROM "AuditLog" WHERE "organizationId"=$1 AND "action"='outbound.tasks.pause-all' AND "resourceId"=$2 ORDER BY "createdAt" LIMIT 1`,[s.workspaceId,data.requestId]))[0];
  if(replay)return {...replay.metadata,duplicate:true};
  const existing=(await db.query(`SELECT ${marker}->>'batchId' AS id,min(${marker}->>'pausedAt') AS at,count(*)::int AS count FROM "SipTask" WHERE "workspaceId"=$1 AND ${normalAi} AND "status"='PAUSED' AND ${marker}->>'state'='PAUSED' GROUP BY ${marker}->>'batchId' ORDER BY at DESC LIMIT 1`,[s.workspaceId]))[0];
  const batchId=existing?.id||data.requestId,pausedAt=existing?.at||new Date().toISOString();
  const control={batchId,pausedAt,pausedBy:s.userId,state:'PAUSED',requestId:data.requestId};
  const paused=await db.query(`UPDATE "SipTask" SET "status"='PAUSED',"snapshot"=jsonb_set("snapshot",'{adminPauseControl}',$2::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND ${normalAi} AND "status"='RUNNING' RETURNING "id"`,[s.workspaceId,JSON.stringify(control)]);
  const result={batchId:paused.length||existing?batchId:null,pausedCount:paused.length,alreadyPausedCount:Number(existing?.count)||0,duplicate:false,failures:[]};
  await db.query(`INSERT INTO "AuditLog"("auditLogId","organizationId","userId","action","resourceType","resourceId","metadata","createdAt") VALUES($1,$2,$3,'outbound.tasks.pause-all','SipTaskBatch',$4,$5::jsonb,NOW()) RETURNING "auditLogId"`,[randomUUID(),s.workspaceId,s.userId,data.requestId,JSON.stringify(result)]);
  return result;
 });
}
export async function resumeAllTasks(s:Scope,raw:unknown){
 const data=resumeInput.parse(raw);
 return crmDb.transaction(async db=>{
  await assertSuperAdmin(db,s);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-bulk-control:'+s.workspaceId]);
  await assertSuperAdmin(db,s);
  const tasks=await db.query(`SELECT * FROM "SipTask" WHERE "workspaceId"=$1 AND ${marker}->>'batchId'=$2 ORDER BY "id" FOR UPDATE`,[s.workspaceId,data.batchId]);
  if(!tasks.length)throw new BadRequestError('暂停批次不存在或不属于当前工作区。');
  const skipped:{id:string;name:string;reason:string}[]=[],failed:{id:string;name:string;reason:string}[]=[];
  let resumedCount=0;
  for(const task of tasks){
   const item={id:task.id as string,name:task.name as string};
   if(task.snapshot?.adminPauseControl?.state!=='PAUSED'){skipped.push({...item,reason:'本批次任务已经处理，不重复恢复'});continue;}
   let skip='';
   if(task.deletedAt)skip='任务已删除';
   else if(task.status!=='PAUSED')skip='任务状态已变化，保留当前状态';
   else if(Date.parse(task.endTime)<=Date.now())skip='任务结束时间已过，未自动延长';
   else if(!(await db.query(`SELECT "id" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 AND "status"='QUEUED' LIMIT 1`,[s.workspaceId,task.id])).length)skip='没有剩余待拨号码，正在通话的客户正常结束';
   if(skip){
    skipped.push({...item,reason:skip});
    await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{adminPauseControl}',(${marker})||$3::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,task.id,JSON.stringify({state:'SKIPPED',reason:skip,resolvedAt:new Date().toISOString()})]);
    continue;
   }
   await db.query('SAVEPOINT resume_bulk_task');
   try{
    const result=await taskAction(s,task.id,'start',task.id,{db,bulk:true});
    if(result.status==='RUNNING')resumedCount++;
    else skipped.push({...item,reason:'剩余号码不符合线路规则，任务已结束'});
    await db.query(`UPDATE "SipTask" SET "snapshot"=jsonb_set("snapshot",'{adminPauseControl}',(${marker})||$3::jsonb),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,task.id,JSON.stringify({state:'RESUMED',resumedBy:s.userId,resolvedAt:new Date().toISOString()})]);
    await db.query('RELEASE SAVEPOINT resume_bulk_task');
   }catch(error){
    await db.query('ROLLBACK TO SAVEPOINT resume_bulk_task');
    await db.query('RELEASE SAVEPOINT resume_bulk_task');
    failed.push({...item,reason:error instanceof BadRequestError||error instanceof ForbiddenError?error.message:'恢复失败，请核对任务配置后重试'});
   }
  }
  const remainingCount=Number((await db.query(`SELECT count(*)::int AS count FROM "SipTask" WHERE "workspaceId"=$1 AND ${normalAi} AND "status"='PAUSED' AND ${marker}->>'batchId'=$2 AND ${marker}->>'state'='PAUSED'`,[s.workspaceId,data.batchId]))[0]?.count)||0;
  const result={batchId:data.batchId,resumedCount,skipped,failed,remainingCount};
  await db.query(`INSERT INTO "AuditLog"("auditLogId","organizationId","userId","action","resourceType","resourceId","metadata","createdAt") VALUES($1,$2,$3,'outbound.tasks.resume-all','SipTaskBatch',$4,$5::jsonb,NOW()) RETURNING "auditLogId"`,[randomUUID(),s.workspaceId,s.userId,data.batchId,JSON.stringify(result)]);
  return result;
 });
}
