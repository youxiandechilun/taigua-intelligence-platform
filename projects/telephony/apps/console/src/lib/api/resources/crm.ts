/*
 * 中文导读：客户管理的前端接口封装，将页面调用连接到后端资源。
 */
import {apiClient,unwrap} from '../client';
export type CrmRow=Record<string,any>;
export interface CrmPage {rows:CrmRow[];total:number;page:number;pageSize:number;canManage:boolean;permissions:string[]}
export const crmLabels:Record<string,string>={REVIEW:'待审核',READY:'待拨打',CONNECTED:'已接通',INTERESTED:'有意向',FOLLOW_UP:'跟进中',WON:'已成交',INVALID:'无效线索',OPT_OUT:'拒绝联系',PENDING:'待完成',DONE:'已完成',CANCELLED:'已取消',COMPLETED:'已接通',NOT_ANSWERED:'未接通',FAILED:'失败',IN_PROGRESS:'进行中',SCHEDULED:'已计划',PROCESSED:'已处理',UNKNOWN:'尚不明确',NO_NEED:'暂无需求'};
export const crmStatuses=['REVIEW','READY','CONNECTED','INTERESTED','FOLLOW_UP','WON','INVALID','OPT_OUT'];
const options=(workspaceId:string)=>({headers:{'x-workspace-id':workspaceId}});
export const crmApi={
 list:(w:string,r:string,params:CrmRow={})=>unwrap<CrmPage>(apiClient.get('/crm/'+r,{...options(w),params})),
 detail:(w:string,id:string)=>unwrap<CrmRow>(apiClient.get('/crm/companies/'+id,options(w))),
 post:(w:string,path:string,input:CrmRow={})=>unwrap<CrmRow>(apiClient.post('/crm/'+path,input,options(w))),
 patch:(w:string,path:string,input:CrmRow)=>unwrap<CrmRow>(apiClient.patch('/crm/'+path,input,options(w))),
 download:async(w:string,r:string,params:CrmRow={})=>{const response=await apiClient.get('/crm/export/'+r,{...options(w),params,responseType:'blob'});const url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download=(({companies:'企业客户',contacts:'联系人',leads:'线索池',tasks:'跟进任务',calls:'客户通话记录'} as Record<string,string>)[r]||'客户资料')+'.xlsx';a.click();URL.revokeObjectURL(url);},
 downloadTemplate:async(w:string)=>{const response=await apiClient.get('/crm/import/template',{...options(w),responseType:'blob'});const url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download='客户导入模板.xlsx';a.click();URL.revokeObjectURL(url);},
};
export const crmDate=(v:unknown)=>v?new Date(String(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
