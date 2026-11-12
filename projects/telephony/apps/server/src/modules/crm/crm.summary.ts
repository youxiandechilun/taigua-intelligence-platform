/*
 * 中文导读：客户管理：crm.summary.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {createHash,randomUUID} from 'node:crypto';
import {linkExistingCall} from './crm.calls.js';
import type {CrmDb,Row} from './crm.service.js';
/** Apply an already completed cloud summary. This function never calls an AI or telephone API. */
export async function applyCallSummary(db:CrmDb,workspaceId:string,callId:string,runId:string,result:Row){
 return db.transaction(async d=>{
  const source=(await d.query('SELECT "metadata" FROM "CallLog" WHERE "organizationId"=$1 AND "callId"=$2',[workspaceId,callId]))[0];
  if(source?.metadata?.demoCall===true)return {linked:false};
  await linkExistingCall(d,workspaceId,callId);
  const links=await d.query('SELECT l.*,c."status" AS "companyStatus" FROM "CrmCallLink" l JOIN "CrmCompany" c ON c."workspaceId"=l."workspaceId" AND c."id"=l."companyId" WHERE l."workspaceId"=$1 AND l."callId"=$2 AND c."deletedAt" IS NULL FOR UPDATE OF c',[workspaceId,callId]);
  const l=links[0];if(!l)return {linked:false};
  const fingerprint=createHash('sha256').update(JSON.stringify({intent:result.intent,summary:result.summary,nextAction:result.nextAction,handoff:Boolean(result.handoff),reason:result.reason||''})).digest('hex');
  const previous=(await d.query('SELECT "id","metadata" FROM "CrmActivity" WHERE "workspaceId"=$1 AND "companyId"=$2 AND "metadata"->>\'summaryRunId\'=$3',[workspaceId,l.companyId,runId]))[0];
  if(previous?.metadata?.summaryFingerprint===fingerprint)return {linked:true,duplicate:true};
  const mapping:Record<string,string>={INTERESTED:'INTERESTED',FOLLOW_UP:'FOLLOW_UP',NO_NEED:'INVALID',OPT_OUT:'OPT_OUT'};
  const status=l.companyStatus==='OPT_OUT'?'OPT_OUT':result.intent==='OPT_OUT'?'OPT_OUT':l.companyStatus==='WON'?'WON':mapping[result.intent]||l.companyStatus;
  await d.query('UPDATE "CrmCompany" SET "status"=$3::"CrmStatus","nextFollowUp"=CASE WHEN $3=\'OPT_OUT\' THEN NULL ELSE "nextFollowUp" END,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[workspaceId,l.companyId,status]);
  await d.query('UPDATE "CrmLead" SET "status"=CASE WHEN "status"=\'OPT_OUT\' THEN \'OPT_OUT\'::"CrmStatus" ELSE $3::"CrmStatus" END,"nextFollowUp"=CASE WHEN $3=\'OPT_OUT\' THEN NULL ELSE "nextFollowUp" END,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "companyId"=$2 AND ($4::text IS NULL OR "contactId"=$4) RETURNING "id"',[workspaceId,l.companyId,status,l.contactId]);
  if(status==='OPT_OUT'){
   await d.query('UPDATE "CrmContact" SET "doNotCall"=true,"status"=\'OPT_OUT\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "companyId"=$2 RETURNING "id"',[workspaceId,l.companyId]);
   await d.query('UPDATE "CrmTask" SET "status"=\'CANCELLED\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "companyId"=$2 AND "status"=\'PENDING\' RETURNING "id"',[workspaceId,l.companyId]);
  }
  const notes=[String(result.summary||''),'下一步：'+String(result.nextAction||'暂无')].join('\n').slice(0,4000);
  const metadata=JSON.stringify({callId,summaryRunId:runId,summaryFingerprint:fingerprint,status,handoff:Boolean(result.handoff),reason:String(result.reason||'')});
  if(previous)await d.query('UPDATE "CrmActivity" SET "notes"=$4,"metadata"=$5::jsonb WHERE "workspaceId"=$1 AND "companyId"=$2 AND "id"=$3 RETURNING "id"',[workspaceId,l.companyId,previous.id,notes,metadata]);
  else await d.query('INSERT INTO "CrmActivity" ("id","workspaceId","companyId","contactId","actorId","kind","title","notes","metadata") VALUES ($1,$2,$3,$4,\'system\',\'AI_SUMMARY\',\'通话整理与客户意向\',$5,$6::jsonb) RETURNING "id"',[randomUUID(),workspaceId,l.companyId,l.contactId,notes,metadata]);
  return {linked:true,duplicate:false};
 });
}
