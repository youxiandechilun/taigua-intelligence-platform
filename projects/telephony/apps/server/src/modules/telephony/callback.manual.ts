/*
 * 中文导读：线路与语音外呼：callback.manual.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {withinCallLimit} from './call-limits.js';
import {isDeepStrictEqual} from 'node:util';
import {randomBytes} from 'node:crypto';
import {crmDb} from '../crm/crm.db.js';
import type {Scope,Row,CrmDb} from '../crm/crm.service.js';
import {assertCustomerRecipients} from '../crm/crm.recipients.js';
import {assertCrmDialable} from '../crm/crm.calls.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {callbackConnection,callbackClient} from './callback.settings.js';
import {CallbackClient,CallbackRejected,CallbackUncertain} from './callback.client.js';
import {inDialWindow} from './sip.service.js';
import {holidayStatus} from './dial-policy.js';
import {writeCallbackLog} from './callback.events.js';
import {claimRecipientDispatchSlot} from './sip-demo-priority.js';
import {isTestNumberWhitelisted} from './test-number-whitelist.settings.js';

export async function callbackPreview(s:Scope,data:Row,line:Row,seat:Row|undefined,connection:Row,db:CrmDb=crmDb){
 const employee=(await db.query('SELECT "ready","phone" FROM "CallbackEmployee" WHERE "workspaceId"=$1 AND "userId"=$2',[s.workspaceId,s.userId]))[0];
 const holiday=holidayStatus(line.dialPolicy,new Date());
 const missing=[!connection.settings.enabled?'人工回拨开关':'',!connection.connected?'回拨接口连接':'',!employee?.ready||employee.phone!==seat?.phone?'员工接听号码同步':'',!seat?.phone?'员工接听号码':'',!seat?.available?'员工在岗状态':'',seat?.phone===data.recipient.phoneNumber?'客户与员工号码相同':'',!inDialWindow(line.dialPolicy,new Date())?'当前不在允许的拨打时间或星期内':'',!holiday.allowed?holiday.message:''].filter(Boolean);
 return {ready:missing.length===0,simulated:true,phoneNumber:data.recipient.phoneNumber,employeePhone:seat?.phone||'',caller:'',lineName:'好客呼人工回拨',province:'',provider:'HAOKEHU_CALLBACK',testNumberWhitelisted:await isTestNumberWhitelisted(s.workspaceId,data.recipient.phoneNumber,db),prioritySupported:false,priorityMode:'provider',queued:false,priorityNotice:'人工回拨由服务商直接提交，不能调整服务商的排队顺序。',steps:['回拨员工接听号码','接听后连接客户','话单自动关联客户','录音生成后即可收听'],missing};
}
export async function dialCallback(s:Scope,data:Row,line:Row,seat:Row|undefined,deps?:{db:CrmDb;client:CallbackClient}){
 const db=deps?.db||crmDb;
 const existing=(await db.query('SELECT "workspaceId","createdBy","recipients","snapshot" FROM "SipTask" WHERE "id"=$1',[data.requestId]))[0];
 if(existing){if(existing.workspaceId!==s.workspaceId||existing.createdBy!==s.userId||existing.snapshot.provider!=='HAOKEHU_CALLBACK'||!isDeepStrictEqual(existing.recipients[0],data.recipient))throw new ForbiddenError('拨号请求归属或客户信息不一致。');return current(s,data.requestId,true,db);}
 const connection=await callbackConnection(s.workspaceId,db);if(!connection)throw new BadRequestError('人工回拨尚未配置。');
 const preview=await callbackPreview(s,data,line,seat,connection,db);
 if(data.confirmation!==data.recipient.phoneNumber)throw new BadRequestError('请核对客户号码后确认拨打。');
 if(!preview.ready)throw new BadRequestError('暂不能拨打：'+preview.missing.join('、')+'。');
 const claim=await db.transaction(async d=>{
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['callback-config:'+s.workspaceId]);
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  const config=await callbackConnection(s.workspaceId,d);
  if(!config?.settings.enabled||!config.connected||config.accountHash!==connection.accountHash)throw new BadRequestError('回拨接口设置已变化，请重新核对。');
  const trunk='callback:'+config.accountHash;
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+trunk]);
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-seat:'+s.workspaceId+':'+s.userId]);
  if(!(await d.query('SELECT "id" FROM "Organization" WHERE "id"=$1 AND "deletedAt" IS NULL FOR SHARE',[s.workspaceId])).length)throw new BadRequestError('公司工作区已删除。');
  const duplicate=(await d.query('SELECT * FROM "SipTask" WHERE "id"=$1',[data.requestId]))[0];
  if(duplicate){if(duplicate.workspaceId!==s.workspaceId||duplicate.createdBy!==s.userId||duplicate.snapshot.provider!=='HAOKEHU_CALLBACK'||!isDeepStrictEqual(duplicate.recipients[0],data.recipient))throw new ForbiddenError('拨号请求归属不一致。');return {duplicate:true};}
  if(!await claimRecipientDispatchSlot(d,s.workspaceId,data.recipient.phoneNumber))throw new BadRequestError('这个号码已有通话或结果待核对，请结束或核对后再拨打。');
  await assertCustomerRecipients(d,s,[data.recipient]);await assertCrmDialable(d,s.workspaceId,[data.recipient.phoneNumber]);
  const fresh=(await d.query(`SELECT k."phone",k."available",e."ready" FROM "SipSeat" k JOIN "CallbackEmployee" e ON e."workspaceId"=k."workspaceId" AND e."userId"=k."userId" AND e."phone"=k."phone" WHERE k."workspaceId"=$1 AND k."userId"=$2 AND k."deletedAt" IS NULL FOR UPDATE OF k,e`,[s.workspaceId,s.userId]))[0];
  if(!fresh?.available||!fresh.ready||fresh.phone!==seat?.phone)throw new BadRequestError('接听号码、在岗状态或回拨授权已变化。');
  const busy=await d.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."workspaceId"=$1 AND t."createdBy"=$2 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId,s.userId]);
  if(busy.length)throw new BadRequestError('你已有通话或待核对记录，请先处理。');
  const dispatchNow=new Date(),dispatchHoliday=holidayStatus(line.dialPolicy,dispatchNow);
  if(!inDialWindow(line.dialPolicy,dispatchNow)||!dispatchHoliday.allowed)throw new BadRequestError('当前不在允许的拨打时段，请稍后重试。');
  const used=(await d.query(`SELECT count(*)::int n FROM "SipAttempt" WHERE "trunkKey"=$1 AND "status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW')`,[trunk]))[0]?.n||0;
  if(!withinCallLimit(config.settings.maxConcurrent,used))throw new BadRequestError('人工回拨额度已占用，请等待当前通话结束。');
  const recent=(await d.query(`SELECT count(*)::int n FROM "SipAttempt" WHERE "trunkKey"=$1 AND "startedAt">NOW()-INTERVAL '1 second'`,[trunk]))[0]?.n||0;
  if(!withinCallLimit(config.settings.callsPerSecond,recent))throw new BadRequestError('拨号频率已达上限，请稍后再试。');
  const snapshot={mode:'MANUAL',provider:'HAOKEHU_CALLBACK',accountHash:config.accountHash,line:{name:'好客呼人工回拨',callerNumber:seat!.phone},policy:{...line.dialPolicy,retries:0},employeePhone:seat!.phone};
  await d.query(`INSERT INTO "SipTask" ("id","workspaceId","createdBy","agentId","name","status","recipients","snapshot","startTime","endTime") VALUES ($1,$2,$3,NULL,'人工客户联系','RUNNING',$4::jsonb,$5::jsonb,NOW(),NOW()+INTERVAL '2 hours') RETURNING "id"`,[data.requestId,s.workspaceId,s.userId,JSON.stringify([data.recipient]),JSON.stringify(snapshot)]);
  await d.query(`INSERT INTO "SipAttempt" ("id","workspaceId","taskId","recipientIndex","trunkKey","status","startedAt","leaseUntil") VALUES ($1,$2,$1,0,$3,'DISPATCHING',clock_timestamp(),clock_timestamp()+INTERVAL '2 hours') RETURNING "id"`,[data.requestId,s.workspaceId,trunk]);
  const notifyToken=randomBytes(32).toString('hex');
  await d.query('INSERT INTO "CallbackCall" ("workspaceId","attemptId","notifyToken") VALUES ($1,$2,$3) RETURNING "attemptId"',[s.workspaceId,data.requestId,notifyToken]);
  const a={workspaceId:s.workspaceId,id:data.requestId,taskId:data.requestId,recipientIndex:0,recipients:[data.recipient],createdBy:s.userId,snapshot};
  await writeCallbackLog(d,a,'IN_PROGRESS','CALLBACK_REQUESTED',0,new Date(),null);
  return {duplicate:false,notifyToken};
 });
 if(claim.duplicate)return current(s,data.requestId,true,db);
 try{
  // Exactly one submission. No fetch retry and no worker may dispatch this call.
  const response=await (deps?.client||await callbackClient(s.workspaceId)).request('call',{telA:seat!.phone,telB:data.recipient.phoneNumber,notifyData:claim.notifyToken});
  if(!response||typeof response.bindId!=='string'||!response.bindId||response.bindId.length>128||response.telA!==seat!.phone||response.telB!==data.recipient.phoneNumber||String(response.model)!=='1')throw new CallbackUncertain();
  await db.transaction(async d=>{
   const row=(await d.query('SELECT "bindId" FROM "CallbackCall" WHERE "workspaceId"=$1 AND "attemptId"=$2 FOR UPDATE',[s.workspaceId,data.requestId]))[0];
   if(row?.bindId&&row.bindId!==response.bindId)throw new CallbackUncertain();
   await d.query('UPDATE "CallbackCall" SET "bindId"=$3,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "attemptId"=$2 RETURNING "attemptId"',[s.workspaceId,data.requestId,response.bindId]);
   await d.query(`UPDATE "SipAttempt" SET "status"='DIALING',"result"='{"reason":"CALLBACK_REQUESTED"}' WHERE "workspaceId"=$1 AND "id"=$2 AND "status"='DISPATCHING' RETURNING "id"`,[s.workspaceId,data.requestId]);
  });
 }catch(error){
  await db.transaction(async d=>{
   const a=(await d.query(`SELECT a.*,t."createdBy",t."snapshot",t."recipients" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."workspaceId"=$1 AND a."id"=$2 FOR UPDATE OF a,t`,[s.workspaceId,data.requestId]))[0];
   if(!a||!['DISPATCHING','DIALING'].includes(a.status))return;
   const rejected=error instanceof CallbackRejected,reason=rejected?'CALLBACK_REJECTED':'CALLBACK_UNCERTAIN';
   await d.query('UPDATE "SipAttempt" SET "status"=$3,"finishedAt"=$4,"result"=$5::jsonb WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,a.id,rejected?'FAILED':'NEEDS_REVIEW',rejected?new Date():null,JSON.stringify({reason,...(rejected?{providerCode:error.providerCode}:{uncertain:true})})]);
   await d.query('UPDATE "SipTask" SET "status"=$3,"error"=$4,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,a.taskId,rejected?'COMPLETED':'NEEDS_REVIEW',rejected?'回拨平台未接受请求，请核对授权与额度':'拨号响应未确认，请核对话单，系统不会重拨']);
   await writeCallbackLog(d,a,rejected?'FAILED':'IN_PROGRESS',reason,0,new Date(a.startedAt),rejected?new Date():null);
  });
 }
 return current(s,data.requestId,false,db);
}
async function current(s:Scope,id:string,duplicate:boolean,db:CrmDb){const row=(await db.query('SELECT "status","result" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "id"=$2',[s.workspaceId,id]))[0];return {id,duplicate,status:row?.status||'NEEDS_REVIEW',reason:row?.result?.reason||'',prioritySupported:false,priorityMode:'provider',queued:false};}
