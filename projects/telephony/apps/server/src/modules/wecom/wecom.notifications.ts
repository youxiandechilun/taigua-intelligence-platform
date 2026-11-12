/*
 * 中文导读：企业微信：wecom.notifications.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {memberAccess} from '../crm/crm.service.js';
import {customerVisibleSql,scopedOwnerSql,scopeLabels,grants} from '../workspace/company-policy.js';
import type {CrmDb} from '../crm/crm.service.js';
import {WecomSendError} from './wecom.client.js';

type Scope={organizationId:string;userId:string};
export const notificationInput=z.object({
 enabled:z.boolean(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
 weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7),
 recipientIds:z.array(z.string().min(1).max(100)).max(200),
 contents:z.array(z.enum(['calls','customers','tasks'])).min(1).max(3),
}).strict();
export type NotificationInput=z.infer<typeof notificationInput>;
const defaults:NotificationInput={enabled:false,time:'18:05',weekdays:[1,2,3,4,5],recipientIds:[],contents:['calls','customers','tasks']};
export function beijingSlot(now:Date){const d=new Date(now.getTime()+8*3600000);return{date:d.toISOString().slice(0,10),time:d.toISOString().slice(11,16),weekday:d.getUTCDay()||7,start:new Date(d.toISOString().slice(0,10)+'T00:00:00+08:00')};}
export function policyDue(p:any,now:Date){const s=beijingSlot(now);return p.enabled&&p.time===s.time&&p.weekdays.includes(s.weekday)&&p.enabledAt&&new Date(p.enabledAt).getTime()<=now.getTime();}
export function notificationService(db:CrmDb,delivery:(org:string,user:string,text:string)=>Promise<string>,ready:(org:string)=>Promise<void>,clock:()=>Date=()=>new Date()){
 async function context(s:Scope){const rows=await db.query(`SELECT m."role",u."name",w."wecomUserId" FROM "Member" m JOIN "User" u ON u."id"=m."userId" LEFT JOIN "WecomMember" w ON w."organizationId"=m."organizationId" AND w."userId"=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL`,[s.organizationId,s.userId]);if(!rows[0])throw new ForbiddenError('员工不属于当前工作区或已停用。');const p=await memberAccess(db,{workspaceId:s.organizationId,userId:s.userId});if(!grants(p.permissions,'wecom','read'))throw new ForbiddenError('当前角色未授权企业微信功能。');return{...p,name:String(rows[0].name||''),wecomUserId:rows[0].wecomUserId as string|null,canManage:p.allData&&grants(p.permissions,'wecom','update')};}
 async function manager(s:Scope){if(!(await context(s)).canManage)throw new ForbiddenError('数据通知由公司管理员配置。');}
 async function config(org:string){return(await db.query('SELECT * FROM "WecomNotificationPolicy" WHERE "organizationId"=$1',[org]))[0]||{organizationId:org,...defaults};}
 async function report(s:Scope,contents:NotificationInput['contents'],now:Date){
  const c=await context(s),slot=beijingSlot(now);const args=[s.organizationId,s.userId,c.allData];
  const name=(await db.query('SELECT "name" FROM "Organization" WHERE "id"=$1',[s.organizationId]))[0]?.name||'当前公司';
  const clean=(text:string)=>text.replace(/[<>\r\n]/g,' ').slice(0,60);
  const lines=[clean(String(name))+' · 每日数据通知',slot.date+'（截至北京时间 '+slot.time+'）','统计范围：'+(scopeLabels[c.dataScope]||'授权数据')];
  if(contents.includes('calls')&&grants(c.permissions,'callLogs','read')){
   const r=(await db.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE "status"::text='COMPLETED')::int AS connected,COALESCE(sum("durationSeconds") FILTER (WHERE "status"::text='COMPLETED'),0)::int AS seconds FROM "CallLog" cl WHERE "organizationId"=$1 AND ($3 OR ${scopedOwnerSql('cl."userId"')}) AND "deleted"=false AND "startTime">=$4 AND "startTime"<=$5 AND "metadata"->>'provider' IN ('ALIYUN','ALIYUN_AICCS','HAOKEHU_SIP','HAOKEHU_CALLBACK')`,[...args,slot.start,now]))[0]!;
   lines.push(`今日通话：${r.total} 次，接通 ${r.connected} 次，接通率 ${r.total?Math.round(r.connected*100/r.total):0}%`,`已接通时长：${Math.round(r.seconds/60)} 分钟`);
  }
  if(contents.includes('customers')&&grants(c.permissions,'crm','read')){
   const r=(await db.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE "createdAt">=$4 AND "createdAt"<=$5)::int AS added,count(*) FILTER (WHERE "status"::text='INTERESTED')::int AS interested,count(*) FILTER (WHERE "status"::text='FOLLOW_UP')::int AS following FROM "CrmCompany" c WHERE "workspaceId"=$1 AND ($3 OR ${customerVisibleSql()}) AND "deletedAt" IS NULL`,[...args,slot.start,now]))[0]!;
   lines.push(`客户库：${r.total} 家，今日新增 ${r.added} 家`,`有意向 ${r.interested} 家，跟进中 ${r.following} 家`);
  }
  if(contents.includes('tasks')&&grants(c.permissions,'crm','read')){
   const r=(await db.query(`SELECT count(*) FILTER (WHERE t."dueAt"<$4)::int AS overdue,count(*) FILTER (WHERE t."dueAt">=$4 AND t."dueAt"<$5)::int AS today FROM "CrmTask" t JOIN "CrmCompany" c ON c."workspaceId"=t."workspaceId" AND c."id"=t."companyId" WHERE t."workspaceId"=$1 AND ($3 OR ${scopedOwnerSql('t."ownerId"')}) AND ($3 OR ${customerVisibleSql()}) AND t."status"='PENDING' AND c."deletedAt" IS NULL AND c."status"::text<>'OPT_OUT' AND (t."contactId" IS NULL OR EXISTS(SELECT 1 FROM "CrmContact" ct WHERE ct."workspaceId"=t."workspaceId" AND ct."companyId"=t."companyId" AND ct."id"=t."contactId" AND ct."deletedAt" IS NULL AND ct."doNotCall"=false AND ct."status"::text<>'OPT_OUT'))`,[...args,slot.start,new Date(slot.start.getTime()+86400000)]))[0]!;
   lines.push(`待跟进：今日 ${r.today} 项，已逾期 ${r.overdue} 项`);
  }
  return{recipientId:s.userId,recipientName:c.name,scope:scopeLabels[c.dataScope]||'授权数据',date:slot.date,content:lines.join('\n')};
 }
 return {
  async get(s:Scope){const c=await context(s);return{canManage:c.canManage,config:c.canManage?await config(s.organizationId):null};},
  async save(s:Scope,input:unknown){await manager(s);const p=notificationInput.parse(input);p.recipientIds=[...new Set(p.recipientIds)];p.weekdays=[...new Set(p.weekdays)].sort();p.contents=[...new Set(p.contents)];
   if(p.enabled)for(const id of p.recipientIds){const c=await context({organizationId:s.organizationId,userId:id});if(!c.wecomUserId)throw new BadRequestError('接收员工需要先绑定企业微信身份。');}
   if(p.enabled){if(!p.recipientIds.length)throw new BadRequestError('请选择至少一位接收员工。');await ready(s.organizationId);}
   const now=clock();await db.query(`INSERT INTO "WecomNotificationPolicy" ("organizationId","enabled","time","weekdays","recipientIds","contents","enabledAt","updatedAt") VALUES ($1,$2,$3,$4::int[],$5::text[],$6::text[],$7,$8) ON CONFLICT ("organizationId") DO UPDATE SET "enabled"=EXCLUDED."enabled","time"=EXCLUDED."time","weekdays"=EXCLUDED."weekdays","recipientIds"=EXCLUDED."recipientIds","contents"=EXCLUDED."contents","enabledAt"=EXCLUDED."enabledAt","updatedAt"=EXCLUDED."updatedAt" RETURNING "organizationId"`,[s.organizationId,p.enabled,p.time,p.weekdays,p.recipientIds,p.contents,p.enabled?now:null,now]);
   return this.get(s);
  },
  async preview(s:Scope,userId?:string,contents?:NotificationInput['contents']){const c=await context(s);if(userId&&userId!==s.userId&&!(await db.query(`SELECT 1 FROM "Member" m WHERE m."organizationId"=$1 AND m."userId"=$3 AND ${scopedOwnerSql('m."userId"')}`,[s.organizationId,s.userId,userId])).length)throw new ForbiddenError('员工只能预览自己的通知。');return report({...s,userId:userId||s.userId},contents||(await config(s.organizationId)).contents,clock());},
  async logs(s:Scope,page:number){const c=await context(s);const args=[s.organizationId,s.userId,c.allData];const where=`"organizationId"=$1 AND ($3 OR ${scopedOwnerSql('d."recipientId"')})`;const total=(await db.query('SELECT count(*)::int AS total FROM "WecomNotificationDelivery" d WHERE '+where,args))[0]!.total;const rows=await db.query(`SELECT d."id",d."recipientId",u."name" AS "recipientName",d."date",d."status",d."error",d."createdAt",d."finishedAt" FROM "WecomNotificationDelivery" d LEFT JOIN "User" u ON u."id"=d."recipientId" WHERE d.${where} ORDER BY d."createdAt" DESC,d."id" LIMIT 20 OFFSET $4`,[...args,(page-1)*20]);return{rows,total,page};},
  async tick(){const now=clock(),slot=beijingSlot(now);
   await db.query(`UPDATE "WecomNotificationDelivery" SET "status"='UNKNOWN',"error"='任务中断，发送结果未确认；系统不会自动重发。',"finishedAt"=$1 WHERE "status"='SENDING' AND "createdAt"<$2 RETURNING "id"`,[now,new Date(now.getTime()-10*60000)]);
   const policies=await db.query('SELECT * FROM "WecomNotificationPolicy" WHERE "enabled"=true AND "time"=$1',[slot.time]);
   for(const p of policies){if(!policyDue(p,now))continue;for(const recipientId of p.recipientIds){
    const id=randomUUID();const claimed=await db.query(`INSERT INTO "WecomNotificationDelivery" ("id","organizationId","recipientId","date","createdAt") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("organizationId","recipientId","date") DO NOTHING RETURNING "id"`,[id,p.organizationId,recipientId,slot.date,now]);if(!claimed.length)continue;
    let status='SKIPPED',error='',messageId='';
    try{
     const current=await config(p.organizationId);if(!current.enabled||!current.recipientIds.includes(recipientId)||new Date(current.updatedAt).getTime()!==new Date(p.updatedAt).getTime())throw new ForbiddenError('通知配置已经变更，已跳过本次发送。');
     const s={organizationId:p.organizationId,userId:recipientId};const c=await context(s);if(!c.wecomUserId)throw new ForbiddenError('员工尚未绑定企业微信，已跳过。');
     await ready(s.organizationId);const text=await report(s,current.contents,clock());
     messageId=await delivery(s.organizationId,c.wecomUserId,text.content);status='ACCEPTED';
    }catch(e){if(e instanceof WecomSendError){status=e.uncertain?'UNKNOWN':'FAILED';error=e.message;}else{status='SKIPPED';error=e instanceof ForbiddenError||e instanceof BadRequestError?e.message:'通知生成失败，已跳过本次发送。';}}
    await db.query(`UPDATE "WecomNotificationDelivery" SET "status"=$2,"error"=$3,"messageId"=$4,"finishedAt"=$5 WHERE "id"=$1 AND "organizationId"=$6 AND "status"='SENDING' RETURNING "id"`,[id,status,error,messageId,clock(),p.organizationId]);
   }}
  }
 };
}
