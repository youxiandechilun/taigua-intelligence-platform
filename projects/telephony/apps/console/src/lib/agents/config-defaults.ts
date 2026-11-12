/*
 * 中文导读：数字员工与话术：config-defaults.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { ConfigureAgentInput } from "@/src/lib/api/resources/agents";
import type { AgentConfiguration } from "@/src/lib/api/types";
import { normalizeAgentVariables } from "@/src/lib/agents/dynamic-variables";

export const DEFAULT_SYSTEM_PROMPT = `你是一位乐于助人的语音助手。请简洁、礼貌地回答，围绕客户的问题交流。执行任何操作前，先向客户复述并确认重要信息。`;
export const DEFAULT_FIRST_MESSAGE = `您好，感谢来电。请问有什么可以帮您？`;

export function defaultConfig(): ConfigureAgentInput {
  return {
    agent_language: "zh",
    firstMessage: DEFAULT_FIRST_MESSAGE,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    llmModel: "qwen-plus",
    sttModel: "aliyun/managed",
    ttsModel: "aliyun/managed",
    use_rag: false,
    voiceId: "aliyun/managed",
    data_needed: [],
    data_evaluation: [],
    initiation_webhook: null,
    post_call_webhook: null,
    preemptive_generation: false,
    ivr_navigation_enabled: true,
    timezone: "Asia/Shanghai",
    variables: {
      firstMessage: [],
      systemPrompt: [],
      placeholders: {},
    },
    store_call_audio: true,
    zero_pii_retention: false,
    conversation_retention_days: 30,
  };
}

// Build a full ConfigureAgentInput by layering patch over current (or defaults).
export function mergeConfig(
  current: AgentConfiguration | null | undefined,
  patch: Partial<ConfigureAgentInput>,
): ConfigureAgentInput {
  const base = defaultConfig();
  const fromCurrent: Partial<ConfigureAgentInput> = current
    ? {
        agent_language: current.agent_language,
        firstMessage: current.firstMessage,
        systemPrompt: current.systemPrompt,
        llmModel: current.llmModel,
        sttModel: current.sttModel ?? "aliyun/managed",
        ttsModel: current.ttsModel ?? "aliyun/managed",
        use_rag: current.use_rag,
        voiceId: current.voiceId,
        data_needed:
          (current.data_needed as ConfigureAgentInput["data_needed"]) ?? [],
        data_evaluation:
          (current.data_evaluation as ConfigureAgentInput["data_evaluation"]) ??
          [],
        initiation_webhook:
          current.initiation_webhook as ConfigureAgentInput["initiation_webhook"],
        post_call_webhook:
          current.post_call_webhook as ConfigureAgentInput["post_call_webhook"],
        preemptive_generation: current.preemptive_generation,
        ivr_navigation_enabled: current.ivr_navigation_enabled ?? true,
        timezone: current.timezone,
        variables: normalizeAgentVariables(current.variables),
        store_call_audio: current.store_call_audio,
        zero_pii_retention: current.zero_pii_retention,
        conversation_retention_days: current.conversation_retention_days,
      }
    : {};
  return { ...base, ...fromCurrent, ...patch };
}
