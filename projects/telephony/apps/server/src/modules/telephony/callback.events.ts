/*
 * 中文导读：线路与语音外呼：callback.events.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {CrmDb,Row} from '../crm/crm.service.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {linkExistingCall} from '../crm/crm.calls.js';

const id=z.union([z.string().min(1).max(128),z.number().int().safe().nonnegative().transform(String)]);
const phone=z.string().regex(/^\d{7,20}$/);
export const callbackEventSchema=z.object({bindId:id,telA:phone,telB:phone,telX:z.string().max(30).default(''),startTime:z.string().max(30),endTime:z.string().max(30),duration:z.coerce.number().int().min(0).max(86400),finishStatus:z.coerce.number().int().min(0).max(4),notifyData:z.string().max(128).optional(),callStatus:z.number().int().min(0).max(2).optional(),preRecordUrl:z.string().max(2048).optional()});
export function providerTime(raw:string){
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))throw new BadRequestError('话单时间格式无效。');
 const value=new Date(raw.replace(' ','T')+'+08:00');
 if(!Number.isFinite(value.getTime())||new Date(value.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')!==raw)throw new BadRequestError('话单时间无效。');
 return value;
}
export function permittedRecordingUrl(raw:string,hosts:string[]){
 try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443')&&hosts.includes(u.hostname)&&!/^\d|localhost$/i.test(u.hostname)?u.href:'';}catch{return '';}
}
export const recordingHosts=(row:Row)=>['crm.hkh10086.com',...(Array.isArray(row?.settings?.recordingHosts)?row.settings.recordingHosts:[])];

// All ownership comes from a saved local attempt, never callback-supplied IDs.
export async function writeCallbackLog(d:CrmDb,a:Row,state:string,reason:string,duration:number,start:Date,end:Date|null,recordingState='WAITING'){
 const r=a.recipients[a.recipientIndex];
 const metadata={mode:'MANUAL',provider:'HAOKEHU_CALLBACK',taskId:a.taskId,attemptId:a.id,recipientIndex:a.recipientIndex,agentId:a.agentId||null,userId:a.createdBy||null,toNumber:r.phoneNumber,fromNumber:a.snapshot.employeePhone,crmCompanyId:r.crmCompanyId||null,crmContactId:r.crmContactId||null,disposition:reason,recordingState};
 const existing=(await d.query('SELECT "deleted" FROM "CallLog" WHERE "callId"=$1',[a.id]))[0];
 if(existing?.deleted)return; // A late callback must not resurrect a deleted recording.
 const saved=await d.query(`INSERT INTO "CallLog" ("callId","organizationId","agentId","userId","startTime","endTime","durationSeconds","status","callerId","metadata","sessionId","direction","deleted") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"CallStatus",$9,$10::jsonb,$1,'outbound',false) ON CONFLICT ("callId") DO UPDATE SET "agentId"=COALESCE("CallLog"."agentId",EXCLUDED."agentId"),"userId"=COALESCE("CallLog"."userId",EXCLUDED."userId"),"endTime"=EXCLUDED."endTime","durationSeconds"=EXCLUDED."durationSeconds","status"=EXCLUDED."status","metadata"=EXCLUDED."metadata","direction"=COALESCE("CallLog"."direction",EXCLUDED."direction") WHERE "CallLog"."organizationId"=EXCLUDED."organizationId" RETURNING "callId"`,[a.id,a.workspaceId,a.agentId||null,a.createdBy,start,end,duration,state,r.phoneNumber,JSON.stringify(metadata)]);
 if(!saved.length)throw new BadRequestError('话单归属不一致。');
 if(['COMPLETED','NOT_ANSWERED','FAILED'].includes(state))await linkExistingCall(d,a.workspaceId,a.id);
}

export async function ingestCallback(db:CrmDb,workspaceId:string,input:unknown,source:'WEBHOOK'|'POLL'='WEBHOOK'){
 const event=callbackEventSchema.parse(input),start=providerTime(event.startTime),end=providerTime(event.endTime);
 if(end<start||end.getTime()>Date.now()+60000||event.duration>(end.getTime()-start.getTime())/1000+5)throw new BadRequestError('话单时间或时长不一致。');
 return db.transaction(async d=>{
  const found=await d.query(`SELECT a.*,t."agentId",t."createdBy",t."snapshot",t."recipients",c."bindId",c."notifyToken",c."recordingUrl",c."recordingState",c."receivedAt" FROM "CallbackCall" c JOIN "SipAttempt" a ON a."workspaceId"=c."workspaceId" AND a."id"=c."attemptId" JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE c."workspaceId"=$1 AND (c."bindId"=$2 OR c."notifyToken"=$3) FOR UPDATE OF c,a,t`,[workspaceId,event.bindId,event.notifyData||'']);
  const a=found[0];
  if(found.length!==1||!a||a.snapshot.provider!=='HAOKEHU_CALLBACK'||a.snapshot.employeePhone!==event.telA||a.recipients[a.recipientIndex]?.phoneNumber!==event.telB||(a.bindId&&a.bindId!==event.bindId)||(event.notifyData&&event.notifyData!==a.notifyToken))throw new BadRequestError('话单未匹配本系统的员工和客户。');
  if(start.getTime()<new Date(a.startedAt).getTime()-300000||start.getTime()>new Date(a.startedAt).getTime()+30*60000)throw new BadRequestError('话单未匹配本次拨号时间。');
  const connection=(await d.query('SELECT "settings" FROM "CallbackConnection" WHERE "workspaceId"=$1',[workspaceId]))[0];
  const url=event.preRecordUrl?permittedRecordingUrl(event.preRecordUrl,recordingHosts(connection||{})):'';
  let storedUrl=url;
  if(!storedUrl&&event.preRecordUrl){try{const pending=new URL(event.preRecordUrl);if(pending.protocol==='https:'&&!pending.username&&!pending.password&&!pending.hash&&(!pending.port||pending.port==='443'))storedUrl=pending.href;}catch{}}
  if(a.recordingState==='READY'&&!url)storedUrl='';
  const recordState=url?(url===a.recordingUrl&&a.recordingState==='READY'?'READY':'PENDING'):a.recordingUrl?a.recordingState:event.preRecordUrl?'HOST_REQUIRED':a.recordingState;
  await d.query(`UPDATE "CallbackCall" SET "bindId"=$3,"recordingUrl"=CASE WHEN $4='' THEN "recordingUrl" ELSE $4 END,"recordingState"=$5,"receivedAt"=NOW(),"nextPollAt"=NOW()+INTERVAL '1 minute',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "attemptId"=$2 RETURNING "attemptId"`,[workspaceId,a.id,event.bindId,storedUrl,recordState]);
  const priorDuration=Number(a.result?.durationSeconds||0),duration=Math.max(event.duration,priorDuration);
  // Repeated/delayed callbacks can enrich recordings, but cannot downgrade a
  // completed call or turn an unrelated phone event into a local call.
  const completed=event.callStatus===1||duration>0||a.status==='COMPLETED',state=completed?'COMPLETED':'NOT_ANSWERED';
  const reason=completed?'CALLBACK_COMPLETED':event.finishStatus===2?'CALLBACK_EMPLOYEE_ABANDONED':event.finishStatus===3?'CALLBACK_CUSTOMER_ABANDONED':'CALLBACK_NOT_CONNECTED';
  await writeCallbackLog(d,a,state,reason,duration,new Date(a.startedAt),end,recordState);
  if(recordState==='READY')await d.query('UPDATE "CallLog" SET "audioRecordingPath"=$3 WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false RETURNING "callId"',[workspaceId,a.id,'callback-recording:'+a.id]);
  await d.query(`UPDATE "SipAttempt" SET "status"=$3,"finishedAt"=GREATEST(COALESCE("finishedAt",$4),$4),"lastEventAt"=NOW(),"leaseUntil"=NULL,"result"=$5::jsonb WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[workspaceId,a.id,state,end,JSON.stringify({durationSeconds:duration,reason,finishStatus:event.finishStatus,recordingState:recordState})]);
  await d.query(`UPDATE "SipTask" SET "status"='COMPLETED',"error"='',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[workspaceId,a.taskId]);
  if(source==='WEBHOOK')await d.query('UPDATE "CallbackConnection" SET "lastWebhookAt"=NOW() WHERE "workspaceId"=$1 RETURNING "workspaceId"',[workspaceId]);
  return {saved:true,callId:a.id};
 });
}
