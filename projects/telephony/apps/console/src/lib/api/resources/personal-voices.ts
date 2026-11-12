/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient,unwrap } from '../client';
import type { AgentVoicePreview } from './telephony';
export type CallVoiceProvider='HAOKEHU_SIP'|'ALIYUN_ENGINE';
export type PersonalVoiceOption={key:string;name:string;model:string;voice:string;voiceId:string;gender:'neutral'|'female'|'male';kind:'builtin'|'clone'|'cloud';available:boolean;reason:string;hasPreview:boolean};
export type EmployeeSound={version:1;ownerId:string;provider:CallVoiceProvider;source:'agent'|'default'|'company';choice:string;name:string;gender:'neutral'|'female'|'male';model:string;voice:string;voiceId:string;volume:number|null;ttsVoiceCode:string};
export type PersonalVoiceProvider={provider:CallVoiceProvider;choice:string;volume:number|null;updatedAt:string|null;accountDefault:{choice:string|null;volume:number|null;updatedAt:string}|null;effective:EmployeeSound|null;companyDefault:EmployeeSound|null;error:string;options:PersonalVoiceOption[]};
export type PersonalVoiceCatalog={voiceManagementVersion?:number;canUpdateLibrary?:boolean;agentId:string;releaseVersion:number;providers:PersonalVoiceProvider[]};
export type PersonalVoicePreview=({kind:'model';volume:number}&AgentVoicePreview)|{kind:'sample';voiceId:string;volume:number};
const options=(org:string)=>({headers:{'x-workspace-id':org}});
const base=(id:string)=>'/telephony/my-voices/'+id;
export const personalVoices={
 catalog:(org:string,id:string)=>unwrap<PersonalVoiceCatalog>(apiClient.get(base(id),options(org))),
 save:(org:string,id:string,data:{provider:CallVoiceProvider;choice:string;volume:number|null;useAsDefault:boolean;expectedUpdatedAt:string|null;expectedDefaultUpdatedAt:string|null})=>unwrap<PersonalVoiceCatalog>(apiClient.put(base(id),data,options(org))),
 preview:(org:string,id:string,data:{provider:CallVoiceProvider;choice:string;volume:number|null;requestId:string;retryOf?:string;confirmed:true})=>unwrap<PersonalVoicePreview>(apiClient.post(base(id)+'/preview',data,{...options(org),timeout:65000})),
 sample:async(org:string,id:string,voiceId:string)=>(await apiClient.get<Blob>(base(id)+'/samples/'+voiceId,{...options(org),responseType:'blob'})).data,
};
