/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "../client";

export type IntentCategory = "interested" | "unclear" | "uninterested" | "optout";
export type IntentMatchMode = "any" | "all" | "phrase";
export type IntentRuleApplyTo = "outbound" | "demo" | "manual" | "assistant";

export interface IntentRecognitionRule {
  id: string;
  name: string;
  intent: IntentCategory;
  positiveKeywords: string[];
  negativeKeywords: string[];
  matchMode: IntentMatchMode;
  priority: number;
  enabled: boolean;
  applyTo: IntentRuleApplyTo[];
  replyHint?: string | null;
  action?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type IntentRuleInput = Omit<IntentRecognitionRule, "id" | "createdAt" | "updatedAt"> & { id?: string };

export interface IntentRuleTestResult {
  text: string;
  matched: boolean;
  intent: IntentCategory | null;
  rules: Array<Pick<IntentRecognitionRule, "id" | "name" | "intent" | "priority"> & { evidence?: string }>;
  evidence?: string[];
}

const options = (organizationId: string) => ({ headers: { "x-workspace-id": organizationId } });
const base = "/telephony/intent-rules";

export const intentRulesApi = {
  list: (organizationId: string) =>
    unwrap<IntentRecognitionRule[]>(apiClient.get(base, options(organizationId))),
  save: (organizationId: string, input: IntentRuleInput) => {
    const body = {
      name: input.name,
      intent: input.intent,
      positiveKeywords: input.positiveKeywords,
      negativeKeywords: input.negativeKeywords,
      matchMode: input.matchMode,
      priority: input.priority,
      enabled: input.enabled,
      applyTo: input.applyTo,
      replyHint: input.replyHint,
      action: input.action,
    };
    return unwrap<IntentRecognitionRule>(
      input.id
        ? apiClient.put(`${base}/${encodeURIComponent(input.id)}`, body, options(organizationId))
        : apiClient.post(base, body, options(organizationId)),
    );
  },
  remove: (organizationId: string, id: string) =>
    unwrap<void>(apiClient.delete(`${base}/${encodeURIComponent(id)}`, options(organizationId))),
  test: (organizationId: string, text: string) =>
    unwrap<IntentRuleTestResult>(apiClient.post(`${base}/test`, { text }, options(organizationId))),
};
