/*
 * 中文导读：既有验证代码：crm.test 的输入、输出及边界场景。
 */
import {applyCallSummary} from '../../src/modules/crm/crm.summary.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {crmService,type CrmDb} from '../../src/modules/crm/crm.service.js';
import {normalizePhone} from '../../src/modules/crm/crm.phone.js';
import {workbook,readWorkbook,importRows,crmTemplateWorkbook} from '../../src/modules/crm/crm.files.js';
import {importFile,importLegacy,previewFile} from '../../src/modules/crm/crm.import.js';
import {callRows,linkExistingCall,manualLink,assertCrmDialable} from '../../src/modules/crm/crm.calls.js';
import {createCrmRouter} from '../../src/modules/crm/crm.http.js';
import {ingestEvent} from '../../src/modules/telephony/sip.events.js';
import {eventSchema} from '../../src/modules/telephony/sip.schema.js';
const pg=new PGlite();
const adapter=(client:any,nested=false):CrmDb=>({query:async(sql,values=[])=>{const r=await client.query(sql,values);return r.rows;},transaction:fn=>nested?fn(adapter(client,true)):pg.transaction(tx=>fn(adapter(tx,true)))});
const db=adapter(pg),api=crmService(db),admin={workspaceId:'a',userId:'admin'},worker={workspaceId:'a',userId:'worker'},other={workspaceId:'b',userId:'admin'},stranger={workspaceId:'a',userId:'stranger'};

test('必填星号表头兼容旧表，电话仍按至少一项校验',()=>{
 for(const mark of ['* ','＊ ','',' *']){
  const rows=importRows([[mark+'公司名称','手机号码','座机号码','座机区号'],['模拟星号企业','13822223333','',''],['模拟座机企业','','88888888','020'],['缺少号码企业','','','']]);
  assert.equal(rows[0]?.error,'');assert.equal(rows[1]?.company?.phone,'02088888888');assert.ok(rows[2]?.error);
 }
 const template=readWorkbook(crmTemplateWorkbook(),'template.xlsx');
 assert.equal(template[0]?.[0],'* 公司名称');assert.equal(importRows(template).length,0);
});

test('灰色示例不计入客户数据，真实错误定位在第4行',()=>{
 const matrix=readWorkbook(crmTemplateWorkbook(),'template.xlsx');
 const valid=matrix[0]!.map(()=>''),invalid=[...valid];
 valid[0]='模拟第3行客户';valid[2]='广州';valid[7]='88888888';
 invalid[0]='模拟第4行客户';invalid[7]='ABC';matrix[2]=valid;matrix[3]=invalid;
 const rows=importRows(matrix);assert.equal(rows.length,2);assert.equal(rows[0]?.line,3);assert.equal(rows[0]?.company?.phone,'02088888888');assert.equal(rows[1]?.line,4);assert.ok(rows[1]?.error);
});

test('Excel 编辑器将中文保存为数字实体时，客户资料与区号仍正确导入',()=>{
 const original=workbook(['公司名称','所在地区','联系电话'],[['模拟导入企业','广州市','88888888']]);
 for(const hex of [false,true]){
  const files=unzipSync(original);
  files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']!).replace(/[^\x00-\x7f]/gu,c=>hex?`&#x${c.codePointAt(0)!.toString(16)};`:`&#${c.codePointAt(0)};`));
  const rows=importRows(readWorkbook(zipSync(files),'edited.xlsx'));
  assert.equal(rows[0]?.error,'');assert.equal(rows[0]?.company?.name,'模拟导入企业');assert.equal(rows[0]?.company?.phone,'02088888888');
 }
});
let server:any,base='';
before(async()=>{await pg.exec(`CREATE TABLE "Organization" (id text primary key);
CREATE TABLE "User" (id text primary key,name text,email text,banned boolean default false,"deletedAt" timestamp);
CREATE TABLE "Member" (id text primary key,"organizationId" text,"userId" text,role text,enabled boolean default true,UNIQUE("organizationId","userId"));
CREATE TYPE "CallStatus" AS ENUM ('IN_PROGRESS','COMPLETED','NOT_ANSWERED','FAILED');
CREATE TABLE "Agent" ("agentId" text primary key,"organizationId" text references "Organization"(id),"callLogsCount" int default 0);
CREATE TABLE "CallLog" ("agentId" text,"userId" text,"endTime" timestamp,"direction" text,"callId" text primary key,"organizationId" text,deleted boolean default false,metadata jsonb,"callerId" text,"startTime" timestamp,"sessionId" text,status text,"durationSeconds" int,"audioRecordingPath" text);
CREATE TABLE "CallTranscript" ("callTransId" text,"callLogId" text,speaker text,"messageText" text,timestamp timestamp);
CREATE TABLE "AutomationRun" ("organizationId" text,"sourceId" text,kind text,status text,result jsonb,"updatedAt" timestamp);
CREATE TABLE "AliyunTask" (id text,"organizationId" text,"remoteId" text,"recipients" jsonb default '[]');
CREATE TABLE "BusinessContact" (id text,"organizationId" text,"ownerId" text,"companyName" text,industry text,address text,business text,"sourceUrl" text,phone text,status text,notes text,"nextFollowUp" timestamp,"createdAt" timestamp,"deletedAt" timestamp,"updatedAt" timestamp default NOW());
INSERT INTO "Organization" VALUES ('a'),('b');
INSERT INTO "User" (id,name) VALUES ('admin','管理员'),('worker','员工甲'),('stranger','员工乙');
INSERT INTO "Member" (id,"organizationId","userId",role) VALUES ('a1','a','admin','owner'),('a2','a','worker','member'),('a3','a','stranger','member'),('b1','b','admin','owner');`);
await pg.exec(await readFile(new URL('../../prisma/migrations/20261011050000_add_workspace_crm/migration.sql',import.meta.url),'utf8'));
await pg.exec(await readFile(new URL('../../prisma/migrations/20261012090000_add_wecom_integration/migration.sql',import.meta.url),'utf8'));
await pg.exec(await readFile(new URL('../../prisma/migrations/20261013180000_sip_lines/migration.sql',import.meta.url),'utf8'));
await db.query('INSERT INTO "WecomMember" VALUES ($1,$2,$3,NOW())',['a','admin','wa']);
const app=express();app.use(express.json());app.use('/crm',createCrmRouter(db,[(req:any,_res,next)=>{if(!req.get('x-user'))return next(Object.assign(new Error('请登录'),{statusCode:401}));req.auth={authMethod:req.get('x-method')||'session',activeOrganizationId:req.get('x-active')||'a',userId:req.get('x-user')};next();}],['http://mock.local']));app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode||500).json({message:e.message}));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/crm`;
});
after(async()=>{await new Promise<void>(r=>server.close(r));await pg.close();});
async function http(path:string,user='admin',method='GET',body?:any,extra={}){return fetch(base+path,{method,headers:{'x-user':user,'x-workspace-id':'a',origin:'http://mock.local','content-type':'application/json',...extra},body:body?JSON.stringify(body):undefined});}
const cname=()=>`模拟企业${randomUUID().slice(0,8)}`;
test('国内号码、明确城市补区号、分机、未知城市拒绝猜测',()=>{assert.equal(normalizePhone('+86 13800138000').phoneKey,'13800138000');assert.deepEqual(normalizePhone('87654321转123','','广州市'),{mobile:'',landline:'87654321',areaCode:'020',extension:'123',phoneKey:'02087654321'});assert.equal(normalizePhone('0755-87654321').areaCode,'0755');assert.throws(()=>normalizePhone('87654321'));assert.throws(()=>normalizePhone('02087654321','0755'));assert.throws(()=>normalizePhone('+1 555 555 5555'));});
test('新增企业/联系人；搜索、过滤、分页、时间线',async()=>{const c=await api.createCompany(admin,{name:cname(),industry:'机械',region:'广州',phone:'87654321',tags:['重点']});const k=await api.createContact(admin,{companyId:c.id,name:'模拟联系人',mobile:'13800138000',landline:'87654321'});assert.equal(k.areaCode,'020');assert.equal((await api.list(admin,'companies',{q:c.name,industry:'机械',region:'广州',tag:'重点',status:'REVIEW',pageSize:1})).total,1);await api.follow(admin,c.id,{status:'INTERESTED',notes:'模拟客户希望了解业务',nextFollowUp:'2026-11-01T09:00:00+08:00',taskTitle:'模拟回访'});const d=await api.detail(admin,c.id);assert.equal(d.status,'INTERESTED');assert.equal(d.tasks.length,1);assert.ok(d.timeline.some((t:any)=>t.kind==='FOLLOW_UP'));await api.completeTask(admin,d.tasks[0].id);assert.equal((await api.detail(admin,c.id)).tasks[0].status,'DONE');});
test('工作区隔离、员工详情/列表/导出隔离、禁用立即生效',async()=>{const name=cname();const a=await api.createCompany(admin,{name,ownerId:'worker'});const b=await api.createCompany(other,{name});assert.equal((await api.list(worker,'companies',{q:name})).total,1);await assert.rejects(api.detail(stranger,a.id));await assert.rejects(api.detail(admin,b.id));assert.equal((await api.list(admin,'companies',{q:name})).rows[0].id,a.id);const r=await http('/export/companies?q='+name,'stranger');assert.equal(r.status,200);assert.equal(readWorkbook(new Uint8Array(await r.arrayBuffer()),'test.xlsx').length,1);await db.query('UPDATE "Member" SET enabled=false WHERE id=$1',['a2']);await assert.rejects(api.list(worker,'companies',{}));await db.query('UPDATE "Member" SET enabled=true WHERE id=$1',['a2']);await assert.rejects(api.assign(worker,[a.id],'stranger'));await api.assign(admin,[a.id],'worker',['stranger']);assert.equal((await api.detail(stranger,a.id)).id,a.id);});
test('数据库复合外键阻止跨工作区、跨企业联系人关联',async()=>{const a=await api.createCompany(admin,{name:cname()});const b=await api.createCompany(other,{name:cname()});const k=await api.createContact(admin,{companyId:a.id,mobile:'13900139000'});await assert.rejects(db.query('INSERT INTO "CrmContact" (id,"workspaceId","companyId","updatedAt") VALUES ($1,$2,$3,NOW())',[randomUUID(),'a',b.id]));const a2=await api.createCompany(admin,{name:cname()});await assert.rejects(db.query('INSERT INTO "CrmLead" (id,"workspaceId","companyId","contactId","updatedAt") VALUES ($1,$2,$3,$4,NOW())',[randomUUID(),'a',a2.id,k.id]));await assert.rejects(api.createContact(admin,{companyId:b.id}));});
test('批量分配交接跟进任务；客户回收与恢复',async()=>{const c=await api.createCompany(admin,{name:cname()});await api.task(admin,{companyId:c.id,title:'模拟任务',dueAt:'2026-11-02T10:00:00Z'});await api.assign(admin,[c.id],'worker');const detail=await api.detail(worker,c.id);assert.equal(detail.tasks[0].ownerId,'worker');await api.recycle(admin,c.id);await assert.rejects(api.detail(worker,c.id));assert.ok((await api.list(admin,'companies',{},true)).rows.some(r=>r.id===c.id));await api.recycle(admin,c.id,true);assert.equal((await api.detail(worker,c.id)).tasks[0].status,'CANCELLED');});
test('CSV/Excel中文导入、完整号码保留、转义roundtrip、重导去重',async()=>{const name=cname()+' & 测试';const data=workbook(['公司名称','行业','地区','地址','联系电话','经营业务'],[[name,'包装','广州','模拟地址','02087650000','设备 & 配套 <样品>']]);const matrix=readWorkbook(data,'test.xlsx');assert.equal(matrix[1][0],name);assert.equal(matrix[1][5],'设备 & 配套 <样品>');const result=await importFile(db,admin,'test.xlsx',data.toString('base64'));assert.equal(result.imported,1);assert.equal((await importFile(db,admin,'test.xlsx',data.toString('base64'))).duplicates,1);const c=await api.detail(admin,result.companyIds[0]);assert.equal(c.phone,'02087650000');assert.equal(c.contacts[0].areaCode,'020');assert.equal(c.leads.length,1);const csv=Buffer.from('公司名称,地区,联系电话\r\n"'+cname()+',分公司",深圳,87654321');assert.equal((await importFile(db,admin,'test.csv',csv.toString('base64'))).imported,1);assert.equal(importRows([['公司名称','联系电话'],['坏行','123']])[0].error.length>0,true);});
test('坏行导入回滚，不留下半条企业资料',async()=>{const name=cname();const csv=Buffer.from(`公司名称,联系电话,邮箱\n${name},13855556666,错误邮箱`);const r=await importFile(db,admin,'bad.csv',csv.toString('base64'));assert.equal(r.errors.length,1);assert.equal((await api.list(admin,'companies',{q:name})).total,0);});
test('合并重复客户保留联系人、线索、时间线、拒呼且事务一致',async()=>{const a=await api.createCompany(admin,{name:cname(),tags:['来源']});const b=await api.createCompany(admin,{name:cname(),tags:['目标']});const ka=await api.createContact(admin,{companyId:a.id,mobile:'13700001111',doNotCall:true});const kb=await api.createContact(admin,{companyId:b.id,mobile:'13700001111'});const kc=await api.createContact(admin,{companyId:a.id,mobile:'13700002222'});await api.createLead(admin,{companyId:a.id,contactId:ka.id,status:'READY'});await api.createLead(admin,{companyId:a.id,contactId:kc.id,status:'REVIEW'});for(const [contactId,eid] of [[ka.id,'external1'],[kc.id,'external2']])await db.query('INSERT INTO "WecomExternalContact" (id,"organizationId","externalUserId","wecomUserId","companyId","contactId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())',[randomUUID(),'a',eid,'wa',a.id,contactId]);
 await api.merge(admin,a.id,b.id);const wecom=await db.query('SELECT * FROM "WecomExternalContact" WHERE "companyId"=$1',[b.id]);assert.equal(wecom.length,2);assert.equal(wecom.find(x=>x.externalUserId==='external1').contactId,kb.id);assert.equal(wecom.find(x=>x.externalUserId==='external2').contactId,kc.id);const d=await api.detail(admin,b.id);assert.equal(d.contacts.length,2);assert.equal(d.contacts.find((v:any)=>v.id===kb.id).doNotCall,true);assert.equal(d.leads.length,2);assert.deepEqual(d.tags.sort(),['来源','目标'].sort());await assert.rejects(api.detail(admin,a.id));await assert.rejects(api.recycle(admin,a.id,true));});
test('拒呼保留、手机和座机都拦截，拒呼线索不可恢复拨打',async()=>{const c=await api.createCompany(admin,{name:cname(),region:'深圳'});const k=await api.createContact(admin,{companyId:c.id,mobile:'13600001111',landline:'87651111',doNotCall:true});await assert.rejects(assertCrmDialable(db,'a',['13600001111']));await assert.rejects(assertCrmDialable(db,'a',['075587651111']));await assertCrmDialable(db,'b',['13600001111']);const l=await api.createLead(admin,{companyId:c.id,contactId:k.id,status:'READY'});assert.equal(l.status,'OPT_OUT');const updated=await api.createLead(admin,{companyId:c.id,contactId:k.id,status:'READY'},l.id);assert.equal(updated.status,'OPT_OUT');await assert.rejects(api.task(admin,{companyId:c.id,contactId:k.id,title:'不应创建',dueAt:'2026-11-02T10:00:00Z'}));});
test('阿里云通话+任务+录音+转写+已有AI总结关联，员工无权读取',async()=>{const c=await api.createCompany(admin,{name:cname(),region:'广州'});const k=await api.createContact(admin,{companyId:c.id,mobile:'13500001111',landline:'87652222'});await db.query('INSERT INTO "CallLog" ("callId","organizationId",metadata,"callerId","startTime","sessionId",status,"durationSeconds","audioRecordingPath") VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8)',['mock-call','a',JSON.stringify({provider:'ALIYUN_AICCS',toNumber:'02087652222',taskId:'mock-task'}),'02087652222','aliyun-mock','COMPLETED',35,'https://mock.example/record.wav']);await db.query('INSERT INTO "CallTranscript" ("callLogId",speaker,"messageText",timestamp) VALUES ($1,$2,$3,NOW())',['mock-call','customer','模拟客户对业务有意向']);await db.query('INSERT INTO "AutomationRun" VALUES ($1,$2,$3,$4,$5,NOW())',['a','mock-call','CALL_SUMMARY','SUCCESS',JSON.stringify({summary:'模拟总结',intent:'有意向',nextAction:'安排回访'})]);await db.query('INSERT INTO "AliyunTask" (id,"organizationId","remoteId") VALUES ($1,$2,$3)',['mock-task','a','aliyun-task-mock']);assert.equal(await linkExistingCall(db,'a','mock-call'),true);assert.equal(await linkExistingCall(db,'a','mock-call'),false);const rows=await callRows(db,admin,{companyId:c.id});assert.equal(rows.total,1);assert.equal(rows.rows[0].summary,'模拟总结');assert.equal(rows.rows[0].taskId,'aliyun-task-mock');assert.equal(rows.rows[0].transcript.length,1);assert.equal((await callRows(db,stranger,{})).total,0);const another=await api.createCompany(admin,{name:cname()});await assert.rejects(manualLink(db,admin,another.id,'mock-call',null));assert.equal((await api.detail(admin,c.id)).timeline.filter((t:any)=>t.kind==='CALL').length,1);await db.query('UPDATE "CallLog" SET deleted=true WHERE "callId"=$1',['mock-call']);assert.equal((await callRows(db,admin,{companyId:c.id})).total,0);});
test('旧业务客户导入保留负责人、备注、拒呼且重复导入安全',async()=>{await db.query('INSERT INTO "BusinessContact" (id,"organizationId","ownerId","companyName",industry,address,business,"sourceUrl",phone,status,notes,"nextFollowUp","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NOW())',['old-mock','a','worker',cname(),'纺织','广州市模拟地址','纺织设备','https://mock.example','13400001111','OPT_OUT','模拟拒呼']);assert.equal((await importLegacy(db,admin)).imported,1);assert.equal((await importLegacy(db,admin)).duplicates,1);await assert.rejects(assertCrmDialable(db,'a',['13400001111']));});
test('实际HTTP接口校验 session/Origin/workspace/body、CRUD及员工授权',async()=>{assert.equal((await http('/companies','admin','GET',undefined,{'x-method':'apiKey'})).status,403);assert.equal((await http('/companies','admin','GET',undefined,{'x-workspace-id':'b'})).status,403);assert.equal((await http('/companies','admin','POST',{name:cname()},{origin:'https://evil.invalid'})).status,403);assert.equal((await http('/companies','admin','POST',{name:cname(),workspaceId:'b'})).status,400);const response=await http('/companies','worker','POST',{name:cname()});assert.equal(response.status,200);const c=(await response.json()).data;assert.equal(c.workspaceId,'a');assert.equal(c.ownerId,'worker');assert.equal((await http('/companies/'+c.id,'stranger')).status,404);assert.equal((await http('/assign','worker','POST',{ids:[c.id],ownerId:'stranger'})).status,403);const k=await http('/contacts','worker','POST',{companyId:c.id,mobile:'13300001111'});assert.equal(k.status,200);assert.equal((await http('/companies/'+c.id,'worker')).status,200);});

test('已有AI总结写入CRM意向与时间线、拒呼取消任务、重复回调不重复写入',async()=>{const c=await api.createCompany(admin,{name:cname(),phone:'13200001111'});await api.task(admin,{companyId:c.id,title:'模拟回访',dueAt:'2026-11-02T10:00:00Z'});await db.query('INSERT INTO "CallLog" ("callId","organizationId",metadata,"callerId","startTime",status) VALUES ($1,$2,$3,$4,NOW(),$5)',['summary-mock','a',JSON.stringify({provider:'ALIYUN',toNumber:'13200001111'}),'13200001111','COMPLETED']);const summary={summary:'客户明确拒绝后续联系',intent:'OPT_OUT',nextAction:'停止跟进'};await applyCallSummary(db,'a','summary-mock','run-mock',summary);await applyCallSummary(db,'a','summary-mock','run-mock',summary);const d=await api.detail(admin,c.id);assert.equal(d.status,'OPT_OUT');assert.equal(d.tasks[0].status,'CANCELLED');assert.equal(d.timeline.filter((v:any)=>v.kind==='AI_SUMMARY').length,1);await assert.rejects(assertCrmDialable(db,'a',['13200001111']));assert.deepEqual(await applyCallSummary(db,'b','summary-mock','run-mock',summary),{linked:false});});

test('新版模板示例隔离、导入字段完整、日期与区号校验和权限预览',async()=>{
 assert.equal(importRows(readWorkbook(crmTemplateWorkbook(),'template.xlsx')).length,0);
 const data=workbook(['公司名称','所在地区','企业联系电话','负责人','客户状态','联系人姓名','手机号码','座机号码','座机区号','分机号码','联系人状态','拒绝联系','下次跟进时间','跟进备注'],[[cname(),'广州','02087650000','员工甲','有意向','模拟联系人','+86 13822223333','87650000','020','123','跟进中','否','2026-10-20 14:30','模拟回访']]);
 const preview=await previewFile(db,admin,'test.xlsx',data.toString('base64'));assert.equal(preview.errors,0);assert.equal(preview.rows[0].lead!.nextFollowUp,'2026-10-20T06:30:00.000Z');
 const r=await importFile(db,admin,'test.xlsx',data.toString('base64'));assert.equal(r.imported,1);const c=await api.detail(worker,r.companyIds[0]);assert.equal(c.ownerId,'worker');assert.equal(c.status,'INTERESTED');assert.equal(c.contacts[0].mobile,'13822223333');assert.equal(c.contacts[0].areaCode,'020');assert.equal(c.contacts[0].extension,'123');assert.equal(c.leads[0].notes,'模拟回访');
 assert.equal((await previewFile(db,stranger,'test.xlsx',data.toString('base64'))).errors,1);
 for(const [key,value] of [['客户状态','未知'],['拒绝联系','随便'],['下次跟进时间','2026-02-30 10:00'],['邮箱','错误']]){assert.ok(importRows([['公司名称','联系电话',key],[cname(),'13833334444',value]])[0].error);}
});

// Isolated events: no provider, voice model, worker or production database is used.
test('SIP 模拟结果保存、重复回调去重、录音和时间线关联及员工隔离',async()=>{
 const c=await api.createCompany(admin,{name:cname(),phone:'13111112222',ownerId:'worker'}),k=await api.createContact(admin,{companyId:c.id,mobile:'13111112222'});
 const id=randomUUID(),snapshot={mode:'MANUAL',line:{callerNumber:'02088880000'},policy:{retries:0,retryIntervalMinutes:30}};
 await db.query(`INSERT INTO "SipTask" (id,"workspaceId","createdBy",name,status,recipients,snapshot,"startTime","endTime") VALUES ($1,'a','worker','模拟人工通话','RUNNING',$2::jsonb,$3::jsonb,NOW(),NOW()+INTERVAL '1 hour')`,[id,JSON.stringify([{phoneNumber:'13111112222',crmCompanyId:c.id,crmContactId:k.id}]),JSON.stringify(snapshot)]);
 await db.query(`INSERT INTO "SipAttempt" (id,"workspaceId","taskId","recipientIndex","trunkKey",status,"startedAt") VALUES ($1,'a',$1,0,'mock-trunk','DISPATCHING',NOW())`,[id]);
 const at=new Date().toISOString(),e=eventSchema.parse({eventId:randomUUID(),attemptId:id,state:'COMPLETED',occurredAt:at,durationSeconds:35,recordingFile:id+'.wav',transcript:[{speaker:'customer',text:'模拟客户要求人工说明',timestamp:at}],handoffRequested:true});
 assert.equal((await ingestEvent(db,e)).saved,true);assert.equal((await ingestEvent(db,e)).duplicate,true);
 assert.equal((await db.query('SELECT status FROM "SipTask" WHERE id=$1',[id]))[0].status,'COMPLETED');
 const rows=await callRows(db,worker,{companyId:c.id});assert.equal(rows.total,1);assert.equal(rows.rows[0].recordingUrl,'/api/v1/telephony/recordings/'+id);assert.equal(rows.rows[0].transcript.length,1);
 assert.equal((await callRows(db,stranger,{companyId:c.id})).total,0);assert.equal((await callRows(db,other,{})).rows.some(x=>x.localCallId===id),false);
 const d=await api.detail(worker,c.id);assert.equal(d.timeline.filter((t:any)=>t.kind==='CALL').length,1);assert.equal(d.tasks.length,1);
 await ingestEvent(db,eventSchema.parse({...e,eventId:randomUUID(),state:'DIALING'}));assert.equal((await db.query('SELECT status FROM "SipAttempt" WHERE id=$1',[id]))[0].status,'COMPLETED');
 await assert.rejects(db.query(`INSERT INTO "SipAttempt" (id,"workspaceId","taskId","recipientIndex","trunkKey") VALUES ($1,'b',$2,0,'mock')`,[randomUUID(),id]));
});
test('SIP 模拟拒呼结果取消跟进并阻止后续拨号，不自动重拨',async()=>{
 const c=await api.createCompany(admin,{name:cname(),phone:'13011112222'});await api.task(admin,{companyId:c.id,title:'模拟回访',dueAt:'2026-11-02T10:00:00Z'});
 const id=randomUUID();await db.query(`INSERT INTO "SipTask" (id,"workspaceId","createdBy",name,status,recipients,snapshot,"startTime","endTime") VALUES ($1,'a','admin','模拟拒呼','RUNNING',$2::jsonb,$3::jsonb,NOW(),NOW()+INTERVAL '1 hour')`,[id,JSON.stringify([{phoneNumber:'13011112222',crmCompanyId:c.id}]),JSON.stringify({line:{callerNumber:'02088880000'},policy:{retries:2,retryIntervalMinutes:30}})]);
 await db.query(`INSERT INTO "SipAttempt" (id,"workspaceId","taskId","recipientIndex","trunkKey",status,"startedAt") VALUES ($1,'a',$1,0,'mock','DIALING',NOW())`,[id]);
 await ingestEvent(db,eventSchema.parse({eventId:randomUUID(),attemptId:id,state:'COMPLETED',occurredAt:new Date().toISOString(),optOutRequested:true}));
 const d=await api.detail(admin,c.id);assert.equal(d.status,'OPT_OUT');assert.equal(d.tasks[0].status,'CANCELLED');await assert.rejects(assertCrmDialable(db,'a',['13011112222']));await assertCrmDialable(db,'b',['13011112222']);
 assert.equal((await db.query('SELECT id FROM "SipAttempt" WHERE "taskId"=$1',[id])).length,1);
});
