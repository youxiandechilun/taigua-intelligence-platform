/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient } from "@/src/lib/api/client";
import type { ApiEnvelope } from "@/src/lib/api/types";

export type FlowPortPosition = {side:'top'|'right'|'bottom'|'left';offset:number};
export type FlowNode = { id:string; kind:"speech"|"collect"|"text"|"ivr"|"jump"|"end"|"handoff"; title:string; text:string; x:number; y:number; field:string; outcome:"neutral"|"interested"|"declined"|"follow_up";ports?:{input?:FlowPortPosition;outputs?:Record<string,FlowPortPosition>} };
export type FlowEdge = { id:string; source:string; target:string; branch:string; condition:string };
export type FlowGraph = {version:1;revision:string;entry:string;nodes:FlowNode[];edges:FlowEdge[];viewport?:{x:number;y:number;zoom:number}};
export type RecordingManifest={version:1;voiceId?:string;openingSource?:'library'|'generated';entries:Record<string,{mode:'recording-first'|'ai';clips:{assetId:string;textHash:string;voiceId?:string}[];direct?:boolean;phrases?:string[];openingPlayback?:'random'|'fixed';selectedOpeningId?:string}>};
export type SystemSpeechLanguage={noResponseFirst:string;noResponseSecond:string;noResponseEnd:string;unclear:string;declined:string;followUp:string;goodbye:string;handoffStart:string;handoffUnavailable:string;audioCheck?:string;aliyunDefaultEnd?:string;aliyunOptOut?:string;aliyunDurationEnd?:string;aliyunSilencePrompt?:string;aliyunSilenceEnd?:string;aliyunContinue?:string;aliyunFlowLimit?:string;aliyunFlowError?:string;aliyunNoReply?:string;aliyunUnclear?:string;aliyunHandoff?:string};
export type SystemSpeech={zh:SystemSpeechLanguage;en:SystemSpeechLanguage};
export interface ConversationPlaybook {
  recordingReplies?: RecordingManifest;
  scriptMode?: "canvas";
  conversationMode?: "goal" | "flow";
  conversationRules?: {forbiddenAnswers:string;hangupConditions:string};
  systemSpeech?: SystemSpeech;
  legacyScript?: { opening: string; flow: Array<{ id: string; title: string; instruction: string }> };
  canvas?: FlowGraph;
  publishedFlow?: FlowGraph | null;
  version: 1;
  employee?: {
    description: string;
    business: string;
    tags: string[];
  };
  livestreamSchedule?: 'daily-15-asia-shanghai';
  livestreamPrice?: 'free';
  aiInstructions?: string;
  identity: string;
  purpose: string;
  opening: string;
  baseInstructions: string;
  flow: Array<{ id: string; title: string; instruction: string }>;
  faq: Array<{ id: string; question: string; answer: string }>;
  objections: Array<{ id: string; trigger: string; response: string }>;
  handoff: {
    enabled: boolean;
    rules: string;
    response: string;
    target: string;
    assigneeUserId?: string | null;
  };
}
export interface PlaybookView {
  playbook: ConversationPlaybook;
  updatedAt: string | null;
  saved: boolean;
  placeholders: Record<string, string>;
  compiledPrompt: string;
  agentName?: string;
}
export interface PersonalAgentConfiguration {
  agentName:string;enabled:boolean;profile:import('./telephony').VoiceProfile;
  communication:import('./aliyun').CommunicationProfile;textModelId:string;maxDurationSeconds:number;record:boolean;
}
export interface PersonalPlaybookView extends PlaybookView {
  centralFaqIds?:string[];
  centralObjectionIds?:string[];
  configuration:PersonalAgentConfiguration;
  revision: number;
  baseReleaseId: string;
  source: 'personal' | 'company';
  legacyOpening?:string|null;
}
const personalScope=(org:string)=>({headers:{'x-workspace-id':org}});
export const personalPlaybookApi = {
  saveConfiguration: async (id:string,input:{configuration:PersonalAgentConfiguration;employee?:ConversationPlaybook['employee'];aiInstructions?:string;expectedRevision:number;baseReleaseId:string},org:string) => (await apiClient.put<ApiEnvelope<PersonalPlaybookView>>(`/agents/${id}/my-configuration`,input,personalScope(org))).data.data,
  get: async (id: string,org:string) => (await apiClient.get<ApiEnvelope<PersonalPlaybookView>>(`/agents/${id}/my-playbook`,personalScope(org))).data.data,
  save: async (id: string, input: {playbook:ConversationPlaybook;placeholders:Record<string,string>;expectedRevision:number;baseReleaseId:string},org:string) => (await apiClient.put<ApiEnvelope<PersonalPlaybookView>>(`/agents/${id}/my-playbook`,input,personalScope(org))).data.data,
  reset: async (id: string, input: {expectedRevision:number;baseReleaseId:string},org:string) => (await apiClient.post<ApiEnvelope<PersonalPlaybookView>>(`/agents/${id}/my-playbook/reset`,input,personalScope(org))).data.data,
  capabilities: async (id: string,org:string) => (await apiClient.get<ApiEnvelope<{analysisAvailable:boolean}>>(`/agents/${id}/my-playbook/capabilities`,personalScope(org))).data.data,
  rehearse: async (id: string, messages: Array<{role:'user'|'assistant';content:string}>, playbook:ConversationPlaybook, placeholders:Record<string,string>,org:string) => (await apiClient.post<ApiEnvelope<{answer:string;model:string}>>(`/agents/${id}/my-playbook/rehearse`,{messages,playbook,placeholders},personalScope(org))).data.data,
};
export const playbookApi = {
  access: async () => (await apiClient.get<ApiEnvelope<{canManage:boolean}>>('/agents/script-access')).data.data,
  get: async (id: string) =>
    (await apiClient.get<ApiEnvelope<PlaybookView>>(`/agents/${id}/playbook`))
      .data.data,
  save: async (
    id: string,
    input: {
      playbook: ConversationPlaybook;
      expectedUpdatedAt: string | null;
      placeholders: Record<string, string>;
    },
  ) =>
    (
      await apiClient.put<ApiEnvelope<PlaybookView>>(
        `/agents/${id}/playbook`,
        input,
      )
    ).data.data,
  preview: async (id: string, playbook: ConversationPlaybook) =>
    (
      await apiClient.post<
        ApiEnvelope<{ compiledPrompt: string; variableNames: string[] }>
      >(`/agents/${id}/playbook/preview`, playbook)
    ).data.data,
};
