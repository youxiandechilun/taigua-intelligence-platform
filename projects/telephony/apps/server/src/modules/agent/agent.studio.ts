/*
 * 中文导读：数字员工与话术：agent.studio.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { playbookSchema } from "./agent.playbook.js";
import { listAgentTemplates } from "./agent.templates.js";

const templates = listAgentTemplates();
const scenarioTags: Record<string, string[]> = {
  "appointment-invite": ["商务邀约", "需求识别"],
  "customer-development": ["企业拓客", "业务了解"],
  "customer-reactivation": ["意向跟进", "客户维护"],
  "after-sales": ["售后服务", "问题收集"],
  "satisfaction": ["客户回访", "满意度"],
  "support": ["客户接待", "人工协作"],
};

export function studioSummary(templateId: string | null, configuration: {
  conversationPlaybook: unknown;
  firstMessage: string;
} | null) {
  const template = templates.find(item => item.id === templateId);
  const parsed = playbookSchema.safeParse(configuration?.conversationPlaybook);
  // Inspect persisted content only; getPlaybook's generated defaults are not saved work.
  const playbook = parsed.success ? parsed.data : null;
  const configuredSections = [
    { label: "开场白", configured: !!(playbook?.opening || configuration?.firstMessage)?.trim() },
    { label: "通话目标", configured: !!playbook?.purpose.trim() },
    { label: "参考问答", configured: !!playbook?.faq.some(row => row.question.trim() && row.answer.trim()) },
    { label: "异议处理", configured: !!playbook?.objections.some(row => row.trigger.trim() && row.response.trim()) },
    { label: "人工接管", configured: !!(playbook?.handoff.rules.trim() && playbook.handoff.response.trim()) },
  ];
  return {
    description: playbook?.employee?.description || playbook?.purpose || template?.description || "配置业务目标与沟通流程，为客户提供对应的业务沟通。",
    tags: playbook?.employee?.tags ?? (template && template.id !== "blank"
      ? scenarioTags[template.id] || [...new Set([template.category, template.title.replace(/助手$/, "")])]
      : ["自定义场景", "话术沟通"]),
    configuredSections,
    structuredSaved: !!playbook,
  };
}
