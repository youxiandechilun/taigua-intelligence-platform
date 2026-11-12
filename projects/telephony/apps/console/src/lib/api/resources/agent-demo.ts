/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import {apiClient,unwrap} from '../client';
import type {AgentVoicePreview,CallDiagnostics} from './telephony';
export type DemoQuestion={id:string;question:string;answer:string};
export type DemoLanguage='zh-CN'|'en';
export type DemoLanguageConfiguration={opening:string;voiceId:string|null;qa:DemoQuestion[];fallback:string};
export type DemoConfiguration={version:2;languages:Record<DemoLanguage,DemoLanguageConfiguration>};
export type AgentDemo={agentId:string;agentName:string;revision:number;updatedAt:string|null;configuration:DemoConfiguration;canEdit:boolean;readyLanguages:DemoLanguage[];pendingCall:DemoCallInput|null};
export type DemoCallInput={requestId:string;agentId:string;language:DemoLanguage;phoneNumber:string;lineId?:string;province?:string;requestedAt:string;expectedRevision:number;confirmation:'拨打演示电话'};
export type DemoCallStatus={diagnostics?:CallDiagnostics|null;id:string;agentId:string;taskStatus:string;status:string;attemptId:string|null;callId:string|null;error:string;durationSeconds:number;agentName:string;voiceName:string;maxDurationSeconds:number;demoCall:true;revision:number;language:DemoLanguage;configuration:DemoLanguageConfiguration;transcript:{speaker:string;text:string;timestamp:string}[];matchedQuestionId:string|null;progressSource:'transcript-match';recordingAvailable:boolean;recordingUrl:string|null};
const options=(org:string)=>({headers:{'x-workspace-id':org}});
const path=(id:string)=>`/telephony/agents/${id}/demo`;
export const agentDemoApi={
 get:(org:string,id:string)=>unwrap<AgentDemo>(apiClient.get(path(id),options(org))),
 save:(org:string,id:string,expectedRevision:number,configuration:DemoConfiguration)=>unwrap<AgentDemo>(apiClient.put(path(id),{expectedRevision,configuration},options(org))),
 preview:(org:string,id:string,data:{expectedRevision:number;language:DemoLanguage;key:string;requestId:string;retryOf?:string;confirmed:true})=>unwrap<AgentVoicePreview>(apiClient.post(path(id)+'-preview',data,{...options(org),timeout:75000})),
 call:(org:string,data:DemoCallInput)=>unwrap<DemoCallStatus>(apiClient.post('/telephony/demo-calls',data,options(org))),
 status:(org:string,id:string)=>unwrap<DemoCallStatus>(apiClient.get('/telephony/demo-calls/'+id,options(org))),
 discard:(org:string,id:string)=>unwrap<{deleted:true}>(apiClient.delete('/telephony/demo-calls/'+id,options(org))),
 recording:async(org:string,attemptId:string)=>(await apiClient.get<Blob>('/telephony/recordings/'+attemptId,{...options(org),responseType:'blob'})).data,
};
