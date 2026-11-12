/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import {useQuery} from '@tanstack/react-query';
import {authClient} from '@/src/lib/auth-client';
import {apiClient,unwrap} from '../client';
import type {Credentials} from './accounts';
export type CompanyPermissions=Record<string,string[]>;
export type FixedRoleKey='super_admin'|'admin'|'user';
export type CompanyRole={id:string;name:string;description:string;rank:number;dataScope:string;permissions:CompanyPermissions;roleKey?:FixedRoleKey;memberCount?:number;canEdit?:boolean;canAssign?:boolean;canDelete?:boolean};
export type OrganizationUnit={id:string;name:string;parentId:string|null;kind:'DIVISION'|'CENTER'|'DEPARTMENT';memberCount?:number;childCount?:number};
export interface CompanyContext {navigation?:import("@/src/lib/navigation").NavigationPolicy;organizationId:string;departmentId?:string|null;currentMember?:{name:string;position:string;department:{id:string;name:string}|null};role:string;roleKey:FixedRoleKey;roleName:string;rank:number;companyRoleId:string|null;dataScope:string;scopeLabel:string;allData:boolean;canViewWorkspaceData:boolean;isWorkspaceAdmin:boolean;canManage:boolean;canManageAnnouncements:boolean;canManageMembers:boolean;canManageDepartments:boolean;canManageRoles:boolean;canManageSeats:boolean;canAssignCustomers:boolean;isSystemAdmin:boolean;canCreateAgents:boolean;permissions:CompanyPermissions;accessLevel:'system_admin'|'company_owner'|'company_admin'|'employee';assignees:{id:string;name:string;role:string;department: {id:string;name:string}|null}[]}
export type EmployeeReception={phone:string;available:boolean};
export interface CompanyMember {id:string;userId:string;name:string;username:string;role:string;roleKey:FixedRoleKey;roleName:string;rank:number;dataScope:string;companyRoleId:string|null;scopeDepartmentIds:string[];accessRevision:string;requiresRoleMapping:boolean;enabled:boolean;deletedAt:string|null;departmentId:string|null;department:{id:string;name:string}|null;canEdit:boolean;reception:EmployeeReception|null;canManageReception:boolean}
export type MemberAssignment={username?:string;expectedUsername?:string;expectedAccessRevision?:string;name?:string;departmentId:string|null;companyRoleId:string|null;scopeDepartmentIds:string[];reception?:EmployeeReception};
export type RoleCatalog={roles:CompanyRole[];resources:Record<string,{label:string;actions:string[]}>;scopeLabels:Record<string,string>;canCreate:boolean;minRank:number;permissionModel?:string;pendingRoleMappings?:number};
const base=(org:string)=>`/company/${encodeURIComponent(org)}`;
export const companyApi={
 saveNavigation:(data:import("@/src/lib/navigation").NavigationPolicy&{expectedRevision:number})=>unwrap<import("@/src/lib/navigation").NavigationPolicy>(apiClient.put('/company/navigation',{items:data.items,expectedRevision:data.expectedRevision})),
 context:()=>unwrap<CompanyContext>(apiClient.get('/company/context')),
 members:(org:string,deleted=false)=>unwrap<CompanyMember[]>(apiClient.get(`${base(org)}/members`,{params:{deleted}})),
 remove:(org:string,id:string,handoverTo?:string)=>unwrap(apiClient.delete(`${base(org)}/members/${id}`,{data:handoverTo?{handoverTo}:{}})),
 restore:(org:string,id:string)=>unwrap(apiClient.post(`${base(org)}/members/${id}/restore`,{})),
 departmentOptions:(org:string)=>unwrap<OrganizationUnit[]>(apiClient.get(`${base(org)}/organization-options`)),
 departments:(org:string)=>unwrap<OrganizationUnit[]>(apiClient.get(`${base(org)}/departments`)),
 roles:(org:string)=>unwrap<RoleCatalog>(apiClient.get(`${base(org)}/roles`)),
 assignableRoles:(org:string)=>unwrap<CompanyRole[]>(apiClient.get(`${base(org)}/assignable-roles`)),
 create:(org:string,data:MemberAssignment&{username:string;name:string})=>unwrap<Credentials>(apiClient.post(`${base(org)}/members`,data)),
 assignment:(org:string,id:string,data:MemberAssignment)=>unwrap(apiClient.patch(`${base(org)}/members/${id}/assignment`,data)),
 update:(org:string,id:string,data:{enabled:boolean;departmentId?:string|null;handoverTo?:string})=>unwrap(apiClient.patch(`${base(org)}/members/${id}`,data)),
 department:(org:string,id:string,departmentId:string|null)=>unwrap(apiClient.patch(`${base(org)}/members/${id}/department`,{departmentId})),
 reset:(org:string,id:string,password?:string)=>unwrap<Credentials>(apiClient.post(`${base(org)}/members/${id}/reset-password`,password?{password}:{})),
 saveDepartment:(org:string,data:Omit<OrganizationUnit,'id'|'memberCount'|'childCount'>,id?:string)=>unwrap<OrganizationUnit>(id?apiClient.patch(`${base(org)}/departments/${id}`,data):apiClient.post(`${base(org)}/departments`,data)),
 removeDepartment:(org:string,id:string)=>unwrap(apiClient.delete(`${base(org)}/departments/${id}`)),
 saveRole:(org:string,data:Omit<CompanyRole,'id'|'memberCount'|'canEdit'|'canAssign'>,id?:string)=>unwrap<CompanyRole>(id?apiClient.patch(`${base(org)}/roles/${id}`,data):apiClient.post(`${base(org)}/roles`,data)),
 removeRole:(org:string,id:string,replacementRoleId?:string)=>unwrap(apiClient.delete(`${base(org)}/roles/${id}`,{data:replacementRoleId?{replacementRoleId}:{}})),
};
export const hasCompanyPermission=(context:CompanyContext|undefined,resource:string,action:string)=>context?.isSystemAdmin===true||context?.permissions?.[resource]?.includes(action)===true;
export const canViewWorkspaceData=(context:CompanyContext|undefined)=>context?.isSystemAdmin===true||context?.canViewWorkspaceData===true;
export function useCompanyContext(){const {data:session}=authClient.useSession();return useQuery({queryKey:['company-context',session?.user.id,session?.session.activeOrganizationId],queryFn:companyApi.context,enabled:Boolean(session?.user.id&&session?.session.activeOrganizationId),staleTime:10000,refetchInterval:30000,refetchOnWindowFocus:true});}
export function useCompanyUnits(context:CompanyContext|undefined){const {data:session}=authClient.useSession();const org=context?.organizationId;return useQuery({queryKey:['company-units',session?.user.id,org,context?.canManageDepartments?'manage':'options'],queryFn:()=>context?.canManageDepartments?companyApi.departments(org!):companyApi.departmentOptions(org!),enabled:Boolean(org&&(context?.canManageDepartments||context?.canManageMembers||context?.canManageSeats))});}
export function unitLabel(unit:OrganizationUnit,units:OrganizationUnit[]){const names=[unit.name],seen=new Set([unit.id]);let id=unit.parentId;while(id&&!seen.has(id)){seen.add(id);const parent=units.find(d=>d.id===id);if(!parent)break;names.unshift(parent.name);id=parent.parentId;}return names.join(' / ');}
