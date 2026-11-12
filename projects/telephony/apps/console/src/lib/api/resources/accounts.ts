/*
 * 中文导读：员工账号的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "../client";
export interface Department { id: string; name: string }
export interface ManagedAccount {
  id: string; username: string; name: string; role: string | null; banned: boolean | null; deletedAt: string | null; createdAt: string;
  departmentId: string | null; department: Department | null;
  members: { id:string;role:string;enabled:boolean;companyDepartment:Department|null;organization: { id: string; name: string } }[];
}
export interface Credentials { username: string; password: string }
export interface ManagedCompany {id:string;name:string;deletedAt:string|null;accessStatus:'ACTIVE'|'DISABLED'|'UNASSIGNED'}
const base = "/admin/accounts";
export const accountsApi = {
  switchOptions:()=>unwrap<{id:string;name:string;username:string}[]>(apiClient.get(`${base}/switch-options`)),
  updateOwnUsername:(data:{username:string;expectedUsername:string;currentPassword:string})=>unwrap<{username:string}>(apiClient.patch(`${base}/me/username`,data)),
  companies:(deleted=false)=>unwrap<ManagedCompany[]>(apiClient.get(`${base}/companies`,{params:{deleted}})),
  createCompany:(name:string)=>unwrap<{id:string;name:string}>(apiClient.post(`${base}/companies`,{name})),
  deleteCompany:(id:string,confirmationName:string)=>unwrap(apiClient.delete(`${base}/companies/${id}`,{data:{confirmationName}})),
  restoreCompany:(id:string)=>unwrap(apiClient.post(`${base}/companies/${id}/restore`,{})),
  membership:(id:string,data:{organizationId:string;companyRole:"admin"|"member";enabled:boolean})=>unwrap(apiClient.put(`${base}/${id}/membership`,data)),
  list: (deleted = false) => unwrap<ManagedAccount[]>(apiClient.get(base, {params:{deleted}})),
  remove: (id:string) => unwrap(apiClient.delete(`${base}/${id}`)),
  restore: (id:string) => unwrap(apiClient.post(`${base}/${id}/restore`, {})),
  departments: () => unwrap<Department[]>(apiClient.get(`${base}/departments`)),
  create: (data: { username: string; name: string; departmentId: string | null;organizationId:string;companyRole:"admin"|"member";accountType?:"employee"|"super_admin" }) => unwrap<{ account: ManagedAccount; credentials: Credentials }>(apiClient.post(base, data)),
  createDepartment: (name: string) => unwrap<Department>(apiClient.post(`${base}/departments`, { name })),
  renameDepartment: (id: string, name: string) => unwrap<Department>(apiClient.patch(`${base}/departments/${id}`, { name })),
  assignDepartment: (id: string, departmentId: string | null) => unwrap<ManagedAccount>(apiClient.patch(`${base}/${id}/department`, { departmentId })),
  status: (id: string, enabled: boolean) => unwrap<{ enabled: boolean }>(apiClient.patch(`${base}/${id}/status`, { enabled })),
  resetPassword: (id: string, password?: string) => unwrap<Credentials>(apiClient.post(`${base}/${id}/reset-password`, password ? { password } : {})),
};
