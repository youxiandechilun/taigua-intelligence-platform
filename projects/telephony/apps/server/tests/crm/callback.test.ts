/*
 * 中文导读：既有验证代码：callback.test 的输入、输出及边界场景。
 */
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {callbackSign,parseProviderJson,CallbackClient,CallbackRejected,CallbackUncertain} from '../../src/modules/telephony/callback.client.js';
import {ingestCallback,permittedRecordingUrl,providerTime} from '../../src/modules/telephony/callback.events.js';
import {dialCallback} from '../../src/modules/telephony/callback.manual.js';
import {createCallbackRouter} from '../../src/modules/telephony/callback.route.js';
import {tokenHash,callbackCredentials,writeCallbackCredentials} from '../../src/modules/telephony/callback.credentials.js';
import {matchCdr,detailRows} from '../../src/modules/telephony/callback.worker.js';
import {crmService,type CrmDb} from '../../src/modules/crm/crm.service.js';
import {callRows} from '../../src/modules/crm/crm.calls.js';
import {lineSchema} from '../../src/modules/telephony/sip.schema.js';

// All numbers, accounts and credentials below are synthetic. No live service,
// production database, voice engine or worker is contacted by these tests.
const pg=new PGlite();
const adapter=(client:any,nested=false):CrmDb=>({query:async(sql,values=[])=>{if(sql.startsWith('SELECT pg_advisory_xact_lock'))return [];return (await client.query(sql,values)).rows;},transaction:fn=>nested?fn(adapter(client,true)):pg.transaction(tx=>fn(adapter(tx,true)))});
const db=adapter(pg),api=crmService(db),employee={workspaceId:'a',userId:'employee'},admin={workspaceId:'a',userId:'admin'},stranger={workspaceId:'a',userId:'stranger'},other={workspaceId:'b',userId:'admin'};
let server:any,base='',companyId='',secretDir='';
const hook='a'.repeat(64);
const at=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ');
before(async()=>{
 await pg.exec(`
 CREATE TABLE "Organization" (id text PRIMARY KEY,"deletedAt" timestamp);
 CREATE TABLE "User" (id text PRIMARY KEY,name text,email text,role text DEFAULT 'user',banned boolean DEFAULT false,"deletedAt" timestamp);
 CREATE TABLE "CompanyRole" (id text,"workspaceId" text,name text,permissions jsonb,"dataScope" text,rank int);
 CREATE TABLE "CompanyDepartment" (id text,"organizationId" text,name text,"parentId" text);
 CREATE TABLE "Member" (id text PRIMARY KEY,"organizationId" text,"userId" text,role text,enabled boolean DEFAULT true,"companyRoleId" text,"companyDepartmentId" text,"scopeDepartmentIds" text[] DEFAULT '{}',UNIQUE("organizationId","userId"));
 CREATE TYPE "CallStatus" AS ENUM ('IN_PROGRESS','COMPLETED','NOT_ANSWERED','FAILED');
 CREATE TABLE "Agent" ("agentId" text PRIMARY KEY,"organizationId" text,"callLogsCount" int DEFAULT 0);
 CREATE TABLE "CallLog" ("callId" text PRIMARY KEY,"organizationId" text,"agentId" text,"userId" text,"startTime" timestamp,"endTime" timestamp,"durationSeconds" int,status "CallStatus","callerId" text,metadata jsonb,"sessionId" text,direction text,deleted boolean DEFAULT false,"audioRecordingPath" text);
 CREATE TABLE "CallTranscript" ("callTransId" text,"callLogId" text,speaker text,"messageText" text,timestamp timestamp);
 CREATE TABLE "AutomationRun" ("organizationId" text,"sourceId" text,kind text,status text,result jsonb,"updatedAt" timestamp);
 CREATE TABLE "AliyunTask" (id text,"organizationId" text,"remoteId" text,recipients jsonb);
 CREATE TABLE "BusinessContact" (id text,"organizationId" text,"deletedAt" timestamp,status text,notes text,"nextFollowUp" timestamp,"ownerId" text,"companyName" text,industry text,address text,business text,"sourceUrl" text,phone text,"createdAt" timestamp,"updatedAt" timestamp);
 INSERT INTO "Organization" (id) VALUES ('a'),('b');
 INSERT INTO "User" (id,name) VALUES ('admin','模拟管理员'),('employee','模拟员工甲'),('stranger','模拟员工乙');
 INSERT INTO "Member" (id,"organizationId","userId",role) VALUES ('a1','a','admin','owner'),('a2','a','employee','member'),('a3','a','stranger','member'),('b1','b','admin','owner');
 `);
 for(const migration of ['20261011050000_add_workspace_crm','20261013180000_sip_lines','20261015140000_haokehu_callback'])await pg.exec(await readFile(new URL('../../prisma/migrations/'+migration+'/migration.sql',import.meta.url),'utf8'));
 await pg.exec(`ALTER TABLE "SipSeat" ADD COLUMN "deletedAt" timestamp;`);
 const company=await api.createCompany(admin,{name:'模拟回拨客户',phone:'13111112222',ownerId:'employee'});companyId=company.id;
 await db.query('INSERT INTO "CallbackConnection" ("workspaceId","accountHash","hookHash","settings","connected") VALUES ($1,$2,$3,$4::jsonb,true)',['a','account-a',tokenHash(hook),JSON.stringify({enabled:true,maxConcurrent:10,callsPerSecond:10,recordingHosts:[]})]);
 await db.query(`INSERT INTO "SipSeat" ("workspaceId","userId",phone,available) VALUES ('a','employee','13900001111',true)`);
 await db.query(`INSERT INTO "CallbackEmployee" ("workspaceId","userId",phone,registered,ready) VALUES ('a','employee','13900001111',true,true)`);
 const app=express();app.use('/hooks',createCallbackRouter(db));app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode||400).json({message:'rejected'}));server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 secretDir=await mkdtemp(join(tmpdir(),'callback-test-'));
});
after(async()=>{await new Promise<void>(resolve=>server.close(resolve));await pg.close();await rm(secretDir,{recursive:true,force:true});});
const recipient=()=>({phoneNumber:'13111112222',crmCompanyId:companyId,name:'模拟客户',variables:{}});
async function seed(bindId:string|null='bind-'+randomUUID()){
 const id=randomUUID(),notifyToken=randomUUID(),start=new Date(Date.now()-90000);
 await db.query(`INSERT INTO "SipTask" (id,"workspaceId","createdBy",name,status,recipients,snapshot,"startTime","endTime") VALUES ($1,'a','employee','模拟回拨','RUNNING',$2::jsonb,$3::jsonb,$4,NOW()+INTERVAL '1 hour')`,[id,JSON.stringify([recipient()]),JSON.stringify({mode:'MANUAL',provider:'HAOKEHU_CALLBACK',accountHash:'account-a',employeePhone:'13900001111',line:{callerNumber:'13900001111'},policy:{retries:0}}),start]);
 await db.query(`INSERT INTO "SipAttempt" (id,"workspaceId","taskId","recipientIndex","trunkKey",status,"startedAt") VALUES ($1,'a',$1,0,'mock','DIALING',$2)`,[id,start]);
 await db.query('INSERT INTO "CallbackCall" ("workspaceId","attemptId","bindId","notifyToken") VALUES ($1,$2,$3,$4)',['a',id,bindId,notifyToken]);
 return {id,notifyToken,bindId,start,event:{bindId:bindId||'late-bind-'+randomUUID(),notifyData:notifyToken,telA:'13900001111',telB:'13111112222',telX:'13999999999',startTime:at(start),endTime:at(new Date(start.getTime()+60000)),duration:40,finishStatus:1}};
}

test('签名排序、空值、0值与超长数字编号保持准确',()=>{
 const params={telB:'13111112222',empty:'',appKey:'2110593439752994817',mode:0,sign:'ignore'};
 assert.equal(callbackSign(params,'fakeSecret'),createHash('md5').update('fakeSecretappKey2110593439752994817mode0telB13111112222').digest('hex').toUpperCase());
 const source=JSON.stringify({note:'quoted text',duration:12}).replace('{','{"id":2110593439752994817,');
 const parsed=parseProviderJson(source);assert.equal(parsed.id,'2110593439752994817');assert.equal(parsed.note,JSON.parse(source).note);assert.equal(parsed.duration,12);
});
test('平台请求只发送签名、使用正式HTTPS地址、超时不重试且不泄漏密钥',async()=>{
 let count=0;
 const client=new CallbackClient({appKey:'1234567890123456789',appSecret:'fake-SECRET'},async(url,options)=>{
  count++;assert.equal(url,'https://crm.hkh10086.com/admin/base/open-api/call');assert.equal(options?.redirect,'error');assert.equal(JSON.stringify(options).includes('fake-SECRET'),false);
  throw new Error('fake-SECRET');
 });
 await assert.rejects(client.request('call',{telA:'13900001111',telB:'13111112222'}),CallbackUncertain);assert.equal(count,1);
 const denied=new CallbackClient({appKey:'fake',appSecret:'secret'},async()=>new Response('{"code":403,"msg":"secret"}'));
 await assert.rejects(denied.request('call-detail'),(e:any)=>e instanceof CallbackRejected&&!e.message.includes('secret'));
});
test('回调关联员工、客户时间线与话单，重复和乱序不重复建记录',async()=>{
 const a=await seed();await ingestCallback(db,'a',a.event);await ingestCallback(db,'a',a.event);
 await ingestCallback(db,'a',{...a.event,duration:0,finishStatus:3});
 const log=(await db.query('SELECT * FROM "CallLog" WHERE "callId"=$1',[a.id]))[0];assert.equal(log.userId,'employee');assert.equal(log.status,'COMPLETED');assert.equal(log.durationSeconds,40);
 assert.equal(log.metadata.provider,'HAOKEHU_CALLBACK');assert.equal(JSON.stringify(log).includes(a.notifyToken),false);
 assert.equal((await db.query('SELECT * FROM "CrmCallLink" WHERE "callId"=$1',[a.id])).length,1);
 const timeline=await db.query(`SELECT * FROM "CrmActivity" WHERE "metadata"->>'callId'=$1`,[a.id]);assert.equal(timeline.length,1);
 assert.equal((await callRows(db,employee,{})).rows.some(r=>r.localCallId===a.id),true);
 assert.equal((await callRows(db,stranger,{})).rows.some(r=>r.localCallId===a.id),false);
 assert.equal((await callRows(db,other,{})).rows.some(r=>r.localCallId===a.id),false);
});
test('主动查询话单可补入记录，但不能误报已收到平台通知',async()=>{
 await db.query('UPDATE "CallbackConnection" SET "lastWebhookAt"=NULL WHERE "workspaceId"=$1',['a']);
 const a=await seed();await ingestCallback(db,'a',a.event,'POLL');
 assert.equal((await db.query('SELECT "lastWebhookAt" FROM "CallbackConnection" WHERE "workspaceId"=$1',['a']))[0].lastWebhookAt,null);
 assert.equal((await db.query('SELECT status FROM "CallLog" WHERE "callId"=$1',[a.id]))[0].status,'COMPLETED');
 await ingestCallback(db,'a',a.event);
 assert.ok((await db.query('SELECT "lastWebhookAt" FROM "CallbackConnection" WHERE "workspaceId"=$1',['a']))[0].lastWebhookAt);
});
test('跨工作区、错误员工号码、错误客户号码和错误关联码被拒绝',async()=>{
 const a=await seed();
 await assert.rejects(ingestCallback(db,'b',a.event));
 for(const update of [{telA:'13900002222'},{telB:'13111113333'},{notifyData:'wrong'},{startTime:'2025-01-01 00:00:00'},{endTime:'2099-01-01 00:00:00'}])await assert.rejects(ingestCallback(db,'a',{...a.event,...update}));
 assert.equal((await db.query('SELECT * FROM "CallLog" WHERE "callId"=$1',[a.id])).length,0);
 await assert.rejects(db.query('INSERT INTO "CallbackCall" ("workspaceId","attemptId","notifyToken") VALUES ($1,$2,$3)',['b',a.id,randomUUID()]));
});
test('回调早于拨号响应可通过本地关联码匹配；录音晚到只补入原记录',async()=>{
 const a=await seed(null);await ingestCallback(db,'a',a.event);
 await ingestCallback(db,'a',{...a.event,preRecordUrl:'https://crm.hkh10086.com/mock-recording.wav'});
 const record=(await db.query('SELECT * FROM "CallbackCall" WHERE "attemptId"=$1',[a.id]))[0];assert.equal(record.bindId,a.event.bindId);assert.equal(record.recordingState,'PENDING');
 const log=(await db.query('SELECT * FROM "CallLog" WHERE "callId"=$1',[a.id]))[0];assert.equal(log.audioRecordingPath,null);assert.equal(log.metadata.recordingState,'PENDING');assert.equal(JSON.stringify(log.metadata).includes('https://'),false);
 await db.query('UPDATE "CallLog" SET deleted=true WHERE "callId"=$1',[a.id]);await ingestCallback(db,'a',a.event);assert.equal((await db.query('SELECT deleted FROM "CallLog" WHERE "callId"=$1',[a.id]))[0].deleted,true);
});
test('回调必须验证随机令牌，固定ACK，拒绝大体积通知',async()=>{
 const a=await seed();
 for(const token of ['wrong','b'.repeat(64)])assert.equal((await fetch(base+'/hooks/'+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a.event)})).status,403);
 const result=await fetch(base+'/hooks/'+hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(a.event)});assert.equal(result.status,200);assert.deepEqual(await result.json(),{code:200,message:'success'});
 const huge=await fetch(base+'/hooks/'+hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...a.event,padding:'a'.repeat(18000)})});assert.ok(huge.status>=400);
});
test('人工拨号持久化后才提交、请求幂等、未知结果不自动重拨',async()=>{
 await db.query(`UPDATE "SipAttempt" SET status='COMPLETED' WHERE "workspaceId"='a'`);
 const requestId=randomUUID(),data={requestId,recipient:recipient(),confirmation:'13111112222'};let calls=0;
 const client=new CallbackClient({appKey:'fake',appSecret:'secret'},async()=>{
  calls++;assert.equal((await db.query('SELECT * FROM "SipAttempt" WHERE id=$1',[requestId]))[0].status,'DISPATCHING');
  throw new Error('simulate lost response');
 });
 const line=lineSchema.parse({dialPolicy:{start:'00:00',end:'23:59',days:['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'],holidayRestricted:false}});
 const deps={db,client},seat={phone:'13900001111',available:true};
 const first=await dialCallback(employee,data,line,seat,deps);assert.equal(first.status,'NEEDS_REVIEW');
 const second=await dialCallback(employee,data,line,seat,deps);assert.equal(second.duplicate,true);assert.equal(calls,1);
 await assert.rejects(dialCallback(other,data,line,seat,deps));assert.equal(calls,1);
});
test('话单匹配拒绝歧义、兼容分页格式，录音来源严格限制',()=>{
 const a={snapshot:{employeePhone:'13900001111'},recipients:[{phoneNumber:'13111112222'}],recipientIndex:0,bindId:'bind',notifyToken:'notify',startedAt:new Date()};
 const r={id:'long-id',telA:'13900001111',telB:'13111112222',startTime:at(new Date())};
 assert.equal(matchCdr([r,{...r,id:'other'}],a),null);assert.equal(matchCdr([{...r,bindId:'bind'}],a)?.id,'long-id');
 assert.equal(detailRows({records:[r]}).length,1);assert.equal(detailRows({data:[r]}).length,1);
 for(const url of ['http://crm.hkh10086.com/a.wav','https://127.0.0.1/a','https://evil.example/a','https://user:pass@crm.hkh10086.com/a','https://crm.hkh10086.com:444/a'])assert.equal(permittedRecordingUrl(url,['crm.hkh10086.com']),'');
 assert.equal(providerTime('2026-10-15 13:00:00').toISOString(),'2026-10-15T05:00:00.000Z');assert.throws(()=>providerTime('2026-02-30 10:00:00'));
});
test('密钥按工作区隔离保存，不回退到全局密钥',async()=>{
 const prior=process.env.TAIGUA_CALLBACK_CREDENTIAL_FILE;process.env.TAIGUA_CALLBACK_CREDENTIAL_FILE=join(secretDir,'creds.json');
 try{await writeCallbackCredentials('a',{appKey:'1234567890123456789',appSecret:'fake=secret'});assert.equal((await callbackCredentials('a'))?.appSecret,'fake=secret');assert.equal(await callbackCredentials('b'),null);assert.equal((await callbackCredentials('a'))?.hookToken.length,64);}finally{if(prior)process.env.TAIGUA_CALLBACK_CREDENTIAL_FILE=prior;else delete process.env.TAIGUA_CALLBACK_CREDENTIAL_FILE;}
});
