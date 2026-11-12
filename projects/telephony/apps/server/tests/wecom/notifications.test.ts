/*
 * 中文导读：既有验证代码：notifications.test 的输入、输出及边界场景。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {notificationService,beijingSlot,policyDue} from '../../src/modules/wecom/wecom.notifications.js';
import {wecomClient,WecomSendError} from '../../src/modules/wecom/wecom.client.js';
import type {CrmDb} from '../../src/modules/crm/crm.service.js';
const fixed=new Date('2026-10-12T10:05:20Z');
async function setup(sender:(o:string,u:string,t:string)=>Promise<string>=async()=>'mock-id'){
 const pg=new PGlite();await pg.exec(`CREATE TABLE "Organization"(id text PRIMARY KEY,name text);CREATE TABLE "WecomConnection"("organizationId" text PRIMARY KEY);CREATE TABLE "User"(id text PRIMARY KEY,name text,banned boolean DEFAULT false,"deletedAt" timestamp);CREATE TABLE "Member"("organizationId" text,"userId" text,role text,enabled boolean DEFAULT true);CREATE TABLE "WecomMember"("organizationId" text,"userId" text,"wecomUserId" text);CREATE TABLE "CrmCompany"(id text,"workspaceId" text,"ownerId" text,"authorizedUserIds" text[] DEFAULT '{}',status text,"deletedAt" timestamp,"createdAt" timestamp);CREATE TABLE "CrmTask"("workspaceId" text,"companyId" text,"ownerId" text,"contactId" text,status text,"dueAt" timestamp);CREATE TABLE "CrmContact"(id text,"workspaceId" text,"companyId" text,"doNotCall" boolean,status text,"deletedAt" timestamp);CREATE TABLE "CallLog"("organizationId" text,"userId" text,status text,"durationSeconds" int,"startTime" timestamp,deleted boolean DEFAULT false,metadata jsonb);`);
 await pg.exec(await readFile(new URL('../../prisma/migrations/20261012110000_add_wecom_notifications/migration.sql',import.meta.url),'utf8'));
 await pg.exec(`INSERT INTO "Organization" VALUES ('a','模拟甲公司'),('b','模拟乙公司');INSERT INTO "User"(id,name) VALUES ('admin','管理员'),('alice','甲员工'),('bob','乙员工');INSERT INTO "Member"("organizationId","userId",role) VALUES ('a','admin','owner'),('a','alice','member'),('b','bob','owner');INSERT INTO "WecomMember" VALUES ('a','alice','wa'),('a','admin','wm'),('b','bob','wb');INSERT INTO "CrmCompany" VALUES ('mine','a','alice','{}','INTERESTED',NULL,'2026-10-12'),('shared','a','admin','{alice}','FOLLOW_UP',NULL,'2026-10-12'),('hidden','a','admin','{}','INTERESTED',NULL,'2026-10-12'),('foreign','b','bob','{}','INTERESTED',NULL,'2026-10-12'),('trash','a','alice','{}','INTERESTED','2026-10-12','2026-10-12');INSERT INTO "CrmTask" VALUES ('a','mine','alice',NULL,'PENDING','2026-10-12'),('a','shared','alice',NULL,'PENDING','2026-10-11'),('a','hidden','alice',NULL,'PENDING','2026-10-12'),('b','foreign','bob',NULL,'PENDING','2026-10-12');INSERT INTO "CallLog" VALUES ('a','alice','COMPLETED',60,'2026-10-12',false,'{"provider":"ALIYUN"}'),('a','alice','FAILED',0,'2026-10-12',false,'{"provider":"ALIYUN"}'),('a','admin','COMPLETED',300,'2026-10-12',false,'{"provider":"ALIYUN_AICCS"}'),('b','bob','COMPLETED',999,'2026-10-12',false,'{"provider":"ALIYUN"}'),('a','alice','COMPLETED',999,'2026-10-12',true,'{"provider":"ALIYUN"}'),('a','alice','COMPLETED',999,'2026-10-12',false,'{"provider":"TWILIO"}');`);
 const db:CrmDb={query:async(sql,values=[])=>{const r=await pg.query(sql,values);return r.rows as any;},transaction:fn=>fn(db)};let now=fixed;
 const svc=notificationService(db,sender,async()=>{},()=>now);
 return{pg,svc,db,setNow:(d:Date)=>{now=d;},close:()=>pg.close()};
}
const admin={organizationId:'a',userId:'admin'},alice={organizationId:'a',userId:'alice'};
const policy={enabled:true,time:'18:05',weekdays:[1,2,3,4,5],recipientIds:['alice','admin'],contents:['calls','customers','tasks']};
test('北京时间日期、星期和分钟正确，包括跨日与关闭规则',()=>{assert.deepEqual(beijingSlot(new Date('2026-10-11T16:05:00Z')),{date:'2026-10-12',time:'00:05',weekday:1,start:new Date('2026-10-11T16:00:00Z')});assert.ok(policyDue({...policy,enabledAt:fixed},fixed));assert.ok(!policyDue({...policy,enabledAt:fixed,enabled:false},fixed));assert.ok(!policyDue({...policy,enabledAt:fixed,weekdays:[7]},fixed));});
test('通知默认关闭，预览按员工权限隔离；配置和他人预览受限制',async()=>{const t=await setup();try{
 assert.equal((await t.svc.get(admin)).config.enabled,false);
 const mine=await t.svc.preview(alice);assert.match(mine.content,/今日通话：2 次，接通 1 次/);assert.match(mine.content,/客户库：2 家/);assert.match(mine.content,/今日 1 项，已逾期 1 项/);assert.match((await t.svc.preview(admin)).content,/客户库：3 家/);
 await assert.rejects(t.svc.preview(alice,'admin'));await assert.rejects(t.svc.preview(admin,'bob'));await assert.rejects(t.svc.save(alice,policy));await assert.rejects(t.svc.save(admin,{...policy,recipientIds:['bob']}));
 }finally{await t.close();}});
test('每个员工独立通知，持久记录避免重复发送；记录不泄露正文',async()=>{const sent:any[]=[];const t=await setup(async(o,u,text)=>{sent.push({o,u,text});return'mock';});try{
 await t.svc.save(admin,policy);await t.svc.tick();await t.svc.tick();assert.equal(sent.length,2);assert.match(sent.find(x=>x.u==='wa').text,/客户库：2 家/);assert.match(sent.find(x=>x.u==='wm').text,/客户库：3 家/);
 const logs=await t.svc.logs(alice,1);assert.equal(logs.total,1);assert.equal(logs.rows[0].status,'ACCEPTED');assert.ok(!('content' in logs.rows[0]));assert.equal((await t.svc.logs({organizationId:'b',userId:'bob'},1)).total,0);
 }finally{await t.close();}});
test('员工被禁用后跳过，发送未知状态和服务中断不会自动重发',async()=>{let sent=0;const t=await setup(async()=>{sent++;throw new WecomSendError(true,'结果待核对');});try{
 await t.svc.save(admin,policy);await t.pg.exec(`UPDATE "Member" SET enabled=false WHERE "userId"='alice'`);await t.svc.tick();await t.svc.tick();assert.equal(sent,1);await t.svc.save(admin,{...policy,enabled:false});assert.equal((await t.svc.get(admin)).config.enabled,false);const logs=(await t.svc.logs(admin,1)).rows;assert.equal(logs.find(r=>r.recipientId==='alice').status,'SKIPPED');assert.equal(logs.find(r=>r.recipientId==='admin').status,'UNKNOWN');
 await t.pg.exec(`INSERT INTO "WecomNotificationDelivery"("id","organizationId","recipientId","date","createdAt") VALUES ('crashed','a','alice','2026-10-11','2026-10-11')`);await t.svc.tick();assert.equal((await t.db.query(`SELECT status FROM "WecomNotificationDelivery" WHERE id='crashed'`))[0].status,'UNKNOWN');
 }finally{await t.close();}});
test('关闭和不符合星期的设置不发送，拒呼客户不生成任务通知',async()=>{let count=0;const t=await setup(async()=>{count++;return'mock';});try{
 await t.svc.save(admin,{...policy,enabled:false});await t.svc.tick();assert.equal(count,0);
 await t.svc.save(admin,{...policy,weekdays:[7]});await t.svc.tick();assert.equal(count,0);
 await t.pg.exec(`UPDATE "CrmCompany" SET status='OPT_OUT' WHERE id='mine'`);assert.match((await t.svc.preview(alice)).content,/今日 0 项，已逾期 1 项/);
 }finally{await t.close();}});
test('官方发送契约：精确接收人、重复检查、失败和未知状态、不自动重试',async()=>{
 let posts=0;const requests:any[]=[];let response:any={errcode:0,msgid:'mock-message'};let timeout=false;
 const f=async(url:any,opts:any)=>{if(String(url).includes('/gettoken'))return new Response(JSON.stringify({access_token:'mock',expires_in:7200}));posts++;requests.push({url:String(url),body:JSON.parse(opts.body)});if(timeout)throw new Error('timeout');return new Response(JSON.stringify(response));};
 const c=wecomClient('mock-send','wwmock',{secret:'mock',agentId:'1000001'},f as typeof fetch);
 assert.equal(await c.sendText('wa','模拟通知'),'mock-message');assert.equal(requests[0].body.touser,'wa');assert.equal(requests[0].body.agentid,1000001);assert.equal(requests[0].body.safe,1);assert.equal(requests[0].body.enable_duplicate_check,1);assert.ok(!('toparty' in requests[0].body));
 response={errcode:0,invaliduser:'WA'};await assert.rejects(c.sendText('wa','模拟通知'),(e:any)=>e instanceof WecomSendError&&!e.uncertain);
 timeout=true;await assert.rejects(c.sendText('wa','模拟通知'),(e:any)=>e instanceof WecomSendError&&e.uncertain);assert.equal(posts,3);
 await assert.rejects(c.sendText('@ALL','禁止全员广播'));assert.equal(posts,3);
});
