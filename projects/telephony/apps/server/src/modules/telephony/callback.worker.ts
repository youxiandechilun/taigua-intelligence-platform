/*
 * 中文导读：线路与语音外呼：callback.worker.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {crmDb} from '../crm/crm.db.js';
import type {CrmDb,Row} from '../crm/crm.service.js';
import {callbackConnection,callbackClient} from './callback.settings.js';
import {ingestCallback,providerTime,recordingHosts,permittedRecordingUrl} from './callback.events.js';
import {openCallbackRecording} from './callback.recording.js';

export function detailRows(data:any):Row[]{
 const rows=Array.isArray(data)?data:data?.records||data?.data?.records||data?.data;
 return Array.isArray(rows)?rows.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)):[];
}
const formatted=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
export function matchCdr(rows:Row[],a:Row){
 const candidates=rows.filter(r=>r.telA===a.snapshot.employeePhone&&r.telB===a.recipients[a.recipientIndex]?.phoneNumber);
 const strong=candidates.filter(r=>r.bindId===a.bindId||r.notifyData===a.notifyToken||(a.bindId&&String(r.id)===a.bindId));
 if(strong.length===1)return strong[0];if(strong.length>1)return null;
 const byTime=candidates.filter(r=>{try{return Math.abs(providerTime(r.createTime||r.startTime).getTime()-new Date(a.startedAt).getTime())<=120000;}catch{return false;}});
 return byTime.length===1?byTime[0]:null;
}
export async function pollCallbackCall(workspaceId:string,attemptId:string,db:CrmDb=crmDb){
 const a=(await db.query(`SELECT a.*,t."snapshot",t."recipients",c."bindId",c."notifyToken",c."receivedAt",c."cdrId" FROM "CallbackCall" c JOIN "SipAttempt" a ON a."workspaceId"=c."workspaceId" AND a."id"=c."attemptId" JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE c."workspaceId"=$1 AND c."attemptId"=$2`,[workspaceId,attemptId]))[0];
 if(!a)return {resolved:false,canArchive:false,active:false,known:false,message:'未找到本工作区的回拨话单。'};
 const connection=await callbackConnection(workspaceId,db);
 if(!connection||connection.accountHash!==a.snapshot.accountHash)return {resolved:false,canArchive:false,active:false,known:false,message:'回拨应用已变化，请联系超级管理员核对历史话单。'};
 const start=new Date(a.startedAt),rows:Row[]=[];
 const client=await callbackClient(workspaceId);
 for(let page=1;page<=5;page++){
  const data=await client.request('call-detail',{page,pageSize:100,telA:a.snapshot.employeePhone,telB:a.recipients[a.recipientIndex].phoneNumber,startTimeBegin:formatted(new Date(start.getTime()-180000)),startTimeFinish:formatted(new Date(start.getTime()+2*3600000))});
  const pageRows=detailRows(data);rows.push(...pageRows);if(pageRows.length<100)break;
 }
 const row=matchCdr(rows,a);
 if(row&&String(row.callStatus)!=='0'&&['1','2'].includes(String(row.callStatus))){
  const strong=row.bindId===a.bindId||row.notifyData===a.notifyToken||String(row.id)===a.bindId;
  if(!strong){
   const nearby=await db.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."workspaceId"=$1 AND t."snapshot"->>'provider'='HAOKEHU_CALLBACK' AND t."snapshot"->>'employeePhone'=$2 AND t."recipients"->0->>'phoneNumber'=$3 AND a."startedAt" BETWEEN $4 AND $5`,[workspaceId,a.snapshot.employeePhone,row.telB,new Date(start.getTime()-240000),new Date(start.getTime()+240000)]);
   if(nearby.length!==1)return {resolved:false,active:false,known:false,canArchive:false,message:'附近有多次相同号码拨号，暂无法唯一匹配话单，未自动关联。'};
  }
  if(!row.id||!a.bindId)return {resolved:false,active:false,known:false,canArchive:false,message:'等待平台推送绑定编号，系统不会重复拨号。'};
  const competing=await db.query('SELECT "attemptId" FROM "CallbackCall" WHERE "workspaceId"=$1 AND "cdrId"=$2 AND "attemptId"<>$3',[workspaceId,String(row.id),attemptId]);
  if(competing.length)return {resolved:false,active:false,known:false,canArchive:false,message:'话单已关联其他拨号，未重复导入。'};
  await ingestCallback(db,workspaceId,{bindId:a.bindId,notifyData:a.notifyToken,telA:row.telA,telB:row.telB,telX:row.telX||'',startTime:row.startTime||row.createTime,endTime:row.endTime,duration:row.duration,finishStatus:String(row.callStatus)==='1'?0:4,callStatus:Number(row.callStatus),preRecordUrl:row.preRecordUrl||''},'POLL');
  await db.query('UPDATE "CallbackCall" SET "cdrId"=$3 WHERE "workspaceId"=$1 AND "attemptId"=$2 RETURNING "attemptId"',[workspaceId,attemptId,String(row.id)]);
  return {resolved:true,active:false,known:true,canArchive:false,message:'话单已更新，录音生成后会自动补入。'};
 }
 return {resolved:false,active:false,known:false,canArchive:false,message:'平台尚未返回最终话单，请稍后再核对；系统不会重复拨号。'};
}

async function checkRecording(row:Row){
 const connection=await callbackConnection(row.workspaceId);const hosts=recordingHosts(connection||{});
 if(!permittedRecordingUrl(row.recordingUrl,hosts))return;
 let ready=false;
 try{const response=await openCallbackRecording(row.recordingUrl,hosts,'bytes=0-63');response.destroy();ready=true;}catch{}
 await crmDb.transaction(async d=>{
  const state=ready?'READY':row.recordingChecks>=95?'UNAVAILABLE':'PENDING';
  await d.query('UPDATE "CallbackCall" SET "recordingState"=$3,"recordingChecks"="recordingChecks"+1,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "attemptId"=$2 RETURNING "attemptId"',[row.workspaceId,row.attemptId,state]);
  await d.query(`UPDATE "SipAttempt" SET "result"="result"||jsonb_build_object('recordingState',$3::text) WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`,[row.workspaceId,row.attemptId,state]);
  await d.query(`UPDATE "CallLog" SET "audioRecordingPath"=CASE WHEN $3 THEN $4 ELSE "audioRecordingPath" END,"metadata"=COALESCE("metadata",'{}')||jsonb_build_object('recordingState',$5::text) WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false RETURNING "callId"`,[row.workspaceId,row.attemptId,ready,'callback-recording:'+row.attemptId,state]);
 });
}
let timer:ReturnType<typeof setInterval>|undefined,busy:Promise<void>|undefined;
export async function tickCallbacks(){
 const candidates=await crmDb.query(`SELECT c.* FROM "CallbackCall" c JOIN "SipAttempt" a ON a."workspaceId"=c."workspaceId" AND a."id"=c."attemptId" WHERE c."nextPollAt"<=NOW() AND (c."pollCount"<96 OR (c."recordingState" IN ('PENDING','HOST_REQUIRED') AND c."recordingChecks"<96)) AND a."status"<>'CANCELLED' ORDER BY c."nextPollAt" LIMIT 5`);
 for(const row of candidates){
  // Polling is read-only at the supplier; this worker never calls /call.
  await crmDb.query(`UPDATE "CallbackCall" SET "lastPollAt"=NOW(),"nextPollAt"=NOW()+CASE WHEN "pollCount"<5 THEN INTERVAL '1 minute' WHEN "pollCount"<20 THEN INTERVAL '5 minutes' ELSE INTERVAL '30 minutes' END,"pollCount"="pollCount"+1 WHERE "workspaceId"=$1 AND "attemptId"=$2 RETURNING "attemptId"`,[row.workspaceId,row.attemptId]);
  if(row.pollCount<96)await pollCallbackCall(row.workspaceId,row.attemptId).catch(()=>{});
  const fresh=(await crmDb.query('SELECT * FROM "CallbackCall" WHERE "workspaceId"=$1 AND "attemptId"=$2',[row.workspaceId,row.attemptId]))[0];
  if(fresh?.recordingUrl&&['PENDING','HOST_REQUIRED'].includes(fresh.recordingState))await checkRecording(fresh).catch(()=>{});
 }
}
export function startCallbackWorker(){if(timer)return;timer=setInterval(()=>{if(!busy)busy=tickCallbacks().catch(()=>console.warn('[callback] reconciliation delayed; records preserved')).finally(()=>{busy=undefined;});},30000);timer.unref();}
export async function stopCallbackWorker(){if(timer)clearInterval(timer);timer=undefined;await busy;}
