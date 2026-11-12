/*
 * 中文导读：线路与语音外呼：callback.settings.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {callLimitSchema} from './call-limits.js';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import type {Scope,CrmDb,Row} from '../crm/crm.service.js';
import {memberAccess} from '../crm/crm.service.js';
import {scopedOwnerSql,grants} from '../workspace/company-policy.js';
import {companyContext} from '../workspace/company-access.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {CallbackClient,CallbackRejected,CALLBACK_ORIGIN} from './callback.client.js';
import {callbackCredentials,writeCallbackCredentials,canStoreCallbackCredentials,tokenHash} from './callback.credentials.js';

export const callbackSettingsSchema=z.object({enabled:z.boolean().default(false),maxConcurrent:callLimitSchema,callsPerSecond:callLimitSchema,webhookConfirmed:z.boolean().default(false),recordingHosts:z.array(z.string().toLowerCase().regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)).max(10).default([])}).strict();
export async function callbackConnection(workspaceId:string,db:CrmDb=crmDb):Promise<(Row&{settings:z.infer<typeof callbackSettingsSchema>})|null>{const row=(await db.query('SELECT * FROM "CallbackConnection" WHERE "workspaceId"=$1',[workspaceId]))[0];return row?{...row,settings:callbackSettingsSchema.parse(row.settings)}:null;}
export async function callbackClient(workspaceId:string){const creds=await callbackCredentials(workspaceId);if(!creds)throw new BadRequestError('人工回拨密钥尚未配置。');return new CallbackClient(creds);}
async function superadmin(s:Scope){if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('人工回拨接口仅系统超级管理员可以配置。');}
const publicOrigin=()=>{
 const raw=(process.env.CONSOLE_URL||'').split(',')[0]||'';
 try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password)return url.origin;}catch{}
 return '';
};
export async function callbackCatalog(s:Scope){
 const access=await companyContext(s.workspaceId,s.userId),row=await callbackConnection(s.workspaceId),creds=access.isSystemAdmin?await callbackCredentials(s.workspaceId):null;
 const employees=await crmDb.query(`SELECT m."userId",u."name",COALESCE(d."name",'') AS "department",s."phone",s."available",COALESCE(e."ready" AND e."phone"=s."phone",false) AS "ready" FROM "Member" m JOIN "User" u ON u."id"=m."userId" JOIN "SipSeat" s ON s."workspaceId"=m."organizationId" AND s."userId"=m."userId" AND s."deletedAt" IS NULL LEFT JOIN "CallbackEmployee" e ON e."workspaceId"=m."organizationId" AND e."userId"=m."userId" LEFT JOIN "CompanyDepartment" d ON d."organizationId"=m."organizationId" AND d."id"=m."companyDepartmentId" WHERE m."organizationId"=$1 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND ${scopedOwnerSql('m."userId"')} ORDER BY u."name"`,[s.workspaceId,s.userId]);
 return {canConfigure:access.isSystemAdmin,configured:!!row,canStore:canStoreCallbackCredentials(),provider:'好客呼人工回拨',...(row?.settings||callbackSettingsSchema.parse({})),connected:!!row?.connected,updatedAt:row?.updatedAt||null,checkedAt:row?.checkedAt||null,lastWebhookAt:row?.lastWebhookAt||null,employees,
  ...(access.isSystemAdmin?{apiOrigin:CALLBACK_ORIGIN,appKey:creds?.appKey||'',callbackUrl:creds&&publicOrigin()?publicOrigin()+'/api/v1/telephony/callback/hooks/'+creds.hookToken:'',credentialConfigured:!!creds}:{}),
 };
}
export async function saveCallbackSettings(s:Scope,input:unknown){
 await superadmin(s);
 const parsed=z.object({settings:callbackSettingsSchema,appKey:z.string().regex(/^\d{8,40}$/).optional(),appSecret:z.string().min(8).max(512).regex(/^[\x21-\x7e]+$/).optional()}).strict().parse(input);
 const prior=await callbackCredentials(s.workspaceId),creds={appKey:parsed.appKey||prior?.appKey||'',appSecret:parsed.appSecret||prior?.appSecret||''};
 if(!creds.appKey||!creds.appSecret)throw new BadRequestError('请填写回拨平台提供的应用标识和密钥。');
 const accountHash=tokenHash(CALLBACK_ORIGIN+':'+creds.appKey),changed=!prior||prior.appKey!==creds.appKey||prior.appSecret!==creds.appSecret;
 await crmDb.transaction(async d=>{
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['callback-configuration']);
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['callback-config:'+s.workspaceId]);
  if((await d.query('SELECT "workspaceId" FROM "CallbackConnection" WHERE "accountHash"=$1 AND "workspaceId"<>$2',[accountHash,s.workspaceId])).length)throw new BadRequestError('该回拨应用已绑定其他工作区，请使用独立应用。');
  if((await d.query(`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."workspaceId"=$1 AND t."snapshot"->>'provider'='HAOKEHU_CALLBACK' AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`,[s.workspaceId])).length)throw new BadRequestError('请先结束或核对人工回拨，再调整接口设置。');
  const stored=await writeCallbackCredentials(s.workspaceId,creds);
  await d.query(`INSERT INTO "CallbackConnection" ("workspaceId","accountHash","hookHash","settings") VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT ("workspaceId") DO UPDATE SET "accountHash"=EXCLUDED."accountHash","hookHash"=EXCLUDED."hookHash","settings"=EXCLUDED."settings","connected"=CASE WHEN $5 THEN false ELSE "CallbackConnection"."connected" END,"checkedAt"=CASE WHEN $5 THEN NULL ELSE "CallbackConnection"."checkedAt" END,"updatedAt"=NOW() RETURNING "workspaceId"`,[s.workspaceId,accountHash,tokenHash(stored.hookToken),JSON.stringify(parsed.settings),changed]);
  if(changed)await d.query('UPDATE "CallbackEmployee" SET "registered"=false,"ready"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 RETURNING "userId"',[s.workspaceId]);
 });
 return callbackCatalog(s);
}
export async function testCallbackConnection(s:Scope){
 await superadmin(s);
 const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 let connected=false;
 try{await (await callbackClient(s.workspaceId)).request('get-count-detail',{censusType:1,startTime:date,endTime:date});connected=true;}catch{}
 await crmDb.query('UPDATE "CallbackConnection" SET "connected"=$2,"checkedAt"=NOW() WHERE "workspaceId"=$1 RETURNING "workspaceId"',[s.workspaceId,connected]);
 return {connected,message:connected?'人工回拨接口已连通；本次没有拨打电话。':'接口未连通，请核对应用密钥、接口授权与服务器白名单。'};
}
function callbackNumbers(value:unknown):string[]{
 const rows=Array.isArray(value)?value:[];
 return [...new Set(rows.filter((row):row is {mode:string|number;num:string}=>!!row&&typeof row==='object'&&(row.mode===1||row.mode==='1')&&typeof row.num==='string'&&/^\d{5,20}$/.test(row.num)).map(row=>row.num))];
}
export async function syncCallbackEmployee(s:Scope,userId:string){
 const access=await memberAccess(crmDb,s);
 if(!grants(access.permissions,'seats','update'))throw new ForbiddenError('员工回拨授权由公司管理员维护。');
 return crmDb.transaction(async d=>{
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['callback-config:'+s.workspaceId]);
  await d.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  if(!grants((await memberAccess(d,s)).permissions,'seats','update'))throw new ForbiddenError('员工回拨授权已变化。');
  const seat=(await d.query(`SELECT u."name",k."phone" FROM "Member" m JOIN "User" u ON u."id"=m."userId" JOIN "SipSeat" k ON k."workspaceId"=m."organizationId" AND k."userId"=m."userId" AND k."deletedAt" IS NULL WHERE m."organizationId"=$1 AND m."userId"=$3 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND ${scopedOwnerSql('m."userId"')}`,[s.workspaceId,s.userId,userId]))[0];
  if(!seat||!/^1[3-9]\d{9}$/.test(seat.phone))throw new BadRequestError('请先给该员工设置有效的接听手机号。');
  const connection=await callbackConnection(s.workspaceId,d);if(!connection?.connected)throw new BadRequestError('请先由超级管理员测试回拨接口。');
  const duplicate=await d.query('SELECT "userId" FROM "CallbackEmployee" WHERE "workspaceId"=$1 AND "phone"=$2 AND "userId"<>$3',[s.workspaceId,seat.phone,userId]);if(duplicate.length)throw new BadRequestError('该接听手机号已关联其他员工。');
  const existing=(await d.query('SELECT * FROM "CallbackEmployee" WHERE "workspaceId"=$1 AND "userId"=$2',[s.workspaceId,userId]))[0];
  const client=await callbackClient(s.workspaceId);
  // Registration, callback mode and line assignment do not dial either phone.
  if(existing?.registered&&existing.phone!==seat.phone)await client.request('update-phone',{oldMobile:existing.phone,newMobile:seat.phone});
  else if(!existing?.registered)await client.request('add-user',{realName:seat.name.slice(0,60),mobile:seat.phone});
  await d.query(`INSERT INTO "CallbackEmployee" ("workspaceId","userId","phone","registered") VALUES ($1,$2,$3,true) ON CONFLICT ("workspaceId","userId") DO UPDATE SET "phone"=EXCLUDED."phone","registered"=true,"ready"=false,"updatedAt"=NOW() RETURNING "userId"`,[s.workspaceId,userId,seat.phone]);
  try{
   await client.request('update-call-type',{telA:seat.phone,mode:'1'});
   const numbers=await client.request('query-num',{telA:seat.phone,mode:'1'});
   // The live API uses ownerNums; version 1.5 documents it as townerNums.
   if(callbackNumbers(numbers?.ownerNums??numbers?.townerNums).length===0){
    const available=callbackNumbers(numbers?.numList);
    if(available.length===0)return {synced:false,message:'员工已登记，但公司尚无可用回拨线路号码，请联系线路方分配。'};
    if(available.length>1)return {synced:false,message:'员工已登记，公司有多个可用回拨线路号码，请先在线路方后台为该员工选择线路，再同步。'};
    const telX=available[0]!;
    await client.request('update-num',{telA:seat.phone,telX});
    const verified=await client.request('query-num',{telA:seat.phone,mode:'1'});
    if(!callbackNumbers(verified?.ownerNums??verified?.townerNums).includes(telX))return {synced:false,message:'员工已登记，但回拨线路分配尚未确认，请核对线路后重新同步。'};
   }
  }catch(e){
   // Keep successful registration, but remain unavailable until both mode and
   // line assignment are verified. Explicit sync never submits a call.
   return {synced:false,message:e instanceof CallbackRejected?e.message:'员工已登记，回拨模式或线路分配尚未确认，请稍后同步。'};
  }
  await d.query('UPDATE "CallbackEmployee" SET "ready"=true,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "userId"=$2 RETURNING "userId"',[s.workspaceId,userId]);
  return {synced:true,message:'员工接听号码已同步，回拨模式和线路分配均已确认。'};
 });
}
