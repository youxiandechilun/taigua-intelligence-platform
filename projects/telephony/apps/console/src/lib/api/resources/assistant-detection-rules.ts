/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "../client";

export type AssistantDetectionMatchMode = "semantic" | "keyword";

export interface AssistantDetectionRule {
  id: string;
  name: string;
  keywords: string[];
  negativeKeywords: string[];
  enabled: boolean;
  matchMode?: AssistantDetectionMatchMode;
}

export interface AssistantDetectionCatalog {
  rules: AssistantDetectionRule[]; revision: string;
  canWrite: boolean;
}

export interface AssistantDetectionTestResult {
  matched: boolean;
  rule?: { id: string; name: string; keyword?: string } | null;
  rules?: Array<{ id: string; name: string; keyword?: string }>;
  evidence?: string | string[] | null;
  diagnostics?: Array<{
    id: string;
    name: string;
    matchMode: AssistantDetectionMatchMode;
    status: "matched" | "semantic_not_confirmed" | "excluded" | "disabled" | "no_keyword";
    keyword?: string;
    negativeKeyword?: string;
  }>;
}

const options = (organizationId: string) => ({ headers: { "x-workspace-id": organizationId } });
const base = "/telephony/assistant-detection-rules";

export const assistantDetectionRulesApi = {
  list: (organizationId: string) =>
    unwrap<AssistantDetectionCatalog>(apiClient.get(base, options(organizationId))),
  save: (organizationId: string, rules: AssistantDetectionRule[], expectedRevision: string) =>
    unwrap<AssistantDetectionCatalog>(apiClient.put(base, { rules, expectedRevision }, options(organizationId))),
  test: (organizationId: string, text: string) =>
    unwrap<AssistantDetectionTestResult>(apiClient.post(`${base}/test`, { text }, options(organizationId))),
};
