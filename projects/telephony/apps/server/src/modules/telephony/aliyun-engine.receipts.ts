/*
 * 中文导读：线路与语音外呼：aliyun-engine.receipts.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { resolveHandoffOwner } from '../agent/agent.handoff.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb,Row } from '../crm/crm.service.js';

const eventSchema=z.object({call_id:z.string().min(1).max(200),out_id:z.string().min(1).max(200),start_time:z.string().max(40).optional(),end_time:z.string().max(40).optional(),originate_time:z.string().max(40).optional(),duration:z.coerce.number().int().min(0).max(7200).default(0),status_code:z.string().max(80).default(''),status_msg:z.string().max(500).optional(),smart_status_code:z.string().max(80).optional(),callee:z.string().max(40).optional(),conversation_record:z.string().max(300000).optional(),record_file:z.string().max(4000).optional()});
export async function enqueueEngineReceipts(input:unknown){
  // Aliyun validates callback addresses with its own sample business ID. Such IDs
  // cannot identify one of our dispatched calls and must not create call records.
  const batch=z.array(eventSchema).min(1).max(100).parse(input).filter(payload=>/^[a-f0-9]{15}$/.test(payload.out_id));
  if(!batch.length)return;
  // Acknowledge only after durable inbox insertion. Processing is independent of SIP.
  await crmDb.transaction(async db=>{for(const payload of batch){const id=createHash('sha256').update(JSON.stringify(payload)).digest('hex');await db.query('INSERT INTO "AliyunEngineReceipt" ("id","payload") VALUES ($1,$2::jsonb) ON CONFLICT ("id") DO NOTHING RETURNING "id"',[id,JSON.stringify(payload)]);}});
}
export function engineRecordingUrl(raw:string){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.aliyuncs.com')&&(!u.port||u.port==='443')?u.toString():'';}catch{return '';}}
function cloudTime(value:unknown,fallback:Date){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value))return fallback;const date=new Date(value.replace(' ','T')+'+08:00');return Number.isFinite(date.getTime())?date:fallback;}
async function applyReceipt(db:CrmDb,event:Row){
  const a=(await db.query(`SELECT c.*,a."status",a."result",a."startedAt",a."recipientIndex",a."taskId",t."snapshot",t."createdBy",t."agentId",t."recipients" FROM "AliyunEngineCall" c JOIN "SipAttempt" a ON a."id"=c."attemptId" AND a."workspaceId"=c."workspaceId" JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE c."outId"=$1 FOR UPDATE OF c,a,t`,[event.out_id]))[0];
  if(!a)throw new Error('Engine receipt mapping pending');
  if(a.remoteId&&a.remoteId!==event.call_id)throw new Error('Engine receipt identity mismatch');
  const recipient=a.recipients[a.recipientIndex];if(event.callee&&event.callee!==recipient.phoneNumber)throw new Error('Engine receipt number mismatch');
  await db.query('UPDATE "AliyunEngineCall" SET "remoteId"=$2 WHERE "attemptId"=$1 RETURNING "attemptId"',[a.attemptId,event.call_id]);
  if(event.record_file){const url=engineRecordingUrl(event.record_file);if(url)await db.query('UPDATE "AliyunEngineCall" SET "recordingUrl"=$2 WHERE "attemptId"=$1 RETURNING "attemptId"',[a.attemptId,url]);}
  else if(!a.lastSequence) {
    const connected=!!event.start_time||event.duration>0||event.smart_status_code==='ANSWERED',status=connected?'COMPLETED':'NOT_ANSWERED';
    const start=cloudTime(event.originate_time||event.start_time,new Date(a.startedAt)),end=cloudTime(event.end_time,new Date());
    const dialogue=a.result?.engineDialogue||{};
    const metadata={handoff:a.snapshot.handoff||null,handoffRequested:dialogue.handoffRequested===true,doNotCallRequested:dialogue.optOutRequested===true,flowTrace:dialogue.flowTrace||[],collected:dialogue.collected||{},flowOutcome:dialogue.flowOutcome||null,flowRevision:a.snapshot.flow?.revision||null,mode:'AI',provider:'ALIYUN_ENGINE',taskId:a.taskId,attemptId:a.attemptId,releaseId:a.snapshot.releaseId,releaseVersion:a.snapshot.releaseVersion,toNumber:recipient.phoneNumber,fromNumber:a.snapshot.line.callerNumber,crmCompanyId:recipient.crmCompanyId||null,crmContactId:recipient.crmContactId||null,remoteId:event.call_id,disposition:event.status_code,resultDescription:event.status_msg||''};
    const prior=(await db.query('SELECT "callId" FROM "CallLog" WHERE "callId"=$1',[a.attemptId])).length;
    await db.query(`INSERT INTO "CallLog" ("callId","organizationId","agentId","userId","startTime","endTime","durationSeconds","status","callerId","metadata","sessionId","direction","deleted") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"CallStatus",$9,$10::jsonb,$11,'OUTBOUND',false) ON CONFLICT ("callId") DO UPDATE SET "endTime"=EXCLUDED."endTime","durationSeconds"=EXCLUDED."durationSeconds","status"=EXCLUDED."status","metadata"=EXCLUDED."metadata" WHERE "CallLog"."organizationId"=EXCLUDED."organizationId" RETURNING "callId"`,[a.attemptId,a.workspaceId,a.agentId,a.createdBy,start,end,event.duration,status,recipient.phoneNumber,JSON.stringify(metadata),event.call_id]);
    if(!prior)await db.query('UPDATE "Agent" SET "callLogsCount"="callLogsCount"+1 WHERE "organizationId"=$1 AND "agentId"=$2 RETURNING "agentId"',[a.workspaceId,a.agentId]);
    await db.query(`UPDATE "SipAttempt" SET "status"=$2,"finishedAt"=$3,"leaseUntil"=NULL,"result"=COALESCE("result",'{}'::jsonb)||$4::jsonb WHERE "id"=$1 RETURNING "id"`,[a.attemptId,status,end,JSON.stringify({reason:connected?'ALIYUN_COMPLETED':'ALIYUN_NOT_CONNECTED',providerCode:event.status_code,durationSeconds:event.duration})]);
    let transcript:Row[]=[];try{const parsed=JSON.parse(event.conversation_record||'[]');if(Array.isArray(parsed))transcript=parsed.slice(0,500);}catch{}
    if(transcript.length&&!(await db.query('SELECT "callTransId" FROM "CallTranscript" WHERE "callLogId"=$1 LIMIT 1',[a.attemptId])).length)for(const t of transcript)if(['assistant','user'].includes(t.role)&&typeof t.content==='string')await db.query('INSERT INTO "CallTranscript" ("callTransId","callLogId","speaker","messageText","timestamp") VALUES ($1,$2,$3,$4,$5) RETURNING "callTransId"',[randomUUID(),a.attemptId,t.role==='user'?'customer':'agent',t.content.slice(0,6000),start]);
    if(recipient.crmCompanyId){
      const valid=await db.query('SELECT "id" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[a.workspaceId,recipient.crmCompanyId]);
      if(valid.length){const links=await db.query('INSERT INTO "CrmCallLink" ("id","workspaceId","companyId","contactId","callId") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("workspaceId","callId") DO NOTHING RETURNING "id"',[randomUUID(),a.workspaceId,recipient.crmCompanyId,recipient.crmContactId||null,a.attemptId]);if(links.length)await db.query(`INSERT INTO "CrmActivity" ("id","workspaceId","companyId","actorId","kind","title","notes","metadata") VALUES ($1,$2,$3,$4,'CALL','客户通话结果',$5,$6::jsonb) RETURNING "id"`,[randomUUID(),a.workspaceId,recipient.crmCompanyId,a.createdBy,event.status_msg||'阿里云通话已结束',JSON.stringify({callId:a.attemptId,provider:'ALIYUN_ENGINE',releaseVersion:a.snapshot.releaseVersion,flowOutcome:dialogue.flowOutcome||null,collected:dialogue.collected||{},handoffRequested:dialogue.handoffRequested===true,doNotCallRequested:dialogue.optOutRequested===true})]);}
    }
    if(dialogue.handoffRequested&&!dialogue.optOutRequested&&recipient.crmCompanyId){
      const company=(await db.query('SELECT "ownerId","status" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[a.workspaceId,recipient.crmCompanyId]))[0];
      if(company&&company.status!=='OPT_OUT') {
        const owner=await resolveHandoffOwner(db,a.workspaceId,a.snapshot.handoff,[company.ownerId,a.createdBy],recipient.crmCompanyId);
        if(owner){
          await db.query(`INSERT INTO "CrmTask" ("id","workspaceId","companyId","contactId","ownerId","title","notes","status","dueAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'客户要求人工跟进','客户在阿里云通话中要求人工，等待负责人跟进。','PENDING',NOW(),NOW()) RETURNING "id"`,[randomUUID(),a.workspaceId,recipient.crmCompanyId,recipient.crmContactId||null,owner.userId]);
          await db.query(`UPDATE "CallLog" SET "metadata"="metadata"||$3::jsonb WHERE "organizationId"=$1 AND "callId"=$2 RETURNING "callId"`,[a.workspaceId,a.attemptId,JSON.stringify({handoffTaskCreated:true,handoffOwnerName:owner.name,handoffUsedFallback:!owner.configured})]);
        }
      }
    }
    await db.query('UPDATE "AliyunEngineCall" SET "lastSequence"=1 WHERE "attemptId"=$1 RETURNING "attemptId"',[a.attemptId]);
    await db.query(`UPDATE "SipTask" SET "status"=CASE WHEN EXISTS (SELECT 1 FROM "SipAttempt" WHERE "taskId"=$1 AND "status"='NEEDS_REVIEW') THEN 'NEEDS_REVIEW' ELSE 'COMPLETED' END,"updatedAt"=NOW() WHERE "id"=$1 AND NOT EXISTS (SELECT 1 FROM "SipAttempt" WHERE "taskId"=$1 AND "status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED')) RETURNING "id"`,[a.taskId]);
  }
  await db.query(`UPDATE "CallLog" SET "audioRecordingPath"=$2 WHERE "callId"=$1 AND EXISTS (SELECT 1 FROM "AliyunEngineCall" WHERE "attemptId"=$1 AND "recordingUrl"<>'') RETURNING "callId"`,[a.attemptId,'aliyun-engine-recording:'+a.attemptId]);
}
let timer:ReturnType<typeof setInterval>|undefined,busy:Promise<void>|undefined;
export function startEngineReceipts(){if(timer)return;timer=setInterval(()=>{if(busy)return;busy=(async()=>{const pending=await crmDb.query('SELECT "id" FROM "AliyunEngineReceipt" WHERE "processedAt" IS NULL AND "nextAt"<=NOW() AND "attempts"<30 ORDER BY "createdAt" LIMIT 20');for(const row of pending)try{await crmDb.transaction(async db=>{const receipt=(await db.query('SELECT * FROM "AliyunEngineReceipt" WHERE "id"=$1 AND "processedAt" IS NULL FOR UPDATE SKIP LOCKED',[row.id]))[0];if(!receipt)return;await applyReceipt(db,receipt.payload);await db.query('UPDATE "AliyunEngineReceipt" SET "processedAt"=NOW() WHERE "id"=$1 RETURNING "id"',[row.id]);});}catch{await crmDb.query('UPDATE "AliyunEngineReceipt" SET "attempts"="attempts"+1,"nextAt"=NOW()+INTERVAL \'1 minute\' WHERE "id"=$1 RETURNING "id"',[row.id]);}})().catch(()=>console.warn('[aliyun-engine] receipt processing pending')).finally(()=>{busy=undefined;});},2000);timer.unref();}
export async function stopEngineReceipts(){if(timer)clearInterval(timer);timer=undefined;await busy;}
