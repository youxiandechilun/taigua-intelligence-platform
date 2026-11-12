/*
 * 中文导读：线路与语音外呼：live-handoff.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import {resolveHandoffOwner} from '../agent/agent.handoff.js';
import { carrierWindowOpen, carrierRecipientIssue } from './carrier-policy.js';
import { attemptLine } from './attempt-line.js';
import {withinCallLimit} from './call-limits.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('reserve'),attemptId:z.string().uuid()}).strict(),
 z.object({action:z.literal('result'),attemptId:z.string().uuid(),reservationId:z.string().uuid(),status:z.enum(['CONNECTED','FAILED']),reason:z.string().max(160).default('')}).strict(),
]);
export async function liveHandoff(raw:unknown){
 const data=input.parse(raw);
 return crmDb.transaction(async db=>{
  const seed=(await db.query('SELECT "trunkKey" FROM "SipAttempt" WHERE "id"=$1',[data.attemptId]))[0];
  if(!seed)throw new BadRequestError('通话不存在。');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+seed.trunkKey]);
  const attempt=(await db.query(`SELECT a.*,t."snapshot",t."createdBy",t."recipients" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."id"=$1 FOR UPDATE OF a`,[data.attemptId]))[0];
  if(!attempt)throw new BadRequestError('通话不存在。');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-handoff:'+attempt.workspaceId]);
  if(data.action==='result'){
   const changed=await db.query(`UPDATE "SipLiveHandoff" SET "status"=$4,"reason"=$5,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "attemptId"=$2 AND "id"=$3 AND "status"='RESERVED' RETURNING "id"`,[attempt.workspaceId,data.attemptId,data.reservationId,data.status,data.reason]);return {saved:changed.length>0};
  }
  if(attempt.status!=='CONNECTED'||attempt.snapshot.mode==='MANUAL'||!attempt.snapshot.handoff?.enabled)return {available:false,reason:'未启用实时转人工或通话已结束'};
  const prior=(await db.query('SELECT "id" FROM "SipLiveHandoff" WHERE "attemptId"=$1',[data.attemptId]))[0];if(prior)return {available:false,reason:'此通话已申请过人工接听，请等待或安排后续联系'};
   const line = attemptLine(attempt);
  if(!line?.liveEnabled||!carrierWindowOpen(line))return {available:false,reason:'线路未启用'};
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+line.trunkKey]);
  const count=(await db.query(`SELECT COALESCE(sum(CASE WHEN t."snapshot"->>'mode'='MANUAL' THEN 2 ELSE 1 END),0)::int n FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" WHERE a."trunkKey"=$1 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')`,[line.trunkKey]))[0]?.n||0;
  const reserved=(await db.query(`SELECT COUNT(*)::int n FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE a."trunkKey"=$1 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') AND h."status" IN ('CONNECTED','RESERVED')`,[line.trunkKey]))[0]?.n||0;
  if(!withinCallLimit(line.concurrency,Number(count)+Number(reserved),1))return {available:false,reason:'线路暂无空闲转接通道'};
  const recent=(await db.query(`SELECT (SELECT COALESCE(sum(CASE WHEN t."snapshot"->>'mode'='MANUAL' THEN 2 ELSE 1 END),0) FROM "SipAttempt" a JOIN "SipTask" t ON t.id=a."taskId" WHERE a."trunkKey"=$1 AND a."startedAt">NOW()-INTERVAL '1 second')+(SELECT COUNT(*) FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE a."trunkKey"=$1 AND h."createdAt">NOW()-INTERVAL '1 second') AS n`,[line.trunkKey]))[0]?.n||0;
  if(!withinCallLimit(line.callsPerSecond,Number(recent),1))return {available:false,reason:'线路拨号频率暂满，请安排人工跟进'};
  const recipient=attempt.recipients[attempt.recipientIndex];
  const seats=await db.query(`SELECT s."userId",s."phone" FROM "SipSeat" s JOIN "Member" m ON m."organizationId"=s."workspaceId" AND m."userId"=s."userId" JOIN "User" u ON u.id=s."userId" WHERE s."workspaceId"=$1 AND s."available"=true AND s."deletedAt" IS NULL AND s.phone ~ '^(1[3-9][0-9]{9}|0[0-9]{9,11})$' AND s.phone<>$2 AND m.enabled=true AND m."deletedAt" IS NULL AND u.banned=false AND u."deletedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE h."workspaceId"=s."workspaceId" AND h."userId"=s."userId" AND a.status IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') AND h.status IN ('CONNECTED','RESERVED')) AND NOT EXISTS(SELECT 1 FROM "SipTask" t JOIN "SipAttempt" a ON a."taskId"=t.id WHERE t."workspaceId"=s."workspaceId" AND t."createdBy"=s."userId" AND t.snapshot->>'mode'='MANUAL' AND a.status IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')) ORDER BY (s."userId"=$3) DESC,s."updatedAt",s."userId"`,[attempt.workspaceId,recipient.phoneNumber,attempt.snapshot.handoff?.assigneeUserId||'']);
  for(const seat of seats){
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-seat:'+attempt.workspaceId+':'+seat.userId]);
   const fresh=(await db.query('SELECT "phone","available","deletedAt" FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 FOR UPDATE',[attempt.workspaceId,seat.userId]))[0];
   if(!fresh?.available||fresh.deletedAt||fresh.phone!==seat.phone)continue;
   const busy=await db.query(`SELECT h.id FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE h."workspaceId"=$1 AND h."userId"=$2 AND h.status IN ('RESERVED','CONNECTED') AND a.status IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') UNION ALL SELECT a.id FROM "SipAttempt" a JOIN "SipTask" t ON t.id=a."taskId" WHERE t."workspaceId"=$1 AND t."createdBy"=$2 AND t.snapshot->>'mode'='MANUAL' AND a.status IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')`,[attempt.workspaceId,seat.userId]);
   if(busy.length)continue;
    if (line.carrierPolicy?.maxCallsPerNumberPerDay! > 0) {
      const daily = (await db.query(`SELECT (SELECT count(*) FROM "SipAttempt" a JOIN "SipTask" t ON t.id=a."taskId" WHERE a."trunkKey"=$1 AND a."startedAt">=NOW()-INTERVAL '24 hours' AND t.recipients->a."recipientIndex"->>'phoneNumber'=$2)+(SELECT count(*) FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE a."trunkKey"=$1 AND h.phone=$2 AND h."createdAt">=NOW()-INTERVAL '24 hours') AS n`, [line.trunkKey, seat.phone]))[0]?.n || 0;
      if (Number(daily) >= line.carrierPolicy!.maxCallsPerNumberPerDay) continue;
   }
   if(await carrierRecipientIssue(db,{workspaceId:attempt.workspaceId,userId:seat.userId},line,{phoneNumber:seat.phone,name:"在岗坐席",variables:{}}))continue;
   const owner=await resolveHandoffOwner(db,attempt.workspaceId,{enabled:false},[seat.userId],recipient.crmCompanyId);if(!owner)continue;
   const id=randomUUID();await db.query('INSERT INTO "SipLiveHandoff" ("id","workspaceId","attemptId","userId","phone") VALUES ($1,$2,$3,$4,$5)',[id,attempt.workspaceId,data.attemptId,seat.userId,seat.phone]);return {available:true,reservationId:id,phone:seat.phone};
  }
  return {available:false,reason:'暂无有客户访问权限的空闲在岗坐席'};
 });
}
