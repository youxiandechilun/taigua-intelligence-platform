/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import {useQuery} from '@tanstack/react-query';
import {apiClient,unwrap} from '../client';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
export type Audience={allEmployees:boolean;userIds:string[];departmentIds:string[]};
export type AgentRelease={agentId:string;name:string;isActive:boolean;version:number|null;publishedAt:string|null;usable:boolean;audience?:Audience;hasUnpublishedChanges?:boolean};
export type ReleaseStatus=AgentRelease&{canTrain:boolean;canPublish:boolean;draftDigest?:string;draftError?:string;versions:{id:string;version:number;note:string;createdAt:string}[]};
const options=(org:string)=>({headers:{'x-workspace-id':org}});
export const agentReleases={
  catalog:(org:string)=>unwrap<{canTrain:boolean;canPublish:boolean;agents:AgentRelease[]}>(apiClient.get('/agents/releases',options(org))),
  status:(org:string,id:string)=>unwrap<ReleaseStatus>(apiClient.get('/agents/'+id+'/release',options(org))),
  publish:(org:string,id:string,expectedDigest?:string)=>unwrap<{id:string;version:number}>(apiClient.post('/agents/'+id+'/release',{expectedDigest},options(org))),
  audience:(org:string,id:string,data:Audience)=>unwrap(apiClient.put('/agents/'+id+'/audience',data,options(org))),
};
export function useAgentRelease(id:string){const {org,user}=useAliyunIdentity();return useQuery({queryKey:['agent-release',user,org,id],queryFn:()=>agentReleases.status(org,id),enabled:!!org&&!!id,retry:false,staleTime:10000});}
