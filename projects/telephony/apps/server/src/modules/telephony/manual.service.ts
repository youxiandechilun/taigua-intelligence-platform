/*
 * 中文导读：线路与语音外呼：manual.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { recognitionRules } from '../crm/intent-recognition.js';
import {handoffChannels,recentHandoffDials} from './task-parallelism.js';
import {carrierWindowOpen,assertCarrierRecipient,carrierRecipientIssue} from './carrier-policy.js';
import {withinCallLimit} from './call-limits.js';
import {callbackConnection} from './callback.settings.js';
import {callbackPreview,dialCallback} from './callback.manual.js';
import {canViewAllOutbound,outboundOwnerSql} from './task-visibility.js';
import {pollCallbackCall} from './callback.worker.js';
import {scopedOwnerSql,grants} from '../workspace/company-policy.js';
import { defaultLineConfiguration, resolveRecipientLines, isLineDispatchable } from './routing.service.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { type Scope, memberAccess } from '../crm/crm.service.js';
import { assertCustomerRecipients } from '../crm/crm.recipients.js';
import { assertCrmDialable } from '../crm/crm.calls.js';
import { dialSelectionSchema } from './sip.schema.js';
import { recipientSchema } from '../aliyun/aliyun.schema.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { bridgeReadiness, bridgeRequest, lineMissing, inDialWindow } from './sip.service.js';
import { holidayStatus } from './dial-policy.js';
import { callNetworkJitterMs } from './voice-operations.settings.js';
import {dispatchMaintenanceHeld,sipCapacity,hasSipEngineBudget,hasSipStartBudget,trySipDispatchBudgetLock,trySipTrunkDispatchLock,claimRecipientDispatchSlot} from './sip-demo-priority.js';
import {isTestNumberWhitelisted} from './test-number-whitelist.settings.js';

const domestic=z.string().regex(/^(1[3-9][0-9]{9}|0[0-9]{9,11})$/,'请填写国内手机号或带区号座机');
const inputSchema=z.object({...dialSelectionSchema.shape,provider:z.literal('HAOKEHU_SIP').optional(),recipient:recipientSchema,requestId:z.string().uuid(),confirmation:z.string().optional()}).strict();
async function members(s:Scope,db=crmDb){return db.query(`SELECT m."userId",u."name",COALESCE(d."name",'') AS "department" FROM "Member" m JOIN "User" u ON u."id"=m."userId" LEFT JOIN "CompanyDepartment" d ON d."organizationId"=m."organizationId" AND d."id"=m."companyDepartmentId" WHERE m."organizationId"=$1 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND ${scopedOwnerSql('m."userId"')} ORDER BY u."name"`,[s.workspaceId,s.userId]);}
export async function seatCandidates(s:Scope){if(!grants((await memberAccess(crmDb,s)).permissions,'seats','create'))throw new ForbiddenError('当前角色不能新增坐席。');return members(s);}
export async function seats(s:Scope){const access=await memberAccess(crmDb,s);return crmDb.query(`SELECT m."userId",u."name" AS "accountName",u."name" AS "name",COALESCE(d."name",'') AS "department",k."phone",k."available" FROM "Member" m JOIN "User" u ON u."id"=m."userId" LEFT JOIN "CompanyDepartment" d ON d."organizationId"=m."organizationId" AND d."id"=m."companyDepartmentId" JOIN "SipSeat" k ON k."workspaceId"=m."organizationId" AND k."userId"=m."userId" AND k."deletedAt" IS NULL WHERE m."organizationId"=$1 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND ($3 OR ${scopedOwnerSql('m."userId"')}) ORDER BY k."department",u."name"`,[s.workspaceId,s.userId,access.allData]);}
export async function saveSeat(s:Scope,userId:string,input:unknown){
 const access=await memberAccess(crmDb,s),data=z.object({phone:domestic.or(z.literal('')).optional(),available:z.boolean(),displayName:z.string().trim().max(60).optional(),department:z.string().trim().max(60).optional()}).strict().parse(input);
 const canManage=grants(access.permissions,'seats','update')||grants(access.permissions,'seats','create');
 if(!canManage&&(userId!==s.userId||data.phone!==undefined||data.displayName!==undefined||data.department!==undefined))throw new ForbiddenError('坐席信息由公司管理员维护；员工可以调整自己的在岗状态。');
 await crmDb.transaction(async d=>{
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  const fresh=await memberAccess(d,s);

  const employee=(await members(s,d)).find(x=>x.userId===userId);
  if(!employee)throw new BadRequestError('员工不存在或已经停用。');
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-seat:'+s.workspaceId+':'+userId]);
  const current=(await d.query('SELECT * FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 FOR UPDATE',[s.workspaceId,userId]))[0];
  if(canManage&&!grants(fresh.permissions,'seats',!current||current.deletedAt?'create':'update'))throw new ForbiddenError('当前角色未授权此坐席操作。');
  if((!current||current.deletedAt)&&!grants(fresh.permissions,'seats','create'))throw new ForbiddenError('当前角色不能新增坐席。');
  if(!canManage&&(!current||current.deletedAt))throw new BadRequestError('请先由公司管理员新增你的坐席。');
  const phone=data.phone??current?.phone??'';
  if(data.available&&!phone)throw new BadRequestError('请先填写接听号码，再设为在岗。');
  if((data.phone!==undefined&&data.phone!==current?.phone||current?.deletedAt)&&await activeHandoff(d,s.workspaceId,userId))throw new BadRequestError('员工正在接听或等待转人工，请结束后调整号码。');
  if((data.phone!==undefined&&phone!==current?.phone||current?.deletedAt)&& (await d.query(`SELECT t."id" FROM "SipTask" t JOIN "SipAttempt" a ON a."workspaceId"=t."workspaceId" AND a."taskId"=t."id" WHERE t."workspaceId"=$1 AND t."createdBy"=$2 AND t."snapshot"->>'mode'='MANUAL' AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId,userId])).length)throw new BadRequestError('员工有通话或待核对记录，请处理后再调整号码。');
  await d.query('INSERT INTO "SipSeat" ("workspaceId","userId","phone","available","displayName","department") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("workspaceId","userId") DO UPDATE SET "phone"=EXCLUDED."phone","available"=EXCLUDED."available","displayName"=EXCLUDED."displayName","department"=EXCLUDED."department","deletedAt"=NULL,"updatedAt"=NOW() RETURNING "userId"',[s.workspaceId,userId,phone,data.available,employee.name,employee.department]);
 });return seats(s);
}
export async function removeSeat(s:Scope,userId:string){
 if(!grants((await memberAccess(crmDb,s)).permissions,'seats','delete'))throw new ForbiddenError('当前角色不能移除坐席。');
 await crmDb.transaction(async d=>{
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  if(!grants((await memberAccess(d,s)).permissions,'seats','delete'))throw new ForbiddenError('当前角色不能移除坐席。');
  if(!(await members(s,d)).some(x=>x.userId===userId))throw new ForbiddenError('员工不在你的管理范围。');
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-seat:'+s.workspaceId+':'+userId]);
  const row=(await d.query('SELECT "userId" FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,userId]))[0];
  if(await activeHandoff(d,s.workspaceId,userId))throw new BadRequestError('员工正在接听或等待转人工，请结束后移除坐席。');
  if(!row)throw new BadRequestError('坐席不存在或已移除。');
  if((await d.query(`SELECT t."id" FROM "SipTask" t JOIN "SipAttempt" a ON a."workspaceId"=t."workspaceId" AND a."taskId"=t."id" WHERE t."workspaceId"=$1 AND t."createdBy"=$2 AND t."snapshot"->>'mode'='MANUAL' AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId,userId])).length)throw new BadRequestError('员工有通话或待核对记录，请处理后再移除坐席。');
  await d.query('UPDATE "SipSeat" SET "deletedAt"=NOW(),"available"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "userId"=$2 RETURNING "userId"',[s.workspaceId,userId]);
 });return {removed:true};
}
async function checked(s:Scope,input:unknown){
 const data=inputSchema.parse(input);
 await assertCustomerRecipients(crmDb,s,[data.recipient]);await assertCrmDialable(crmDb,s.workspaceId,[data.recipient.phoneNumber]);
 const callback=data.lineId?null:await callbackConnection(s.workspaceId);
 const [routes,seat]=await Promise.all([callback?defaultLineConfiguration(s.workspaceId).then(({line})=>[{line,province:'',lineId:''}]):resolveRecipientLines(s,[data.recipient],crmDb,data.lineId?data:undefined),crmDb.query('SELECT * FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 AND "deletedAt" IS NULL',[s.workspaceId,s.userId])]);
 return {data,line:routes[0]!.line,route:routes[0]!,seat:seat[0],callback};
}
export async function previewManual(s:Scope,input:unknown){
 const {data,line,route,seat,callback}=await checked(s,input);
 if(callback)return callbackPreview(s,data,line,seat,callback);
 const bridge=await bridgeReadiness('MANUAL'),now=new Date();
 const holiday=holidayStatus(line.dialPolicy,now);
 const carrierIssue=await carrierRecipientIssue(crmDb,s,line,data.recipient);
 const missing=[carrierIssue,!await isLineDispatchable(s.workspaceId,line)?'线路正在健康冷却':'',await dispatchMaintenanceHeld()?'电话服务正在维护':'',!carrierWindowOpen(line,now)?'当前不在服务商允许的拨打时段':'',!seat?.phone?'员工接听号码':'',!seat?.available?'员工在岗状态':'',seat?.phone===data.recipient.phoneNumber?'客户与员工号码相同':'',!line.liveEnabled?'线路通话开关':'',!withinCallLimit(line.concurrency,0,2)?'两路并发额度':'',!withinCallLimit(line.callsPerSecond,0,2)?'两路拨号额度':'',!inDialWindow(line.dialPolicy,now)?'当前不在允许的拨打时间或星期内':'',!holiday.allowed?holiday.message:'',...lineMissing(line),...bridge.missing].filter(Boolean);
 return {ready:missing.length===0,simulated:true,phoneNumber:data.recipient.phoneNumber,employeePhone:seat?.phone||'',caller:line.callerNumber,lineName:line.name,province:route.province,testNumberWhitelisted:await isTestNumberWhitelisted(s.workspaceId,data.recipient.phoneNumber),priorityMode:'immediate',queued:false,steps:['先呼叫你的接听号码','接听后呼叫客户','双方通话','记录到客户时间线'],missing};
}
export async function dialManual(s:Scope,input:unknown){
 const {data,line,route,seat,callback}=await checked(s,input);
 if(callback)return dialCallback(s,data,line,seat);
 if(data.confirmation!==data.recipient.phoneNumber)throw new BadRequestError('请核对客户号码后确认拨打。');
 if(!seat?.phone||!seat.available)throw new BadRequestError('请先由管理员分配接听号码，并设置为在岗。');
 if(data.recipient.phoneNumber===seat.phone)throw new BadRequestError('客户号码不能与员工接听号码相同。');
 if(!line.liveEnabled||lineMissing(line).length||!(await bridgeReadiness('MANUAL')).ready)throw new BadRequestError('人工通话尚未完成线路联调，当前不能拨号。');
 const now=new Date(),holiday=holidayStatus(line.dialPolicy,now);
 if(!inDialWindow(line.dialPolicy,now))throw new BadRequestError('当前不在允许的拨打时间或星期内。');
 if(!holiday.allowed)throw new BadRequestError(holiday.message+'。');
 if(!carrierWindowOpen(line,now))throw new BadRequestError('当前不在服务商允许的拨打时段。');
 if(await dispatchMaintenanceHeld())throw new BadRequestError('电话服务正在维护，请稍后重试，当前请求尚未拨号。');
 const capacity=await sipCapacity();
 const liveRules=await recognitionRules(crmDb,s.workspaceId);
 const claim=await crmDb.transaction(async d=>{
  if(!await trySipDispatchBudgetLock(d))throw new BadRequestError('电话服务正在分配通道，请稍后重试，当前请求尚未拨号。');
  if(!await trySipTrunkDispatchLock(d,line.trunkKey))throw new BadRequestError('线路正在分配或维护，请稍后重试，当前请求尚未拨号。');
  if(!(await d.query('SELECT "id" FROM "Organization" WHERE "id"=$1 AND "deletedAt" IS NULL FOR SHARE',[s.workspaceId])).length)throw new BadRequestError('公司工作区已删除，不能发起通话。');
  const exists=(await d.query('SELECT * FROM "SipTask" WHERE "id"=$1',[data.requestId]))[0];
  if(exists){if(exists.workspaceId!==s.workspaceId||exists.createdBy!==s.userId||exists.snapshot.mode!=='MANUAL'||exists.recipients[0]?.phoneNumber!==data.recipient.phoneNumber)throw new ForbiddenError('拨号请求归属不一致。');return {id:exists.id,duplicate:true};}
  if(!await claimRecipientDispatchSlot(d,s.workspaceId,data.recipient.phoneNumber))throw new BadRequestError('这个号码已有通话或结果待核对，请结束或核对后再拨打。');
  if(!isDeepStrictEqual(route,(await resolveRecipientLines(s,[data.recipient],d,data.lineId?data:undefined))[0]))throw new BadRequestError('线路设置已变化，请重新核对。');
  const dispatchNow=new Date(),dispatchHoliday=holidayStatus(line.dialPolicy,dispatchNow);
  if(!inDialWindow(line.dialPolicy,dispatchNow)||!carrierWindowOpen(line,dispatchNow)||!dispatchHoliday.allowed)throw new BadRequestError('当前不在允许的拨打时段，请稍后重试。');
  if(!await isLineDispatchable(s.workspaceId,line,d))throw new BadRequestError('线路正在健康冷却，请稍后重试或联系管理员。');
  await assertCarrierRecipient(d,s,line,data.recipient);
  await assertCustomerRecipients(d,s,[data.recipient]);await assertCrmDialable(d,s.workspaceId,[data.recipient.phoneNumber]);
  if(await activeHandoff(d,s.workspaceId,s.userId))throw new BadRequestError('你正在接听转人工电话或已有转接预约，请先结束。');
  const currentSeat=(await d.query('SELECT * FROM "SipSeat" WHERE "workspaceId"=$1 AND "userId"=$2 AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,s.userId]))[0];
  if(!currentSeat?.available||currentSeat.phone!==seat.phone)throw new BadRequestError('接听号码或在岗状态已变化，请重新核对。');
  const count=(await d.query(`SELECT COALESCE(sum(CASE WHEN t."snapshot"->>'mode'='MANUAL' THEN 2 ELSE 1 END),0)::int AS count FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."trunkKey"=$1 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')`,[line.trunkKey]))[0]?.count||0;
  // A bridged manual call consumes two simultaneous provider channels.
  if(!withinCallLimit(line.concurrency,Number(count)+await handoffChannels(d,line.trunkKey),2))throw new BadRequestError('人工通话需要两路线路额度，请等待空闲或联系管理员调整。');
  const recent=(await d.query(`SELECT COALESCE(sum(CASE WHEN t."snapshot"->>'mode'='MANUAL' THEN 2 ELSE 1 END),0)::int AS count FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."trunkKey"=$1 AND a."startedAt">NOW()-INTERVAL '1 second'`,[line.trunkKey]))[0]?.count||0;
  if(!withinCallLimit(line.callsPerSecond,Number(recent)+await recentHandoffDials(d,line.trunkKey),2))throw new BadRequestError('人工通话需要两路拨号额度，请稍后重试或由管理员核对线路频率。');
  if((await d.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE t."workspaceId"=$1 AND t."createdBy"=$2 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId,s.userId])).length)throw new BadRequestError('你已有通话或待核对记录，请先处理。');
  if(await dispatchMaintenanceHeld())throw new BadRequestError('电话服务正在维护，请稍后重试，当前请求尚未拨号。');
  // One bridge launch; provider channel/CPS accounting above still reserves two.
  if(!await hasSipEngineBudget(d,capacity,3)||!await hasSipStartBudget(d,capacity))throw new BadRequestError('电话服务当前容量或拨号频率已满，请稍后重试，当前请求尚未拨号。');
  const testNumberWhitelisted=await isTestNumberWhitelisted(s.workspaceId,data.recipient.phoneNumber,d);
  const snapshot={mode:'MANUAL',line,route,policy:{...line.dialPolicy,retries:0},employeePhone:seat.phone,...liveRules};
  await d.query('INSERT INTO "SipTask" ("id","workspaceId","createdBy","agentId","name","status","recipients","snapshot","startTime","endTime") VALUES ($1,$2,$3,NULL,\'人工客户联系\',\'RUNNING\',$4::jsonb,$5::jsonb,NOW(),NOW()+INTERVAL \'15 minutes\') RETURNING "id"',[data.requestId,s.workspaceId,s.userId,JSON.stringify([data.recipient]),JSON.stringify(snapshot)]);
  await d.query('INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","trunkKey","status","startedAt","leaseUntil") VALUES ($1,$2,$1,0,$3,\'DISPATCHING\',clock_timestamp(),clock_timestamp()+INTERVAL \'20 minutes\') RETURNING "id"',[data.requestId,s.workspaceId,line.trunkKey]);
  return {id:data.requestId,duplicate:false,networkJitterMs:await callNetworkJitterMs(s.workspaceId,d),testNumberWhitelisted};
 });
 if(!claim.duplicate){
  try {await bridgeRequest('/calls',{attemptId:claim.id,workspaceId:s.workspaceId,mode:'MANUAL',phoneNumber:data.recipient.phoneNumber,employeePhone:seat.phone,line,ringTimeoutSeconds:line.ringTimeoutSeconds,instructions:'',opening:'',voice:'',language:'zh-CN',maxDurationSeconds:600,record:true,audio:{networkJitterMs:claim.networkJitterMs},...liveRules});}
  catch {await crmDb.query('UPDATE "SipAttempt" SET "status"=\'NEEDS_REVIEW\' WHERE "id"=$1 AND "status"=\'DISPATCHING\' RETURNING "id"',[claim.id]);await crmDb.query('UPDATE "SipTask" SET "status"=\'NEEDS_REVIEW\',"error"=\'拨号响应未确认，请核对，系统不会重复拨打\' WHERE "id"=$1 RETURNING "id"',[claim.id]);}
 }
 const current=(await crmDb.query('SELECT "status","result" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,claim.id]))[0];
 return {...claim,status:current?.status||'NEEDS_REVIEW',reason:current?.result?.reason||'',priorityMode:'immediate',queued:false};
}
async function owned(s:Scope,id:string){const access=await memberAccess(crmDb,s);const a=(await crmDb.query(`SELECT a.*,t."createdBy",t."snapshot" FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."workspaceId"=$1 AND a."id"=$2 AND ${outboundOwnerSql('t."createdBy"','$4','$3')}`,[s.workspaceId,id,canViewAllOutbound(access),s.userId]))[0];if(!a)throw new ForbiddenError('通话不存在或未授权。');return a;}
export async function control(s:Scope,id:string,input:unknown){const a=await owned(s,id);if(a.snapshot.provider==='HAOKEHU_CALLBACK')throw new BadRequestError('人工回拨请在手机上挂断或操作按键。');const data=z.object({action:z.enum(['hangup','dtmf']),digit:z.string().regex(/^[0-9*#]$/).optional()}).strict().parse(input);if(!['DIALING','CONNECTED','NEEDS_REVIEW','DISPATCHING'].includes(a.status))throw new BadRequestError('当前没有可操作的通话。');if(data.action==='dtmf'&&(a.snapshot.mode!=='MANUAL'||a.status!=='CONNECTED'||!data.digit))throw new BadRequestError('按键仅在人工接通后可用。');await bridgeRequest('/control/'+id,data);return {accepted:true};}
export async function reconcile(s:Scope,id:string,input:unknown){
 if(!(await memberAccess(crmDb,s)).canManage)throw new ForbiddenError('请由公司管理员核对异常通话。');
 const data=z.object({close:z.boolean().default(false),note:z.string().trim().max(500).default('')}).strict().parse(input);const a=await owned(s,id);
 if(a.snapshot.provider==='HAOKEHU_CALLBACK')return pollCallbackCall(s.workspaceId,id);
 const info=await (await bridgeRequest('/status/'+id)).json() as {active:boolean;known:boolean};
 if(!data.close)return info;
 if(a.status!=='NEEDS_REVIEW'||info.active||!data.note)throw new BadRequestError('仅在确认线路没有活动通话后，填写核对说明才能归档。');
 await crmDb.transaction(async d=>{await d.query('UPDATE "SipAttempt" SET "status"=\'CANCELLED\',"finishedAt"=NOW(),"result"=$3::jsonb WHERE "workspaceId"=$1 AND "id"=$2 AND "status"=\'NEEDS_REVIEW\' RETURNING "id"',[s.workspaceId,id,JSON.stringify({reason:'人工核对归档：'+data.note,uncertain:true})]);await d.query('UPDATE "SipTask" SET "status"=\'PAUSED\',"error"=\'异常通话已归档，未自动重拨\' WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,a.taskId]);});return {closed:true};
}

async function activeHandoff(db:import('../crm/crm.service.js').CrmDb,workspaceId:string,userId:string){
 return (await db.query(`SELECT h.id FROM "SipLiveHandoff" h JOIN "SipAttempt" a ON a.id=h."attemptId" WHERE h."workspaceId"=$1 AND h."userId"=$2 AND h.status IN ('RESERVED','CONNECTED') AND a.status IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[workspaceId,userId])).length>0;
}
