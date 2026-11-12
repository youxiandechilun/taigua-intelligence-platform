/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "../client";

export interface OpeningInterruptionRules {
  lockOpening: boolean;
  acknowledgementKeywords: string[];
  interruptKeywords: string[];
}
export interface OpeningRulesCatalog { rules: OpeningInterruptionRules; revision: string; canWrite: boolean }
export interface OpeningSpeechResult {
  substantive: boolean;
  reason: string;
  keyword: string | null;
  lockOpening: boolean;
  action: "continue_opening" | "answer_after_opening" | "interrupt_and_answer";
}
const options = (organizationId: string) => ({ headers: { "x-workspace-id": organizationId } });
const base = "/telephony/opening-interruption-rules";
export const openingRulesApi = {
  list: (organizationId: string) => unwrap<OpeningRulesCatalog>(apiClient.get(base, options(organizationId))),
  save: (organizationId: string, rules: OpeningInterruptionRules, expectedRevision: string) => unwrap<OpeningRulesCatalog>(apiClient.put(base, { rules, expectedRevision }, options(organizationId))),
  test: (organizationId: string, text: string) => unwrap<OpeningSpeechResult>(apiClient.post(`${base}/test`, { text }, options(organizationId))),
};
