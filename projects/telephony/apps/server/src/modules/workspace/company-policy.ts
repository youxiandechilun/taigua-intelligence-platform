/*
 * 中文导读：超级管理员、管理员、普通用户的固定权限与数据范围，以及查询使用的权限片段。
 * 固定角色仍需区分工作区：管理员具有公司范围，不代表可以读取其他公司的业务数据。
 * 客户分配授权和通话归属是不同条件，修改时应连同调用方的工作区筛选一起检查。
 */
export type CompanyPermissions = Record<string, string[]>;
export const companyResources: Record<string, {label:string;actions:string[]}> = {
 companyMembers:{label:'员工账号',actions:['read','create','update','delete','resetPassword']},
 companyDepartments:{label:'组织架构',actions:['read','create','update','delete']},
 companyRoles:{label:'角色权限',actions:['read','create','update','delete']},
 agentPreview:{label:'数字员工演练',actions:['create']},
 lines:{label:'线路使用与分配',actions:['read','assign']},
 seats:{label:'员工接听',actions:['read','create','update','delete']},
 crm:{label:'客户库',actions:['read','create','update','delete','assign','import','export']},
 agent:{label:'数字员工',actions:['read','create','update','delete']},
 agentConfiguration:{label:'数字员工培训与发布',actions:['read','create','update','delete','publish']},
 knowledgeSource:{label:'知识库',actions:['read','create','update','delete']},
 outboundCalls:{label:'客户通话',actions:['read','create','delete']},
 campaigns:{label:'外呼任务',actions:['read','create','delete']},
 callLogs:{label:'通话记录',actions:['read','delete']},
 automation:{label:'自动化',actions:['read','create','update','delete']},
 wecom:{label:'企业微信',actions:['read','update']},
 billing:{label:'用量与费用',actions:['read']},
};
export const scopeLabels:Record<string,string>={WORKSPACE:'本工作区全部业务数据',SELF:'本人及明确分配的数据'};
export const fullCompanyPermissions:CompanyPermissions=Object.fromEntries(Object.entries(companyResources).map(([k,v])=>[k,[...v.actions]]));
// Task number imports are separate from importing or managing CRM records.
const employee:CompanyPermissions={agentPreview:['create'],crm:['read'],agent:['read'],agentConfiguration:['read'],knowledgeSource:['read'],outboundCalls:['read','create'],callLogs:['read'],campaigns:['read'],lines:['read'],seats:['read'],automation:['read'],wecom:['read']};
const administrator:CompanyPermissions={...fullCompanyPermissions,companyRoles:['read']};
export const rolePresets=[
 {presetKey:'workspace_admin',name:'管理员',description:'管理本工作区的人员、任务、通话、客户与业务素材。',rank:10,dataScope:'WORKSPACE',permissions:administrator},
 {presetKey:'employee',name:'普通用户',description:'使用本人任务、通话及明确分配的客户和数字员工。',rank:100,dataScope:'SELF',permissions:employee},
];
export type FixedRoleKey='super_admin'|'admin'|'user';
export const fixedRoleNames:Record<FixedRoleKey,string>={super_admin:'超级管理员',admin:'管理员',user:'普通用户'};
/* 中文注释：兼容旧成员字段并归一为超级管理员、管理员、普通用户三个固定角色。 */

export function fixedRoleKey(row:Record<string,any>):FixedRoleKey{
 const tokens=(value:unknown)=>String(value||'').split(',').map(part=>part.trim());
 if(tokens(row.userRole).includes('admin'))return 'super_admin';
 if(tokens(row.role).some(role=>role==='owner'||role==='admin')||(row.presetKey??row.companyRole?.presetKey)==='workspace_admin')return 'admin';
 return 'user';
}
export const grants=(permissions:CompanyPermissions,resource:string,action:string)=>permissions[resource]?.includes(action)===true;
/* 中文注释：将固定角色映射为资源权限、数据范围和界面管理能力。 */

export function policyFromRow(row:Record<string,any>){
 const roleKey=fixedRoleKey(row),isSystemAdmin=roleKey==='super_admin',isWorkspaceAdmin=roleKey==='admin';
 const assigned:CompanyPermissions=isSystemAdmin?fullCompanyPermissions:isWorkspaceAdmin?administrator:employee;
 const permissions:CompanyPermissions=Object.fromEntries(Object.entries(assigned).map(([resource,actions])=>[resource,[...actions]]));
 const dataScope=isSystemAdmin||isWorkspaceAdmin?'WORKSPACE':'SELF';
 const canManageMembers=grants(permissions,'companyMembers','read');
 const presetKey=row.presetKey??row.companyRole?.presetKey;
 return {roleKey,isSystemAdmin,isWorkspaceAdmin,canViewWorkspaceData:isSystemAdmin||isWorkspaceAdmin,canManageAnnouncements:isSystemAdmin||isWorkspaceAdmin,permissions,dataScope,allData:dataScope==='WORKSPACE',rank:isSystemAdmin?0:isWorkspaceAdmin?10:100,companyRoleId:row.companyRoleId??null,roleName:fixedRoleNames[roleKey],requiresRoleMapping:Boolean(row.companyRoleId&&!['workspace_admin','employee'].includes(presetKey)),departmentId:row.companyDepartmentId??null,scopeDepartmentIds:[],canManageMembers,canManageDepartments:grants(permissions,'companyDepartments','read'),canManageRoles:grants(permissions,'companyRoles','read'),canManageSeats:grants(permissions,'seats','read')&&['create','update','delete'].some(a=>grants(permissions,'seats',a)),canAssignCustomers:grants(permissions,'crm','assign'),canManage:grants(permissions,'crm','assign')};
}
/* 中文注释：构造所有者范围条件；工作区和访问者通过绑定参数传入查询。 */

// The organization and actor are bound SQL parameters, never browser-selected ids.
export function scopedOwnerSql(owner:string,org='$1',actor='$2'){
 return `(${owner}=${actor} OR EXISTS (
 SELECT 1 FROM "Member" target JOIN "Member" principal ON principal."organizationId"=target."organizationId" AND principal."userId"=${actor}
 JOIN "User" pu ON pu."id"=principal."userId" LEFT JOIN "CompanyRole" cr ON cr."workspaceId"=principal."organizationId" AND cr."id"=principal."companyRoleId"
 WHERE target."organizationId"=${org} AND target."userId"=${owner} AND principal."enabled"=true AND principal."deletedAt" IS NULL AND pu."banned"=false AND pu."deletedAt" IS NULL AND (
 'admin'=ANY(string_to_array(replace(COALESCE(pu."role",''),' ',''),',')) OR principal."role" IN ('owner','admin') OR cr."presetKey"='workspace_admin'
 )))`;
}
/* 中文注释：客户数据允许本人、获授权账号或具备公司范围的管理员读取。 */

export function customerVisibleSql(alias='c',org='$1',actor='$2'){
 return `(${scopedOwnerSql(alias+'."ownerId"',org,actor)} OR ${actor}=ANY(${alias}."authorizedUserIds"))`;
}
/* 中文注释：构造同工作区且属于当前访问者的通话条件；其他授权场景由调用方处理。 */


export function callVisibleSql(alias='c',org='$1',actor='$2'){
 return `(${alias}."organizationId"=${org} AND ${alias}."userId"=${actor})`;
}
