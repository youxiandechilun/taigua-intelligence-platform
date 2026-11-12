/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import {apiClient,unwrap} from '../client';
import type {ConversationPlaybook} from './playbook';
export type LearningEvidence={sourceId:number;quote:string};
export type LearningSuggestion={schemaVersion?:2;summary:string;strengths:string[];improvements:string[];faqs:{question:string;answer:string;evidence?:LearningEvidence}[];objections:{trigger:string;response:string;evidence?:LearningEvidence}[];openingSuggestion:string;openingEvidence?:LearningEvidence;unverifiedClaims:string[];keywords?:{word:string;category:'需求'|'异议'|'产品'|'邀约'|'其他';evidence:LearningEvidence}[];dialogue?:{speaker:'员工'|'客户'|'待确认';text:string;evidence:LearningEvidence}[];removed?:{reason:string;evidence:LearningEvidence}[];sourceSegments?:{id:number;startSeconds:number;endSeconds:number;text:string}[];cleanup?:{originalCharacters:number;retainedSegments:number;filteredSegments:number;removedLines:number};stage?:string;processedSeconds?:number;reviewedAt?:string};
export type LearningReview=Pick<LearningSuggestion,'summary'|'strengths'|'improvements'|'faqs'|'objections'|'openingSuggestion'|'openingEvidence'|'unverifiedClaims'|'keywords'>;
export type LearningRecording={id:string;name:string;durationSeconds:number;transcript:string;analysis:LearningSuggestion|null;knowledgeDocument?:{id:string;status:string;revision:number;deletedAt:string|null}|null;status:string;error:string;createdAt:string;updatedAt:string};
export type TrainingMessage={role:'user'|'assistant';content:string};
export type RehearsalRecord={id:string;messages:TrainingMessage[];revision:string;correction:string;createdAt:string};
const root=(id:string)=>'/agents/'+encodeURIComponent(id)+'/learning';
const options=(org:string)=>({headers:{'x-workspace-id':org}});
export const learningApi={
 detail:(id:string,org:string,recording:string)=>unwrap<LearningRecording>(apiClient.get(root(id)+'/recordings/'+recording,options(org))),
 list:(id:string,org:string)=>unwrap<LearningRecording[]>(apiClient.get(root(id)+'/recordings',options(org))),
 capabilities:(id:string,org:string)=>unwrap<{transcriptionAvailable:boolean;analysisAvailable:boolean;analysisProvider:string;analysisModel:string;canManageKnowledge:boolean}>(apiClient.get(root(id)+'/capabilities',options(org))),
 upload:(id:string,org:string,name:string,audio:Blob,autoLearn=true)=>unwrap<{id:string;status:'QUEUED'|'UPLOADED'}>(apiClient.post(root(id)+'/recordings',audio,{...options(org),headers:{'x-workspace-id':org,'Content-Type':'audio/wav','x-recording-consent':'yes','x-recording-auto-learn':autoLearn?'yes':'no','x-recording-name':encodeURIComponent(name)},timeout:120000})),
 saveReview:(id:string,org:string,recording:string,expectedUpdatedAt:string,review:LearningReview)=>unwrap<{updatedAt:string;analysis:LearningSuggestion}>(apiClient.patch(root(id)+'/recordings/'+recording+'/analysis',{expectedUpdatedAt,review},options(org))),
 knowledge:(id:string,org:string,recording:string)=>unwrap<{id:string;status:string;deletedAt:string|null}>(apiClient.post(root(id)+'/recordings/'+recording+'/knowledge',{},options(org))),
 learn:(id:string,org:string,recording:string,retryConfirmed=false)=>unwrap(apiClient.post(root(id)+'/recordings/'+recording+'/learn',{consented:true,...(retryConfirmed?{retryConfirmed:true}:{})},options(org))),
 archive:(id:string,org:string,recording:string)=>unwrap(apiClient.delete(root(id)+'/recordings/'+recording,options(org))),
 audio:async(id:string,org:string,recording:string)=>(await apiClient.get<Blob>(root(id)+'/recordings/'+recording+'/audio',{...options(org),responseType:'blob'})).data,
 rehearse:(id:string,org:string,messages:TrainingMessage[],playbook:ConversationPlaybook,placeholders?:Record<string,string>)=>unwrap<{answer:string;model:string}>(apiClient.post(root(id)+'/rehearse',{messages,playbook,...(placeholders?{placeholders}:{})},{...options(org),timeout:60000})),
 history:(id:string,org:string)=>unwrap<RehearsalRecord[]>(apiClient.get(root(id)+'/sessions',options(org))),
 saveSession:(id:string,org:string,data:{messages:TrainingMessage[];revision:string;correction:string})=>unwrap(apiClient.post(root(id)+'/sessions',data,options(org))),
};
