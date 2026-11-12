/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import {apiClient,unwrap} from '../client';
export type GeneratedOpening={status:'GENERATING'|'READY'|'NEEDS_REVIEW';requestId:string;cached:boolean;error:string;asset?:{id:string;voiceId:string;textHash:string;durationSeconds:number};audio?:string|null};
const headers=(org:string)=>({'x-workspace-id':org});
export const customOpenings={
 generate:(org:string,agentId:string,input:{scope:'template'|'personal';voiceId:string;text:string;requestId:string;retryOf?:string;confirmed:true})=>unwrap<GeneratedOpening>(apiClient.post(`/telephony/script-recordings/${agentId}/generate`,input,{headers:headers(org),timeout:75000})),
 audio:async(org:string,agentId:string,assetId:string)=>(await apiClient.get<Blob>(`/telephony/script-recordings/${agentId}/${assetId}/audio`,{headers:headers(org),responseType:'blob'})).data,
};
