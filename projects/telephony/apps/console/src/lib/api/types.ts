/*
 * 中文导读：共享基础能力：types.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Hand-written mirrors of the server's Prisma types.
// Kept intentionally minimal — extend as UI needs more fields.
// The server's Prisma `generated` dir is excluded from the console tsconfig,
// so we don't import from it.

export type TelephonyProvider = "TWILIO" | "TELNYX";
export type PhoneNumberBillingStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "RELEASE_PENDING"
  | "RELEASING"
  | "RELEASED";

export type CallStatus =
  | "NOT_ANSWERED"
  | "SCHEDULED"
  | "PROCESSED"
  | "IN_PROGRESS"
  | "NEEDS_REVIEW"
  | "COMPLETED"
  | "FAILED";

export type KbStatus = "PROCESSING" | "ACTIVE" | "ERROR";
export type KbSourceType =
  | "PDF"
  | "TXT"
  | "CSV"
  | "DOCX"
  | "XLSX"
  | "XLS"
  | "URL";

export interface Agent {
  personal?: {name?:string;enabled?:boolean;description?:string;tags?:string[]};
  release?: import("./resources/agent-releases").AgentRelease;
  studioSummary?: {
    description: string;
    tags: string[];
    configuredSections: Array<{ label: string; configured: boolean }>;
    structuredSaved: boolean;
  };
  avatar?: string | null;
  agentId: string;
  agentSlug: string;
  organizationId: string;
  userId: string | null;
  name: string;
  templateId: string | null;
  isActive: boolean;
  isConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  callLogsCount: number;
  phoneNumbersCount: number;
  knowledgeSourcesCount: number;
  toolsCount: number;
  estimatedPricePerMinuteMicros?: number | string | null;
}

export interface AgentConfiguration {
  conversationPlaybook?:
    | import("./resources/playbook").ConversationPlaybook
    | null;
  agentConfigId: string;
  agentId: string;
  systemPrompt: string;
  firstMessage: string;
  temperature: number;
  data_needed: unknown;
  data_evaluation: unknown;
  voiceId: string;
  concurrent_calls_limit: number;
  conversation_retention_days: number;
  daily_calls_limit: number;
  enable_auth_for_agent_api: boolean;
  max_conversation_duration_seconds: number;
  optimize_streaming_latency: boolean;
  silence_end_call_timeout_seconds: number;
  store_call_audio: boolean;
  tokenLimit: number;
  tts_output_format: string;
  turn_timeout_seconds: number;
  use_flash_call: boolean;
  use_rag: boolean;
  user_input_audio_format: string;
  voice_similarity_boost: number;
  voice_speed: number;
  voice_stability: number;
  zero_pii_retention: boolean;
  llmModel: string;
  sttModel: string;
  ttsModel: string;
  agent_language: string;
  initiation_webhook: WebhookConfig | null;
  post_call_webhook: WebhookConfig | null;
  variables: Record<string, unknown> | null;
  preemptive_generation: boolean;
  ivr_navigation_enabled: boolean;
  timezone: string;
  estimatedPricePerMinuteMicros?: number | string | null;
}

export interface VoiceCatalog {
  version: string;
  defaults: Record<string, unknown>;
  languages: Array<{ id: string; label: string; locale?: string }>;
  timezones: string[];
  stt_models: Array<{
    provider: string;
    id: string;
    label: string;
    languages?: string[];
  }>;
  llm_models: Array<{
    provider: string;
    id: string;
    label: string;
  }>;
  tts_models: Array<{
    provider: string;
    id: string;
    label: string;
    languages?: string[];
  }>;
  voices: Array<{
    provider: string;
    id: string;
    label: string;
    languages?: string[];
    tts_models?: string[];
  }>;
}

export interface AgentPreviewSession {
  livekitUrl: string;
  roomName: string;
  participant: {
    identity: string;
    name: string;
    token: string;
    ttlSeconds: number;
  };
  agent: {
    name: string;
    dispatchId: string;
  };
  expiresAt: string;
}

export type AgentWidgetPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";
export type AgentWidgetLauncherSize = "compact" | "comfortable" | "large";

export interface AgentWidgetTheme {
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  buttonTextColor: string;
  borderColor: string;
  position: AgentWidgetPosition;
  launcherSize: AgentWidgetLauncherSize;
  panelWidth: number;
  borderRadius: number;
  defaultOpen: boolean;
  showAvatar: boolean;
  avatarImageUrl: string | null;
  avatarOrbColor1: string;
  avatarOrbColor2: string;
  brandName: string;
  actionText: string;
  welcomeText: string;
  startButtonText: string;
  endButtonText: string;
  connectingText: string;
  listeningText: string;
  speakingText: string;
  endedText: string;
  whiteLabel: boolean;
}

export interface AgentWidget {
  widgetId: string;
  organizationId: string;
  agentId: string;
  name: string;
  enabled: boolean;
  allowedOrigins: string[];
  theme: AgentWidgetTheme;
  consentRequired: boolean;
  consentText: string;
  createdAt: string;
  updatedAt: string;
  agent: {
    agentId: string;
    name: string;
    isConfigured: boolean;
  };
  embed: {
    scriptUrl: string;
    snippet: string;
  };
}

export interface WebhookConfig {
  webhook_url: string;
  method?: "GET" | "POST";
  headers?: Record<
    string,
    { value: string | null; type: "Value" | "Secret"; redacted?: boolean }
  >;
  body?: Record<
    string,
    { value: string | null; type: "Value" | "Secret"; redacted?: boolean }
  >;
  dynamic_variables?: Record<string, string>;
  transcript?: boolean;
  audio_url?: boolean;
}

export interface PhoneNumber {
  phId: string;
  number: string;
  organizationId: string;
  userId: string | null;
  agentId: string | null;
  sid: string;
  friendlyName: string;
  provider: TelephonyProvider;
  createdAt: string;
  updatedAt: string;
  billingStatus: PhoneNumberBillingStatus;
  rentalPriceMicros: number | string | null;
  nextBillingAt: string | null;
  scheduledReleaseAt: string | null;
  monthlyPriceMicros?: number | string | null;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  isoCountry: string;
  providerMonthlyCostMicros: number | string;
  monthlyPriceMicros: number | string;
  quoteId: string;
  quoteExpiresAt: string;
  rateCatalogVersion: string;
}

export interface CallCostItem { name:string; model:string; purpose:string; requests:number; amountCny:number|null; knownCny:number; reason:string|null; priceVersion:string|null; source:string|null }
export interface CallCost { currency:'CNY'; status:'ESTIMATED'|'PENDING'; lineName:string; provider:string; billableMinutes:number|null; tariffCny:number|null; phoneCny:number|null; aiCny:number|null; totalCny:number|null; knownCny:number; knownAiCny:number; reasons:string[]; items:CallCostItem[] }
export interface CostTotals {calls:number;billableMinutes:number;phoneCny:number|null;aiCny:number|null;totalCny:number|null;knownPhoneCny:number;knownAiCny:number;knownCny:number;pendingPhoneCalls:number;pendingAiCalls:number;pendingCalls:number}
export interface CallLog {
  cost?: CallCost;
  callId: string;
  readAt?: string | null;
  organizationId: string;
  agentId: string | null;
  userId: string | null;
  ownerId?: string | null;
  ownerName?: string;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  status: CallStatus;
  rawStatus?: Exclude<CallStatus, "NEEDS_REVIEW">;
  statusLabel?: string;
  requiresReview?: boolean;
  audioRecordingPath: string | null;
  callerId: string | null;
  metadata: Record<string, unknown> | null;
  sessionId: string | null;
  direction: string | null;
  dataExtracted: unknown;
  dataEvaluation: unknown;
  analysis?: { status: string; enabled: boolean; canGenerate: boolean; evaluatedBy: 'AI' | 'LEGACY' | 'TRANSCRIPT' | 'NONE'; updatedAt: string | null };
  callCostCents: number | null;
  deleted: boolean;
  matchedIntent?: "interested" | "unclear" | "uninterested" | "optout" | null;
  provisionalIntent?: "interested" | "unclear" | "uninterested" | "optout" | null;
  matchedRules?: Array<{ id: string; name: string; intent?: string; priority?: number }>;
  matchedEvidence?: string[];
}

export interface CallTranscript {
  callTransId: string;
  callLogId: string;
  speaker: string;
  messageText: string;
  timestamp: string;
  confidenceScore: number | null;
  isPiiRedacted: boolean;
  sentimentScore: number | null;
}

export interface KnowledgeSource {
  kbId: string;
  organizationId: string;
  agentId: string | null;
  userId: string | null;
  name: string;
  originalFileName: string | null;
  storagePath: string;
  sourceType: KbSourceType;
  status: KbStatus;
  errorCode: string | null;
  errorMessage: string | null;
  errorRetryable: boolean | null;
  metadata: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  uploadedAt: string;
}

export interface KVPair {
  key: string;
  value: string | null;
  type?: "Value" | "Secret";
  redacted?: boolean;
}

export interface ToolParam {
  name: string;
  type: "String" | "Number" | "Boolean";
  valueType: "LLM Prompt" | "Static Value" | "Dynamic Variable";
  value?: string | number | boolean | null;
  description: string;
  allowedValues: string[];
  required: boolean;
}

export interface Tool {
  toolId: string;
  organizationId: string;
  name: string;
  description: string;
  api_url: string;
  api_method: string;
  api_headers: KVPair[] | null;
  api_body: ToolParam[] | null;
  api_query_params: ToolParam[] | null;
  api_path_params: ToolParam[] | null;
  response_timeout_secs: number | null;
  dynamic_variables: KVPair[] | null;
  disable_interruptions: boolean;
  force_pre_tool_speech: boolean;
  createdAt: string;
  updatedAt: string;
  agent: { agentId: string; name: string }[];
}

export interface Secret {
  secretId: string;
  organizationId: string;
  userId: string | null;
  name: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export type McpConnectionStatus =
  | "PENDING"
  | "CONNECTED"
  | "AUTH_REQUIRED"
  | "INPUT_REQUIRED"
  | "ERROR"
  | "DISCONNECTED";

export interface McpCatalogItem {
  slug: string;
  name: string;
  description: string;
  provider: string;
  source: "SMITHERY" | "CUSTOM";
  mcpUrl: string;
  smitheryServerKey?: string | null;
  authType: string;
  categories: string[];
  verified: boolean;
  toolCount: number;
  connected?: boolean;
  mcpConnectionId?: string | null;
  connectionStatus?: McpConnectionStatus | null;
  setupUrl?: string | null;
  iconUrl?: string | null;
  homepage?: string | null;
  qualifiedName?: string | null;
  namespace?: string | null;
  useCount?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface PagePagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface McpCatalogPage {
  items: McpCatalogItem[];
  pagination: PagePagination;
}

export interface McpToolDescriptor {
  /** Derived by the server from its autonomous execution policy. */
  requiresConfirmation?: boolean;
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
}

export interface McpConnection {
  mcpConnectionId: string;
  organizationId: string;
  userId: string | null;
  catalogItemId: string | null;
  displayName: string;
  provider: string;
  mcpUrl: string;
  smitheryNamespace: string;
  smitheryConnectionId: string;
  status: McpConnectionStatus;
  setupUrl: string | null;
  tools: McpToolDescriptor[] | null;
  metadata: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agents?: { agentId: string; name: string }[];
}

export interface AgentMcpConnection {
  agentMcpConnectionId: string;
  organizationId: string;
  agentId: string;
  mcpConnectionId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  mcpConnection: McpConnection;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  nextCursor?: string | null;
}
