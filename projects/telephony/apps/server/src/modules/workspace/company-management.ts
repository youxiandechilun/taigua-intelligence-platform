/*
 * 中文导读：工作区与权限：company-management.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {accountNameSchema,accountEmail,accountUsername} from '../accounts/account-identity.js';
import {createHash,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import prisma from '../../config/prisma.js';
import type {Prisma} from '../../../prisma/generated/prisma/client.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {generateAccountPassword} from '../accounts/account-password.js';
import {companyResources,grants,policyFromRow,rolePresets,scopeLabels,fullCompanyPermissions} from './company-policy.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
type Db=Prisma.TransactionClient;
type Actor={workspaceId:string;userId:string};
const domain=process.env.ACCOUNT_EMAIL_DOMAIN||'dx.zezejun.cn';
const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(80);
export const unitInput=z.object({name,parentId:uuid.nullable().default(null),kind:z.enum(['DIVISION','CENTER','DEPARTMENT']).default('DEPARTMENT')}).strict();
export const roleInput=z.object({name,description:z.string().trim().max(300).default(''),rank:z.number().int().min(2).max(1000),dataScope:z.enum(['WORKSPACE','DEPARTMENT_TREE','DEPARTMENT','SELF','CUSTOM']),permissions:z.record(z.string(),z.array(z.string()).max(20))}).strict();
const receptionInput=z.object({phone:z.string().trim().regex(/^(?:1[3-9][0-9]{9}|0[0-9]{9,11})?$/,'请填写国内手机号或带区号座机'),available:z.boolean()}).strict();
export const memberAssignment=z.object({name:name.optional(),departmentId:uuid.nullable(),companyRoleId:uuid.nullable(),scopeDepartmentIds:z.array(uuid).max(100).default([]),reception:receptionInput.optional()}).strict();
export const updateMemberInput=memberAssignment.extend({username:accountNameSchema.optional(),expectedUsername:z.string().max(256).optional(),expectedAccessRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export const createMemberInput=memberAssignment.extend({username:accountNameSchema,name}).strict();
const selected={id:true,userId:true,role:true,enabled:true,deletedAt:true,companyDepartmentId:true,companyRoleId:true,scopeDepartmentIds:true,companyDepartment:{select:{id:true,name:true}},companyRole:true,createdAt:true,user:{select:{name:true,email:true,banned:true,deletedAt:true,role:true}}} as const;
function accessRevision(m:{role:string;companyDepartmentId:string|null;companyRoleId:string|null;scopeDepartmentIds:string[];enabled:boolean;user:{role:string|null;name:string;email:string;banned:boolean|null}}){
 return createHash('sha256').update(JSON.stringify([m.role,m.companyDepartmentId,m.companyRoleId,[...m.scopeDepartmentIds].sort(),m.enabled,m.user.role,m.user.banned,m.user.name,m.user.email])).digest('hex');
}
async function policy(db:Db,s:Actor){
 const m=await db.member.findFirst({where:{organizationId:s.workspaceId,userId:s.userId,enabled:true,deletedAt:null,organization:{deletedAt:null},user:{banned:false,deletedAt:null}},include:{companyRole:true,user:{select:{role:true}}}});
 if(!m)throw new ForbiddenError('公司权限已变更，请重新登录。');
 return policyFromRow({...m,...m.companyRole,role:m.role,userRole:m.user.role,roleName:m.companyRole?.name});
}
export async function organizationUnits(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>){
 const units=await db.companyDepartment.findMany({where:{organizationId:s.workspaceId},include:{_count:{select:{members:true,children:true}}},orderBy:{name:'asc'}});
 const roots=p.dataScope==='CUSTOM'?p.scopeDepartmentIds:p.departmentId?[p.departmentId]:[];
 const ids=new Set<string>();
 if(p.allData)units.forEach(u=>ids.add(u.id));
 else if(p.dataScope==='DEPARTMENT')roots.forEach((id:string)=>ids.add(id));
 else if(['DEPARTMENT_TREE','CUSTOM'].includes(p.dataScope)){
  roots.forEach((id:string)=>ids.add(id));
  for(let changed=true;changed;){changed=false;for(const u of units)if(u.parentId&&ids.has(u.parentId)&&!ids.has(u.id)){ids.add(u.id);changed=true;}}
 }
 return {units,ids};
}
function requireAction(p:Awaited<ReturnType<typeof policy>>,resource:string,action:string){if(!p.isSystemAdmin&&!grants(p.permissions,resource,action))throw new ForbiddenError('当前角色未授权此操作。');}
async function permittedDepartment(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,id:string|null){
 if(!id){if(!p.allData)throw new ForbiddenError('请选择授权范围内的组织。');return;}
 const {units,ids}=await organizationUnits(db,s,p);
 if(!units.some(u=>u.id===id)||!ids.has(id))throw new ForbiddenError('所选组织不在你的管理范围内。');
}
async function targetMember(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,id:string,allowDeleted=false){
 const m=await db.member.findFirst({where:{id,organizationId:s.workspaceId,...(!allowDeleted?{deletedAt:null}:{}),user:{deletedAt:null}},select:selected});
 if(!m)throw new BadRequestError('员工不属于当前公司。');
 const target=policyFromRow({...m,...m.companyRole,role:m.role,userRole:m.user.role});
 if(m.userId===s.userId||target.isSystemAdmin||(!p.isSystemAdmin&&target.rank<=p.rank))throw new ForbiddenError('只能管理下级账号，超级管理员身份由平台入口维护。');
 if(!p.allData)await permittedDepartment(db,s,p,m.companyDepartmentId);
 return m;
}
async function checkedRole(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,id:string|null){
 if(!id)throw new BadRequestError('请选择管理员或普通用户。');
 const role=await db.companyRole.findFirst({where:{id,workspaceId:s.workspaceId}});
 if(!role)throw new BadRequestError('角色不属于当前公司。');
 if(!['workspace_admin','employee'].includes(role.presetKey||''))throw new BadRequestError('旧角色已停止分配，请选择管理员或普通用户。');
 if(role.presetKey==='workspace_admin'&&!p.isSystemAdmin)throw new ForbiddenError('只有超级管理员可以授予管理员身份。');
 return role;
}
async function checkedAssignment(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,input:z.infer<typeof memberAssignment>){
 const role=await checkedRole(db,s,p,input.companyRoleId);
 await permittedDepartment(db,s,p,input.departmentId);
 if(role&&!['SELF','WORKSPACE'].includes(role.dataScope)&&!input.departmentId)throw new BadRequestError('此角色需要设置所属组织。');
 if(role?.dataScope==='CUSTOM'){
  if(!input.scopeDepartmentIds.length)throw new BadRequestError('请选择至少一个授权组织。');
  for(const id of input.scopeDepartmentIds)await permittedDepartment(db,s,p,id);
 }else if(input.scopeDepartmentIds.length)throw new BadRequestError('只有指定组织角色可以设置额外组织范围。');
 return role;
}
async function transact<T>(s:Actor,resource:string,action:string,fn:(db:Db,p:Awaited<ReturnType<typeof policy>>)=>Promise<T>){
 return prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"company-policy:"+s.workspaceId}))::text AS locked`;
  const p=await policy(db,s);requireAction(p,resource,action);return fn(db,p);
 },{maxWait:10000,timeout:30000});
}
async function audit(s:Actor,action:string,type:string,id:string,metadata?:Record<string,unknown>){await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'company.'+action,resourceType:type,resourceId:id,metadata});}
export async function assignmentUnits(s:Actor){const p=await policy(prisma,s);if(!p.isSystemAdmin&&!p.canManageMembers&&!p.canManageSeats&&!['companyMembers','crm','seats','lines','automation'].some(r=>grants(p.permissions,r,'read')&&['create','update','assign'].some(a=>grants(p.permissions,r,a))))throw new ForbiddenError('当前账号没有人员分配权限。');const {units,ids}=await organizationUnits(prisma,s,p);return units.filter(u=>ids.has(u.id)).map(u=>({id:u.id,name:u.name,parentId:u.parentId,kind:u.kind}));}
export async function listUnits(s:Actor){const p=await policy(prisma,s);requireAction(p,'companyDepartments','read');const {units,ids}=await organizationUnits(prisma,s,p);return units.filter(u=>ids.has(u.id)).map(u=>({...u,memberCount:u._count.members,childCount:u._count.children}));}
export async function saveUnit(s:Actor,input:unknown,id?:string){
 const d=unitInput.parse(input);
 const saved=await transact(s,'companyDepartments',id?'update':'create',async(db,p)=>{
  if(id)await permittedDepartment(db,s,p,id);
  const old=id?await db.companyDepartment.findFirst({where:{id,organizationId:s.workspaceId}}):null;
  if(!old||old.parentId!==d.parentId)await permittedDepartment(db,s,p,d.parentId);
  if(id&&d.parentId){
   const {units}=await organizationUnits(db,s,p);let parent:string|null=d.parentId;const seen=new Set<string>();
   while(parent){if(parent===id||seen.has(parent))throw new BadRequestError('不能把组织移入自己或下级组织。');seen.add(parent);parent=units.find(u=>u.id===parent)?.parentId??null;}
  }
  if(id&&!p.allData){const old=await db.companyDepartment.findUniqueOrThrow({where:{id}});if(old.parentId!==d.parentId)throw new ForbiddenError('组织调动请由全公司管理员处理。');}
  if(await db.companyDepartment.findFirst({where:{organizationId:s.workspaceId,name:d.name,...(id?{id:{not:id}}:{})}}))throw new BadRequestError('本公司已有同名组织。');
  return id?db.companyDepartment.update({where:{id},data:d}):db.companyDepartment.create({data:{id:randomUUID(),organizationId:s.workspaceId,...d}});
 });await audit(s,id?'organization.updated':'organization.created','department',saved.id);return saved;
}
export async function deleteUnit(s:Actor,id:string){
 await transact(s,'companyDepartments','delete',async(db,p)=>{
  await permittedDepartment(db,s,p,id);
  if(await db.member.count({where:{organizationId:s.workspaceId,companyDepartmentId:id}})||await db.companyDepartment.count({where:{organizationId:s.workspaceId,parentId:id}}))throw new BadRequestError('请先转移所属员工和下级组织，再删除。');
  if(await db.member.count({where:{organizationId:s.workspaceId,scopeDepartmentIds:{has:id}}}))throw new BadRequestError('此组织仍用于角色授权，请先调整授权范围。');
  await db.companyDepartment.delete({where:{id}});
 });await audit(s,'organization.deleted','department',id);return {deleted:true};
}
export async function initializeRoles(s:Actor){
 await prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"company-policy:"+s.workspaceId}))::text AS locked`;
  const org=await db.organization.findUniqueOrThrow({where:{id:s.workspaceId}});
  const current=await db.companyRole.findMany({where:{workspaceId:s.workspaceId,presetKey:{in:rolePresets.map(role=>role.presetKey)}}});
  for(const role of rolePresets){
   const prior=current.find(row=>row.presetKey===role.presetKey);
   const savedPermissions=prior?.permissions as Record<string,string[]>|undefined;
   const samePermissions=!!savedPermissions&&Object.keys(savedPermissions).length===Object.keys(role.permissions).length&&Object.entries(role.permissions).every(([resource,actions])=>Array.isArray(savedPermissions[resource])&&savedPermissions[resource]!.length===actions.length&&actions.every(action=>savedPermissions[resource]!.includes(action)));
   if(prior&&prior.name===role.name&&prior.description===role.description&&prior.rank===role.rank&&prior.dataScope===role.dataScope&&samePermissions)continue;
   await db.companyRole.upsert({where:{workspaceId_presetKey:{workspaceId:s.workspaceId,presetKey:role.presetKey}},create:{workspaceId:s.workspaceId,...role},update:role});
  }
  if(!org.companyRolesInitialized)await db.organization.update({where:{id:s.workspaceId},data:{companyRolesInitialized:true}});
 });
}
export async function listRoles(s:Actor){
 const p=await policy(prisma,s);requireAction(p,'companyRoles','read');await initializeRoles(s);
 const rows=await prisma.companyRole.findMany({where:{workspaceId:s.workspaceId,presetKey:{in:['workspace_admin','employee']}},orderBy:{rank:'asc'}});
 const members=await prisma.member.findMany({where:{organizationId:s.workspaceId,deletedAt:null,user:{deletedAt:null}},include:{companyRole:true,user:{select:{role:true}}}});
 const policies=members.map(m=>policyFromRow({...m,...m.companyRole,role:m.role,userRole:m.user.role}));
 const roles=[{id:'system-admin',name:'超级管理员',description:'管理平台、线路、AI 配置和全局设置，并管理获授权工作区的业务。',rank:0,dataScope:'WORKSPACE',permissions:fullCompanyPermissions,roleKey:'super_admin',memberCount:policies.filter(m=>m.roleKey==='super_admin').length,canEdit:false,canDelete:false,canAssign:false},...rows.map(row=>({...row,roleKey:row.presetKey==='workspace_admin'?'admin':'user',memberCount:policies.filter(m=>m.roleKey===(row.presetKey==='workspace_admin'?'admin':'user')).length,canEdit:false,canDelete:false,canAssign:row.presetKey==='employee'||p.isSystemAdmin}))];
 return {roles,resources:companyResources,scopeLabels,canCreate:false,minRank:p.rank+1,permissionModel:'fixed_v1',pendingRoleMappings:policies.filter(m=>m.requiresRoleMapping).length};
}
export async function assignableRoles(s:Actor){
 const p=await policy(prisma,s);requireAction(p,'companyMembers','read');await initializeRoles(s);
 const rows=await prisma.companyRole.findMany({where:{workspaceId:s.workspaceId,presetKey:{in:['workspace_admin','employee']}},orderBy:{rank:'asc'}});
 const result=[];for(const role of rows){try{await checkedRole(prisma,s,p,role.id);result.push(role);}catch{}}
 return result;
}
export async function saveRole(s:Actor,input:unknown,id?:string){
 const p=await policy(prisma,s);requireAction(p,'companyRoles','read');
 throw new BadRequestError('系统固定使用超级管理员、管理员、普通用户，请在员工资料中选择身份，无需编辑权限项。');
}
export async function deleteRole(s:Actor,id:string,replacementId?:string){
 const p=await policy(prisma,s);requireAction(p,'companyRoles','read');
 throw new BadRequestError('三种系统身份固定保留；调整员工身份请编辑员工资料。');
}
export async function listMembers(s:Actor,deleted=false){
 const p=await policy(prisma,s);
 if(!p.isSystemAdmin&&!grants(p.permissions,'companyMembers','read')&&(!p.canManageSeats||deleted))throw new ForbiddenError('当前账号没有员工管理权限。');
 const {ids}=await organizationUnits(prisma,s,p);
 const list=await prisma.member.findMany({where:{organizationId:s.workspaceId,deletedAt:deleted?{not:null}:null,user:{deletedAt:null},...(!p.allData?{OR:[{companyDepartmentId:{in:[...ids]}},{userId:s.userId}]}:{})},select:selected,orderBy:{createdAt:'asc'}});
 const seats=await prisma.$queryRaw<{userId:string;phone:string;available:boolean}[]>`SELECT "userId","phone","available" FROM "SipSeat" WHERE "workspaceId"=${s.workspaceId} AND "deletedAt" IS NULL`;
 const byUser=new Map(seats.map(seat=>[seat.userId,seat]));
 await initializeRoles(s);
 const fixedRoles=await prisma.companyRole.findMany({where:{workspaceId:s.workspaceId,presetKey:{in:['workspace_admin','employee']}}});
 return list.filter(m=>p.isSystemAdmin||m.userId===s.userId||!m.user.role?.split(',').map(role=>role.trim()).includes('admin')).map(m=>{const target=policyFromRow({...m,...m.companyRole,role:m.role,userRole:m.user.role});const seat=byUser.get(m.userId);const subordinate=!target.isSystemAdmin&&(p.isSystemAdmin||target.rank>p.rank);const role=fixedRoles.find(role=>role.presetKey===(target.isWorkspaceAdmin?'workspace_admin':'employee'));return {id:m.id,userId:m.userId,name:m.user.name,username:accountUsername(m.user.email,domain),role:m.role,roleKey:target.roleKey,roleName:target.roleName,requiresRoleMapping:target.requiresRoleMapping,accessRevision:accessRevision(m),companyRoleId:target.isSystemAdmin?null:role?.id??null,scopeDepartmentIds:[],dataScope:target.dataScope,rank:target.rank,deletedAt:m.deletedAt,enabled:m.enabled&&!m.user.banned,departmentId:m.companyDepartmentId,department:m.companyDepartment,canEdit:m.userId!==s.userId&&subordinate,reception:seat?{phone:seat.phone,available:seat.available}:null,canManageReception:!m.deletedAt&&(m.userId===s.userId||subordinate)&&p.canManageSeats};});
}
async function saveMemberReception(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,userId:string,employeeName:string,departmentId:string|null,enabled:boolean,input?:z.infer<typeof receptionInput>){
 const department=departmentId?await db.companyDepartment.findFirst({where:{id:departmentId,organizationId:s.workspaceId},select:{name:true}}):null;
 await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"sip-seat:"+s.workspaceId+':'+userId})::bigint)::text AS locked`;
 const current=(await db.$queryRaw<{phone:string;available:boolean;deletedAt:Date|null}[]>`SELECT "phone","available","deletedAt" FROM "SipSeat" WHERE "workspaceId"=${s.workspaceId} AND "userId"=${userId} FOR UPDATE`)[0];
 if(!input){
  await db.$executeRaw`UPDATE "SipSeat" SET "displayName"=${employeeName},"department"=${department?.name||''},"updatedAt"=NOW() WHERE "workspaceId"=${s.workspaceId} AND "userId"=${userId} AND "deletedAt" IS NULL`;
  return;
 }
 if((!current||current.deletedAt)&&!input.phone&&!input.available)return;
 const changed=!current||current.deletedAt||current.phone!==input.phone||current.available!==input.available;
 if(changed)requireAction(p,'seats',!current||current.deletedAt?'create':'update');
 if(input.available&&(!input.phone||!enabled))throw new BadRequestError('请先填写接听号码并启用员工账号，再设为在岗。');
 if((!current||current.deletedAt||current.phone!==input.phone)&&(await db.$queryRaw<{id:string}[]>`SELECT a."id" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE t."workspaceId"=${s.workspaceId} AND t."createdBy"=${userId} AND t."snapshot"->>'mode'='MANUAL' AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') LIMIT 1`).length)throw new BadRequestError('员工有通话或待核对记录，请处理后再调整接听号码。');
 await db.$executeRaw`INSERT INTO "SipSeat" ("workspaceId","userId","phone","available","displayName","department") VALUES (${s.workspaceId},${userId},${input.phone},${input.available},${employeeName},${department?.name||''}) ON CONFLICT ("workspaceId","userId") DO UPDATE SET "phone"=EXCLUDED."phone","available"=EXCLUDED."available","displayName"=EXCLUDED."displayName","department"=EXCLUDED."department","deletedAt"=NULL,"updatedAt"=NOW()`;
}
export async function createMember(s:Actor,input:unknown){
 const data=createMemberInput.parse(input),password=generateAccountPassword(),hash=await bcrypt.hash(password,10),userId=randomUUID();
 await transact(s,'companyMembers','create',async(db,p)=>{
  const assigned=await checkedAssignment(db,s,p,data);const email=accountEmail(data.username,domain);
  if(await db.user.findUnique({where:{email}}))throw new BadRequestError('账号已存在，请更换账号名称。');
  await db.user.create({data:{id:userId,name:data.name,email,emailVerified:true,role:'user'}});
  await db.account.create({data:{id:randomUUID(),accountId:userId,userId,providerId:'credential',password:hash}});
  await db.member.create({data:{id:randomUUID(),userId,organizationId:s.workspaceId,role:assigned.presetKey==='workspace_admin'?'admin':'member',companyDepartmentId:data.departmentId,companyRoleId:assigned.id,scopeDepartmentIds:[],createdAt:new Date()}});
  await saveMemberReception(db,s,p,userId,data.name,data.departmentId,true,data.reception);
 });await audit(s,'employee.created','user',userId);return {username:data.username,password};
}
export async function updateMember(s:Actor,id:string,input:unknown){
 const data=updateMemberInput.parse(input);
 let accountChange:{previousUsername:string;username:string}|undefined;
 try{
  await transact(s,'companyMembers','update',async(db,p)=>{
   const m=await targetMember(db,s,p,id);
   if(!data.expectedAccessRevision||data.expectedAccessRevision!==accessRevision(m))throw new BadRequestError('员工资料或角色已更新，请重新打开员工资料；当前修改尚未保存。');
   const assigned=await checkedAssignment(db,s,p,data);
   if(m.role==='owner'&&assigned.presetKey!=='workspace_admin')throw new BadRequestError('工作区负责人保留管理员身份。');
   const previousUsername=accountUsername(m.user.email,domain);
   const email=data.username===undefined?m.user.email:accountEmail(data.username,domain);
   const accountChanged=email!==m.user.email;
   if(data.username!==undefined){
    if(data.expectedUsername===undefined||data.expectedUsername.normalize('NFKC').trim().toLowerCase()!==previousUsername.normalize('NFKC').trim().toLowerCase())throw new BadRequestError('登录账号已在其他页面更新，请重新打开员工资料。');
    if(accountChanged){
     if(!m.user.email.endsWith('@'+domain)||!await db.account.findFirst({where:{userId:m.userId,providerId:'credential'},select:{id:true}}))throw new ForbiddenError('此账号不属于系统内部登录账号，请由超级管理员核对。');
     if(await db.member.count({where:{userId:m.userId}})>1&&!p.isSystemAdmin)throw new ForbiddenError('跨公司账号的登录名称由超级管理员修改。');
     await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"managed-account:"+email}))::text AS locked`;
     const duplicate=await db.user.findUnique({where:{email},select:{id:true}});
     if(duplicate&&duplicate.id!==m.userId)throw new BadRequestError('此登录账号已被使用，请更换。');
     accountChange={previousUsername,username:data.username!};
    }
   }
   if(data.name&&data.name!==m.user.name&&await db.member.count({where:{userId:m.userId}})>1&&!p.isSystemAdmin)throw new ForbiddenError('跨公司账号名称由超级管理员修改。');
   if(data.name||accountChanged)await db.user.update({where:{id:m.userId},data:{...(data.name?{name:data.name}:{}),...(accountChanged?{email}:{})}});
   await db.member.update({where:{id},data:{companyDepartmentId:data.departmentId,companyRoleId:assigned.id,scopeDepartmentIds:[],role:m.role==='owner'?'owner':assigned.presetKey==='workspace_admin'?'admin':'member'}});
   await saveMemberReception(db,s,p,m.userId,data.name??m.user.name,data.departmentId,m.enabled&&!m.user.banned,data.reception);
   await db.session.deleteMany({where:{userId:m.userId,...(!accountChanged?{activeOrganizationId:s.workspaceId}:{})}});
  });
 }catch(error){
  if(error&&typeof error==='object'&&'code'in error&&error.code==='P2002')throw new BadRequestError('此登录账号已被使用，请更换。');
  throw error;
 }
 await audit(s,'employee.assignment_updated','member',id,{departmentId:data.departmentId,companyRoleId:data.companyRoleId,...(accountChange?{accountChange}:{})});
 return {saved:true,usernameChanged:!!accountChange};
}
async function transferWork(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,sourceId:string,targetId:string){
 const target=await db.member.findFirst({where:{organizationId:s.workspaceId,userId:targetId,enabled:true,deletedAt:null,user:{banned:false,deletedAt:null}}});
 if(!target||target.userId===sourceId)throw new BadRequestError('请选择其他已启用员工接替工作。');
 if(!p.allData)await permittedDepartment(db,s,p,target.companyDepartmentId);
 const companies=await db.crmCompany.findMany({where:{workspaceId:s.workspaceId,ownerId:sourceId},select:{id:true}});
 await db.crmCompany.updateMany({where:{workspaceId:s.workspaceId,ownerId:sourceId},data:{ownerId:targetId}});
 await db.crmTask.updateMany({where:{workspaceId:s.workspaceId,ownerId:sourceId,status:'PENDING'},data:{ownerId:targetId}});
 await db.automationTodo.updateMany({where:{organizationId:s.workspaceId,ownerId:sourceId,status:'OPEN'},data:{ownerId:targetId}});
 await db.automationRule.updateMany({where:{organizationId:s.workspaceId,ownerId:sourceId},data:{ownerId:targetId}});
  // Keep the original call employee for attribution; transfer the customer and
  // grant the successor access through the customer-specific history routes.
  await db.$executeRaw`WITH moved AS (UPDATE "CustomerIntentCustomer" SET "ownerId"=${targetId},"version"="version"+1,"updatedAt"=NOW() WHERE "workspaceId"=${s.workspaceId} AND "ownerId"=${sourceId} RETURNING "id") INSERT INTO "CustomerIntentHistory"("customerId","actor","title","note") SELECT "id",${s.userId},'员工工作交接',${'负责人从 '+sourceId+' 转交给 '+targetId} FROM moved`;
 await db.$executeRaw`UPDATE "BusinessContact" SET "ownerId"=${targetId},"updatedAt"=NOW() WHERE "organizationId"=${s.workspaceId} AND "ownerId"=${sourceId} AND NOT EXISTS (SELECT 1 FROM "BusinessContact" t WHERE t."organizationId"=${s.workspaceId} AND t."ownerId"=${targetId} AND t."phone"="BusinessContact"."phone")`;
 await db.crmActivity.createMany({data:companies.map(c=>({workspaceId:s.workspaceId,companyId:c.id,actorId:s.userId,kind:'ASSIGN',title:'员工工作交接',metadata:{previousOwnerId:sourceId,ownerId:targetId}}))});
}
type MemberCallActivity={id:string;status:string;provider:string;leaseExpired:boolean};
async function assertMemberCallsInactive(calls:MemberCallActivity[]){
 if(!calls.length)return;
 // Uncertain calls remain part of the history and receipt reconciliation. Only
 // an expired SIP review can be ignored for access control, after a positive
 // read-only switch check. Other providers and live/unknown leases stay closed.
 if(calls.length>1000)throw new BadRequestError('员工待核对通话数量较多，请先核对历史记录后再停用；账号尚未停用。');
 if(calls.some(c=>c.status!=='NEEDS_REVIEW'))throw new BadRequestError('员工仍有拨号或通话状态的记录，请等待结束或核对后再停用。');
 if(calls.some(c=>c.provider!=='HAOKEHU_SIP'||c.leaseExpired!==true||!uuid.safeParse(c.id).success))throw new BadRequestError('员工仍有未过期或无法自动核验的待核对记录，请先核对后再停用。');
 let origin:string;
 const token=process.env.SIP_BRIDGE_TOKEN;
 try{
  const url=new URL(process.env.SIP_BRIDGE_URL||'http://127.0.0.1:8511');
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password||!token)throw new Error('unavailable');
  origin=url.origin;
 }catch{throw new BadRequestError('电话服务暂不可用，无法核对历史通话；账号尚未停用，请稍后重试。');}
 const deadline=Date.now()+8000;
 const failures={timeout:1,unavailable:2,unknown:3,active:4} as const;
 let next=0;
 const activity:{failure:keyof typeof failures|null}={failure:null};
 const fail=(kind:keyof typeof failures)=>{if(!activity.failure||failures[kind]>failures[activity.failure])activity.failure=kind;};
 // Bound both the fan-out and total organization-lock time. Any unavailable,
 // unknown or active call leaves the member enabled; no call is hung up here.
 await Promise.all(Array.from({length:Math.min(6,calls.length)},async()=>{
  while(!activity.failure&&next<calls.length){
   const call=calls[next++]!,remaining=deadline-Date.now();
   if(remaining<=0){fail('timeout');break;}
   try{
    const response=await fetch(origin+'/status/'+call.id,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(Math.min(1500,remaining))});
    if(!response.ok){fail('unavailable');break;}
    const state:unknown=await response.json();
    if(!state||typeof state!=='object'||Array.isArray(state)||!('known' in state)||!('active' in state)||typeof state.known!=='boolean'||typeof state.active!=='boolean')fail('unavailable');
    else if(state.active)fail('active');
    else if(!state.known)fail('unknown');
   }catch{fail(Date.now()>=deadline?'timeout':'unavailable');}
  }
 }));
 if(activity.failure==='active')throw new BadRequestError('电话服务确认员工仍有正在拨号或通话，请等待结束后再停用。');
 if(activity.failure==='unknown')throw new BadRequestError('部分历史通话在电话服务中没有可核验记录，请先核对后再停用；账号尚未停用。');
 if(activity.failure==='unavailable')throw new BadRequestError('电话服务暂不可用，无法核对历史通话；账号尚未停用，请稍后重试。');
 if(activity.failure||next<calls.length)throw new BadRequestError('历史通话状态核对超时，请稍后重试；账号尚未停用。');
}
async function stopMemberWork(db:Db,s:Actor,p:Awaited<ReturnType<typeof policy>>,m:Awaited<ReturnType<typeof targetMember>>,handoverTo?:string,allowPausedTasks=false){
 if(allowPausedTasks){
  // Dial claims share-lock the organization before reserving an attempt. The
  // exclusive lock closes the gap between this check and disabling the member.
  const workspace=await db.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "Organization" WHERE "id"=${s.workspaceId} AND "deletedAt" IS NULL FOR UPDATE`;
  if(!workspace.length)throw new BadRequestError('当前公司已删除，不能调整员工访问权限。');
  // Match task-first recovery/dispatch ordering, then serialize with manual
  // and live-handoff seat reservations before checking their active records.
  await db.$queryRaw`SELECT "id" FROM "SipTask" WHERE "workspaceId"=${s.workspaceId} AND "createdBy"=${m.userId} ORDER BY "id" FOR UPDATE`;
  await db.$queryRaw`SELECT "userId" FROM "SipSeat" WHERE "workspaceId"=${s.workspaceId} AND "userId"=${m.userId} FOR UPDATE`;
 }
 const active=await db.sipTask.count({where:{workspaceId:s.workspaceId,createdBy:m.userId,status:{in:allowPausedTasks?['RUNNING','NEEDS_REVIEW']:['RUNNING','PAUSED','NEEDS_REVIEW']}}});
 if(active)throw new BadRequestError('员工仍有未结束的通话任务，请先结束或核对任务。');
 if(allowPausedTasks){
  // Include calls owned by this member and handoffs reserved for this member.
  // Queued attempts stay intact and resume only after the creator is enabled.
  // The result cap fails closed instead of holding the organization indefinitely.
  const calls=await db.$queryRaw<MemberCallActivity[]>`SELECT a."id",a."status",COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP') AS provider,(a."leaseUntil" IS NOT NULL AND a."leaseUntil"<=NOW()) AS "leaseExpired" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE t."workspaceId"=${s.workspaceId} AND a."status" IN ('DISPATCHING','DIALING','CONNECTED','NEEDS_REVIEW') AND (t."createdBy"=${m.userId} OR EXISTS (SELECT 1 FROM "SipLiveHandoff" h WHERE h."workspaceId"=a."workspaceId" AND h."attemptId"=a."id" AND h."userId"=${m.userId} AND h."status" IN ('RESERVED','CONNECTED'))) ORDER BY a."id" LIMIT 1001`;
  await assertMemberCallsInactive(calls);
 }
 const counts=await Promise.all([
  db.crmCompany.count({where:{workspaceId:s.workspaceId,ownerId:m.userId,deletedAt:null}}),
  db.crmTask.count({where:{workspaceId:s.workspaceId,ownerId:m.userId,status:'PENDING'}}),
  db.automationRule.count({where:{organizationId:s.workspaceId,ownerId:m.userId,enabled:true}}),
  db.automationTodo.count({where:{organizationId:s.workspaceId,ownerId:m.userId,status:'OPEN'}}),
  db.businessContact.count({where:{organizationId:s.workspaceId,ownerId:m.userId,deletedAt:null}}),
   db.$queryRaw<Array<{count:number}>>`SELECT count(*)::int AS count FROM "CustomerIntentCustomer" WHERE "workspaceId"=${s.workspaceId} AND "ownerId"=${m.userId}`.then(rows=>rows[0]?.count??0),
 ]);
 if(counts.some(Boolean)&&!handoverTo)throw new BadRequestError('员工仍有客户或待办工作，请选择接替员工。');
 if(handoverTo){
  const conflicts=await db.$queryRaw<{id:string}[]>`SELECT a."id" FROM "BusinessContact" a JOIN "BusinessContact" b ON b."organizationId"=a."organizationId" AND b."phone"=a."phone" AND b."ownerId"=${handoverTo} WHERE a."organizationId"=${s.workspaceId} AND a."ownerId"=${m.userId} AND a."deletedAt" IS NULL LIMIT 1`;
  if(conflicts.length)throw new BadRequestError('接替员工存在同号码客户，请先合并重复客户或选择其他员工。');
  await transferWork(db,s,p,m.userId,handoverTo);
 }
 await db.sipSeat.updateMany({where:{workspaceId:s.workspaceId,userId:m.userId},data:{available:false}});
 await db.$executeRaw`UPDATE "LeadSearchJob" SET "status"='PAUSED',"message"='员工访问已停止，任务已暂停' WHERE "organizationId"=${s.workspaceId} AND "ownerId"=${m.userId} AND "status"='SEARCHING'`;
}
export async function memberStatus(s:Actor,id:string,enabled:boolean,handoverTo?:string){
 await transact(s,'companyMembers',enabled?'update':'delete',async(db,p)=>{
  const m=await targetMember(db,s,p,id);
  if(enabled&&policyFromRow({...m,...m.companyRole,role:m.role,userRole:m.user.role}).requiresRoleMapping)throw new BadRequestError('请先在员工资料中把旧角色归并为管理员或普通用户，再启用账号。');
  if(!enabled)await stopMemberWork(db,s,p,m,handoverTo,true);
  await db.member.update({where:{id},data:{enabled}});
  await db.session.deleteMany({where:{userId:m.userId,activeOrganizationId:s.workspaceId}});
 });await audit(s,enabled?'employee.enabled':'employee.disabled','member',id,{handoverTo});return {saved:true};
}
export async function deleteMember(s:Actor,id:string,handoverTo?:string){
 await transact(s,'companyMembers','delete',async(db,p)=>{
  const m=await targetMember(db,s,p,id);
  if(m.role==='owner'||m.user.role?.split(',').includes('admin'))throw new ForbiddenError('公司所有者和超级管理员不能在员工页删除。');
  await stopMemberWork(db,s,p,m,handoverTo);
  await db.member.update({where:{id},data:{enabled:false,deletedAt:new Date()}});
  await db.session.deleteMany({where:{userId:m.userId,activeOrganizationId:s.workspaceId}});
 });await audit(s,'employee.deleted','member',id,{handoverTo});return {deleted:true};
}
export async function restoreMember(s:Actor,id:string){
 await transact(s,'companyMembers','update',async(db,p)=>{
  const m=await targetMember(db,s,p,id,true);
  if(!m.deletedAt)throw new BadRequestError('该员工没有删除。');
  // Restoring stays disabled; role review happens before the account is enabled.
  await permittedDepartment(db,s,p,m.companyDepartmentId);
  await db.member.update({where:{id},data:{deletedAt:null,enabled:false}});
 });await audit(s,'employee.restored','member',id);return {restored:true};
}
export async function resetMemberPassword(s:Actor,id:string,secret?:string){
 const password=secret??generateAccountPassword(),hash=await bcrypt.hash(password,10);
 const username=await transact(s,'companyMembers','resetPassword',async(db,p)=>{
  const m=await targetMember(db,s,p,id);
  if(!p.isSystemAdmin&&await db.member.count({where:{userId:m.userId}})!==1)throw new ForbiddenError('跨公司账号密码由超级管理员重置。');
  const result=await db.account.updateMany({where:{userId:m.userId,providerId:'credential'},data:{password:hash}});if(!result.count)throw new BadRequestError('该账号未配置密码登录。');
  await db.session.deleteMany({where:{userId:m.userId}});return accountUsername(m.user.email,domain);
 });await audit(s,'employee.password_reset','member',id);return {username,password};
}

export async function createMemberBatch(s:Actor,input:unknown){
 const data=z.object({requestId:uuid,departmentId:uuid.nullable(),companyRoleId:uuid.nullable(),scopeDepartmentIds:z.array(uuid).max(100).default([]),rows:z.array(z.object({name,username:accountNameSchema}).strict()).min(1).max(200)}).strict().parse(input);
 if(new Set(data.rows.map(r=>r.username)).size!==data.rows.length)throw new BadRequestError('名单中有重复账号。');
 const p=await policy(prisma,s);requireAction(p,'companyMembers','create');await checkedAssignment(prisma,s,p,data);
 const payloadHash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const prepared:Array<{username:string;name:string;password:string;hash:string;userId:string}>=[];
 for(let start=0;start<data.rows.length;start+=4)prepared.push(...await Promise.all(data.rows.slice(start,start+4).map(async row=>{const password=generateAccountPassword();return {...row,password,hash:await bcrypt.hash(password,10),userId:randomUUID()};})));
 const result=await transact(s,'companyMembers','create',async(db,p)=>{
  const assigned=await checkedAssignment(db,s,p,data);
  const old=await db.$queryRawUnsafe<Array<{actorId:string;payloadHash:string}>>('SELECT "actorId","payloadHash" FROM "CompanyMemberBatchReceipt" WHERE "workspaceId"=$1 AND "requestId"=$2',s.workspaceId,data.requestId);
  if(old.length){if(old[0]!.actorId!==s.userId||old[0]!.payloadHash!==payloadHash)throw new BadRequestError('批次编号已用于其他名单，请重新预览。');return {alreadyCreated:true,credentials:[] as Array<{name:string;username:string;password:string}>};}
  const emails=prepared.map(r=>accountEmail(r.username,domain));
  if(await db.user.count({where:{email:{in:emails}}}))throw new BadRequestError('名单中有账号已存在，请刷新后重新预览，尚未创建任何账号。');
  for(const r of prepared){
   await db.user.create({data:{id:r.userId,name:r.name,email:accountEmail(r.username,domain),emailVerified:true,role:'user'}});
   await db.account.create({data:{id:randomUUID(),accountId:r.userId,userId:r.userId,providerId:'credential',password:r.hash}});
   await db.member.create({data:{id:randomUUID(),userId:r.userId,organizationId:s.workspaceId,role:assigned.presetKey==='workspace_admin'?'admin':'member',companyDepartmentId:data.departmentId,companyRoleId:assigned.id,scopeDepartmentIds:[],createdAt:new Date()}});
  }
  await db.$executeRawUnsafe('INSERT INTO "CompanyMemberBatchReceipt"("workspaceId","requestId","actorId","payloadHash") VALUES ($1,$2,$3,$4)',s.workspaceId,data.requestId,s.userId,payloadHash);
  return {alreadyCreated:false,credentials:prepared.map(r=>({name:r.name,username:r.username,password:r.password}))};
 });
 await audit(s,'employees.batch_created','member_batch',data.requestId,{count:data.rows.length,duplicate:result.alreadyCreated});return result;
}
