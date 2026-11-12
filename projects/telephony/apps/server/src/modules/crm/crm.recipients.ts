/*
 * 中文导读：客户管理：crm.recipients.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {customerVisibleSql} from '../workspace/company-policy.js';
import {z} from 'zod';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {memberAccess,type CrmDb,type Scope} from './crm.service.js';
import {normalizePhone} from './crm.phone.js';
import {assertCrmDialable} from './crm.calls.js';

const querySchema=z.object({q:z.string().trim().max(160).default(''),industry:z.string().trim().max(80).default(''),region:z.string().trim().max(80).default(''),status:z.enum(['REVIEW','READY','CONNECTED','INTERESTED','FOLLOW_UP']).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)});
const phoneSql=`COALESCE(NULLIF(k."mobile",''),NULLIF(k."areaCode"||k."landline",''),CASE WHEN k."id" IS NULL THEN c."phone" ELSE '' END)`;
export async function customerDialTargets(db:CrmDb,s:Scope,input:unknown){
 const access=await memberAccess(db,s);const q=querySchema.parse(input);
 const values:unknown[]=[s.workspaceId,s.userId,access.allData];
 const conditions=[`c."workspaceId"=$1`,`c."deletedAt" IS NULL`,`($3 OR ${customerVisibleSql()})`,`c."status" NOT IN ('OPT_OUT','INVALID','WON')`,`(k."id" IS NULL OR (k."doNotCall"=false AND k."status" NOT IN ('OPT_OUT','INVALID','WON')))`,`${phoneSql}<>''`,`${phoneSql} ~ '^(1[3-9][0-9]{9}|0[0-9]{9,11})$'`];
 const add=(field:string,v:string,like=false)=>{values.push(like?'%'+v.replace(/[\\%_]/g,'\\$&')+'%':v);conditions.push(`${field} ${like?'ILIKE':'='} $${values.length}`);};
 if(q.q){values.push('%'+q.q.replace(/[\\%_]/g,'\\$&')+'%');conditions.push(`(c."name" ILIKE $${values.length} OR k."name" ILIKE $${values.length} OR ${phoneSql} ILIKE $${values.length})`);}
 if(q.industry)add('c."industry"',q.industry,true);if(q.region)add(`c."region"||' '||c."address"`,q.region,true);if(q.status)add('c."status"::text',q.status);
 // A refusal recorded against the same phone anywhere in the workspace remains authoritative.
 conditions.push(`NOT EXISTS (SELECT 1 FROM "CrmCompany" bc LEFT JOIN "CrmContact" bk ON bk."workspaceId"=bc."workspaceId" AND bk."companyId"=bc."id" WHERE bc."workspaceId"=$1 AND ((bc."status"='OPT_OUT' AND bc."phone"=${phoneSql}) OR (bk."doNotCall"=true AND (bk."mobile"=${phoneSql} OR bk."areaCode"||bk."landline"=${phoneSql}))))`);
 const from=`FROM "CrmCompany" c LEFT JOIN "CrmContact" k ON k."workspaceId"=c."workspaceId" AND k."companyId"=c."id" AND k."deletedAt" IS NULL WHERE ${conditions.join(' AND ')}`;
 const count=await db.query(`SELECT count(*)::int AS total ${from}`,values);values.push(q.pageSize,(q.page-1)*q.pageSize);
 const rows=await db.query(`SELECT c."id" AS "crmCompanyId",k."id" AS "crmContactId",c."name" AS "companyName",k."name" AS "contactName",c."industry",c."region",c."status",${phoneSql} AS "phoneNumber" ${from} ORDER BY c."updatedAt" DESC,c."id",k."id" LIMIT $${values.length-1} OFFSET $${values.length}`,values);
 return {rows,total:Number(count[0]?.total||0),page:q.page,pageSize:q.pageSize,canManage:access.canManage};
}
export type LinkedRecipient={phoneNumber:string;crmCompanyId?:string;crmContactId?:string|null};
export async function assertCustomerRecipients(db:CrmDb,s:Scope,recipients:LinkedRecipient[]){
 const access=await memberAccess(db,s);const linked=recipients.filter(r=>r.crmCompanyId);
 if(!linked.length)return;
 const companies=await db.query(`SELECT c."id",c."phone",c."status",c."deletedAt" FROM "CrmCompany" c WHERE c."workspaceId"=$1 AND c."id"=ANY($2::text[]) AND ($4 OR ${customerVisibleSql("c","$1","$3")})`,[s.workspaceId,[...new Set(linked.map(r=>r.crmCompanyId))],s.userId,access.allData]);
 const contacts=await db.query('SELECT * FROM "CrmContact" WHERE "workspaceId"=$1 AND "companyId"=ANY($2::text[]) AND "deletedAt" IS NULL',[s.workspaceId,companies.map(c=>c.id)]);
 for(const r of linked){
  const c=companies.find(c=>c.id===r.crmCompanyId);if(!c||c.deletedAt||['OPT_OUT','INVALID','WON'].includes(c.status))throw new BadRequestError('名单中的客户已失效、被回收或未授权，请重新选择。');
  const phone=normalizePhone(r.phoneNumber).phoneKey;
  if(r.crmContactId){const k=contacts.find(k=>k.id===r.crmContactId&&k.companyId===c.id);if(!k||k.doNotCall||['OPT_OUT','INVALID','WON'].includes(k.status)||![k.mobile,k.areaCode+k.landline].includes(phone))throw new BadRequestError('联系人的号码或联系状态已变化，请重新选择。');}
  else if(c.phone!==phone)throw new BadRequestError('企业联系电话已变化，请重新选择。');
 }
 await assertCrmDialable(db,s.workspaceId,linked.map(r=>r.phoneNumber));
}
