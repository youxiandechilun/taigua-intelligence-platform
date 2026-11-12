/*
 * 中文导读：从有效成员记录计算当前公司访问上下文；列表、详情和录音读取复用数据范围。
 * organizationId 与 userId 来自调用方的认证上下文；前端筛选员工不等于切换登录身份。
 * 页面菜单只决定入口展示，真正的数据可见范围仍需由后端查询条件约束。
 */
import prisma from '../../config/prisma.js';
import {platformEnabled} from '../platform/platform-client.js';
import {requestedDataOwner} from './data-owner-policy.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { isCompanyManagerRole } from '../../lib/access-control.js';
import {policyFromRow,scopedOwnerSql} from './company-policy.js';
export const isManager=(role:string)=>isCompanyManagerRole(role);
/* 中文注释：从数据库重新读取有效成员及组织状态，生成权限和数据范围上下文。 */

export async function companyContext(organizationId:string,userId:string){
 const row=await prisma.member.findFirst({where:{organizationId,userId,enabled:true,deletedAt:null,organization:{deletedAt:null},user:{banned:false,deletedAt:null}},include:{companyRole:true,companyDepartment:{select:{id:true,name:true}},user:{select:{role:true,name:true}}}});
 if(!row)throw new ForbiddenError('你无权访问当前公司，请联系管理员。');
 const policy=policyFromRow({...row,...row.companyRole,role:row.role,userRole:row.user.role,roleName:row.companyRole?.name});
 // Older company-wide configuration pages remain restricted to full-company managers.
 return {organizationId,role:row.role,...policy,canCreateAgents:policy.isSystemAdmin||(platformEnabled()&&policy.isWorkspaceAdmin),currentMember:{name:row.user.name,position:policy.roleName,department:row.companyDepartment},canManage:policy.canManage&&policy.allData,accessLevel:policy.isSystemAdmin?'system_admin':policy.isWorkspaceAdmin?'company_admin':'employee'};
}
/* 中文注释：查询当前访问者在本公司获准覆盖的员工编号。 */

export async function scopedCompanyUserIds(organizationId:string,userId:string){
 const rows=await prisma.$queryRawUnsafe<{userId:string}[]>(`SELECT m."userId" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND ${scopedOwnerSql('m."userId"')} ORDER BY m."userId"`,organizationId,userId);
 return rows.map(r=>r.userId);
}
/* 中文注释：将员工筛选条件限制在当前账号可读范围内；所选员工必须属于同一公司。 */


// Resolve a read filter inside the current company; never impersonate the selected account.
export async function resolveDataOwner(organizationId:string,actorId:string,requested='mine') {
 const access=await companyContext(organizationId,actorId);
 const owner=requestedDataOwner(actorId,access.canViewWorkspaceData,requested);
 if(owner&&owner!==actorId&&!await prisma.member.findFirst({where:{organizationId,userId:owner,deletedAt:null},select:{userId:true}}))throw new ForbiddenError('该账号不属于当前公司。');
 return owner;
}
/* 中文注释：为通话查询生成归属条件；管理员可读工作区数据，普通用户受本人范围限制。 */

// Detail and audio reads use the same workspace data scope as lists and tasks.
// List endpoints always pass an explicit owner filter, defaulting to mine.
export async function callVisibilityWhere(organizationId:string,viewerId?:string,requestedOwner?:string):Promise<import('../../../prisma/generated/prisma/client.js').Prisma.CallLogWhereInput>{
 if(!viewerId)return {};
 if(requestedOwner!==undefined){const owner=await resolveDataOwner(organizationId,viewerId,requestedOwner);return owner?{userId:owner}:{};}
 const access=await companyContext(organizationId,viewerId);
 return access.canViewWorkspaceData?{}:{userId:viewerId};
}
