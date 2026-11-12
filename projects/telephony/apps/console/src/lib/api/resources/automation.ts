/*
 * 中文导读：自动化流程的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from '../client';
export type AutomationKind='LEAD_READY'|'CALL_SUMMARY'|'DAILY_REPORT'|'MY_REPORT'|'FOLLOW_UP';
export interface AutomationRunSubmission {queued:boolean;status:'QUEUED'|'RUNNING'|'SUCCESS'|'FAILED'|'SKIPPED';runId?:string;message?:string}
export interface AutomationRule {id:string;kind:AutomationKind;name:string;ownerId:string;enabled:boolean;dailyHour:number}
export interface AutomationRun {id:string;kind:AutomationKind;status:string;attempts:number;error:string;createdAt:string;updatedAt:string;result:Record<string,unknown>|null}
export interface AutomationTodo {id:string;title:string;description:string;ownerName:string;status:'OPEN'|'DONE'|'CANCELLED';createdAt:string}
export interface AutomationOverview {engine:{ready:boolean;configured:boolean};canManage:boolean;canEditEngine:boolean;personalRules:AutomationRule[];rules:AutomationRule[];runs:AutomationRun[];todos:AutomationTodo[]}
const headers=(org:string)=>({'x-workspace-id':org});
export const automationApi={
 templates:(org:string,deleted=false)=>unwrap<LearningTemplate[]>(apiClient.get('/automation/templates',{headers:headers(org),params:{deleted}})),
 learning:(org:string,deleted=false)=>unwrap<LearningDraft[]>(apiClient.get('/automation/learning',{headers:headers(org),params:{deleted}})),
 changeTemplates:(org:string,ids:string[],restore=false)=>unwrap(apiClient.post('/automation/templates/batch',{ids,restore},{headers:headers(org)})),
 changeDrafts:(org:string,ids:string[],restore=false)=>unwrap(apiClient.post('/automation/learning/batch',{ids,restore},{headers:headers(org)})),
 saveLearning:(org:string,data:{id?:string;templateId:string;name:string;notes:string})=>unwrap(apiClient.post('/automation/learning',data,{headers:headers(org)})),
 savePersonal:(org:string,r:AutomationRule)=>unwrap(apiClient.put('/automation/personal/'+r.kind,{enabled:r.enabled,dailyHour:r.dailyHour},{headers:headers(org)})),
 runPersonal:(org:string,kind:AutomationKind)=>unwrap(apiClient.post('/automation/personal/'+kind+'/run',{}, {headers:headers(org)})),
 file:async(org:string,path:string,name:string)=>{const response=await apiClient.get('/automation/'+path,{responseType:'blob',headers:headers(org)});const url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
 get:(org:string,view:'mine'|'company'='mine')=>unwrap<AutomationOverview>(apiClient.get('/automation',{headers:headers(org),params:{view}})),
 save:(org:string,r:AutomationRule)=>unwrap(apiClient.put('/automation/rules/'+r.kind,{enabled:r.enabled,dailyHour:r.dailyHour,ownerId:r.ownerId},{headers:headers(org)})),
 run:(org:string,kind:AutomationKind)=>unwrap<AutomationRunSubmission>(apiClient.post('/automation/rules/'+kind+'/run',{}, {headers:headers(org)})),
 retry:(org:string,id:string)=>unwrap(apiClient.post('/automation/runs/'+id+'/retry',{}, {headers:headers(org)})),
 done:(org:string,id:string)=>unwrap(apiClient.post('/automation/todos/'+id+'/done',{}, {headers:headers(org)})),
 download:async(org:string,id:string,name:string)=>{const response=await apiClient.get('/automation/runs/'+id+'/download',{responseType:'blob',headers:headers(org)});const url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
};

export interface LearningTemplate {id:string;name:string;author:string;description:string;steps:string[];sourceUrl:string;sha256:string}
export interface LearningDraft {id:string;templateId:string;name:string;notes:string;updatedAt:string}
