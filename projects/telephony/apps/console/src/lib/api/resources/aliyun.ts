/*
 * 中文导读：阿里云连接的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "@/src/lib/api/client";
import { downloadOutboundTemplate } from '@/src/lib/outbound/import-template';
export type DialPolicy = { timeRestricted?: boolean; start: string; end: string; days: string[]; retries: number; retryIntervalMinutes: number; holidayRestricted: boolean };
export type CommunicationProfile = { gender: "neutral" | "female" | "male"; language: "zh-CN" | "zh-HK" | "en" | "auto"; voiceCode: string; voiceName: string; dialPolicyOverride: DialPolicy | null };
export type AgentProfile = { profile: CommunicationProfile; updatedAt: string | null; saved: boolean };
export type CloudCatalog = { kind: string; checkedAt: string; page: number; total: number; hasMore: boolean; entries: { id: string; name: string; description?: string; published?: boolean; branchId?: string; versionId?: string; type?: string; engine?: string; sampleUrl?: string }[] };
export type AliyunConfig = {
  dialPolicy: DialPolicy;
  seatInstanceId: string;
  product: "outboundbot" | "aiccs";
  communicationAgentId: string;
  branchId: string;
  versionId: string;
  approvedKnowledge: string;
  concurrency: number;
  callbackReady: boolean;
  communicationBindings: Record<
    string,
    { agentId: string; branchId?: string; versionId?: string }
  >;
  backend: string;
  regionId: string;
  instanceId: string;
  defaultScriptId: string;
  callerNumbers: string[];
  bindings: Record<string, string>;
  model: string;
  liveEnabled: boolean;
  endpoint: string;
  apiVersion: string;
  transport: string;
  dashscopeEndpoint: string;
  hasAccessKey: boolean;
  hasDashscopeKey: boolean;
  ready: boolean;
  missing: string[];
};
export type AliyunConfigInput = Pick<
  AliyunConfig,
  | "product"
  | "communicationAgentId"
  | "branchId"
  | "versionId"
  | "approvedKnowledge"
  | "concurrency"
  | "regionId"
  | "instanceId"
  | "defaultScriptId"
  | "callerNumbers"
  | "model"
  | "liveEnabled"
  | "dialPolicy"
  | "seatInstanceId"
> & {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  dashscopeApiKey?: string;
};
export type Recipient = {
  crmCompanyId?: string;
  crmContactId?: string|null;
  phoneNumber: string;
  name: string;
  variables: Record<string, string>;
};
export type AliyunTask = {
  executionPolicy?: DialPolicy & { concurrency: number };
  provider: string;
  cloudAgentId?: string;
  cloudBranchId?: string;
  cloudVersionId?: string;
  id: string;
  name: string;
  agentId: string;
  callerNumber: string;
  scriptId: string;
  remoteId: string | null;
  status: string;
  recipients: Recipient[];
  startTime: string;
  endTime: string;
  errorMessage: string | null;
  syncedAt: string | null;
  results: {
    phoneNumber: string;
    state: string;
    status: string;
    sessionId?: string;
    talkTime?: number;
    disposition?: string;
  }[];
};
export type CallDetail = {
  phoneNumber: string;
  duration?: number;
  disposition?: string;
  transferTarget?: string;
  transcripts: { speaker: string; text: string }[];
  labels: { name?: string; value?: string }[];
  recordingUrl?: string;
  recordingUnavailable: boolean;
};
export type CloudResources = {
  instance: { id: string; name?: string; concurrency?: number };
  scripts: { id: string; name?: string; status?: string }[];
  total: number;
  published?: boolean;
  branchId?: string;
  versionId?: string;
};
export type AgentCloud = {
  agentId: string;
  name: string;
  published: boolean;
  matchesBinding: boolean;
  checkedAt: string;
  branchId: string;
  versionId: string;
  prologue: string;
  voice: string;
  sessionTimeout: number | null;
  muteDuration: number | null;
  muteHangupNum: number | null;
  transferEnabled: boolean | null;
  ragEnabled: boolean | null;
};
export type AgentStatus = {
  product: "aiccs" | "outboundbot";
  binding: { agentId: string; branchId?: string; versionId?: string };
  bindingSource: "independent" | "workspace";
  canManage: boolean;
  sharedBindingCount: number;
  knowledgeCount: number;
  callsCount: number;
  completed: number;
  callerCount: number;
  concurrency: number;
  callbackReady: boolean;
  hasAccessKey: boolean;
  hasDashscopeKey: boolean;
  liveEnabled: boolean;
  regionId: string;
  model: string;
  missing: string[];
  summaryEnabled: boolean;
  recent: {
    id: string;
    phone: string | null;
    status: string;
    duration: number;
    time: string | null;
    hasRecording: boolean;
    hasTranscript: boolean;
    summary: string;
    summaryError: string | null;
  }[];
};
const workspaceHeaders = (org: string) => ({
  headers: { "x-workspace-id": org },
});
export const aliyunApi = {
  catalog: (kind: "agents" | "voices" | "instances" | "seat-numbers", org: string, input: { page?: number; pageSize?: number; keyword?: string } = {}) => unwrap<CloudCatalog>(apiClient.post(`/aliyun/catalog/${kind}`, input, workspaceHeaders(org))),
  profile: (id: string, org: string) => unwrap<AgentProfile>(apiClient.get(`/aliyun/agents/${id}/voice-profile`, workspaceHeaders(org))),
  saveProfile: (id: string, org: string, input: { profile: CommunicationProfile; expectedUpdatedAt: string | null }) => unwrap<AgentProfile>(apiClient.put(`/aliyun/agents/${id}/voice-profile`, input, workspaceHeaders(org))),
  agentResults: (id: string, org: string) =>
    unwrap<AgentStatus>(
      apiClient.get(`/aliyun/agents/${id}/results`, workspaceHeaders(org)),
    ),
  configFor: (org: string) =>
    unwrap<AliyunConfig>(
      apiClient.get("/aliyun/connection", workspaceHeaders(org)),
    ),
  tasksFor: (org: string) =>
    unwrap<AliyunTask[]>(apiClient.get("/aliyun/tasks", workspaceHeaders(org))),
  agentStatus: (id: string, org: string) =>
    unwrap<AgentStatus>(
      apiClient.get(`/aliyun/agents/${id}/status`, workspaceHeaders(org)),
    ),
  agentCloud: (id: string, org: string) =>
    unwrap<AgentCloud>(
      apiClient.post(`/aliyun/agents/${id}/cloud`, {}, workspaceHeaders(org)),
    ),
  scriptExport: (id: string, org: string) =>
    unwrap<{ name: string; content: string }>(
      apiClient.get(
        `/aliyun/agents/${id}/script-export`,
        workspaceHeaders(org),
      ),
    ),
  config: () => unwrap<AliyunConfig>(apiClient.get("/aliyun/connection")),
  save: (input: AliyunConfigInput, org: string = "") =>
    unwrap<AliyunConfig>(apiClient.put("/aliyun/connection", input, workspaceHeaders(org))),
  resources: (org: string = "") => unwrap<CloudResources>(apiClient.post("/aliyun/resources", {}, workspaceHeaders(org))),
  bind: (agentId: string, scriptId: string, org: string = "") =>
    unwrap<AliyunConfig>(
      apiClient.put(
        `/aliyun/agents/${agentId}/binding`,
        { scriptId },
        workspaceHeaders(org),
      ),
    ),
  bindCommunication: (
    agentId: string,
    binding: { agentId: string; branchId?: string; versionId?: string },
    org: string = "",
  ) =>
    unwrap<AliyunConfig>(
      apiClient.put(
        `/aliyun/agents/${agentId}/communication-binding`,
        binding,
        workspaceHeaders(org),
      ),
    ),
  rehearse: (
    agentId: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ) =>
    unwrap<{ answer: string; model: string }>(
      apiClient.post("/aliyun/rehearse", { agentId, messages }),
    ),
  importFile: (fileName: string, content: string,org: string="") =>
    unwrap<{
      recipients: Recipient[];
      invalidRows: { rowNumber: number; phoneNumber: string; error: string }[];
      duplicates: number;
    }>(apiClient.post("/aliyun/import", { fileName, content },workspaceHeaders(org))),
  downloadImportTemplate: async (_org: string) => { downloadOutboundTemplate(); },
  tasks: () => unwrap<AliyunTask[]>(apiClient.get("/aliyun/tasks")),
  create: (input: {
    name: string;
    agentId: string;
    callerNumber: string;
    recipients: Recipient[];
    startTime: string;
    endTime: string;
  },org: string="") => unwrap<AliyunTask>(apiClient.post("/aliyun/tasks", input,workspaceHeaders(org))),
  action: (
    id: string,
    action: "publish" | "start" | "stop" | "sync" | "reconcile",
    input?: { confirmation?: string; remoteId?: string },
  ) =>
    unwrap<AliyunTask>(
      apiClient.post(`/aliyun/tasks/${id}/${action}`, input ?? {}),
    ),
  detail: (id: string, sessionId: string) =>
    unwrap<CallDetail>(
      apiClient.get(
        `/aliyun/tasks/${id}/calls/${encodeURIComponent(sessionId)}`,
      ),
    ),
};
