/*
 * 中文导读：数字员工与话术的 scenario-model 组件，封装该界面的展示与交互。
 */
import type { ConversationPlaybook, FlowNode } from "@/src/lib/api/resources/playbook";

export type ScenarioGroup = "steps" | "faq" | "objections" | "endings";
export type ScenarioItem = {
  key: string;
  id: string;
  source: "step" | "faq" | "objection";
  group: ScenarioGroup;
  title: string;
  text: string;
  label: string;
  order: number;
  entry?: boolean;
};

export const scenarioKinds: Record<FlowNode["kind"], string> = {
  speech: "自然沟通", collect: "信息采集", text: "直接表达", ivr: "电话按键",
  jump: "自动进入下一步", end: "结束通话", handoff: "登记人工接管",
};
export const scenarioOutcomes: Record<FlowNode["outcome"], string> = {
  neutral: "未判定意向", interested: "有意向", declined: "拒绝沟通", follow_up: "需要人工联系",
};
export function responseLabel(branch: string) {
  return ({ 肯定: "肯定回应", 否定: "否定回应", 拒绝: "明确拒绝", 未识别: "没有听清", 中性: "一般回应", 全部: "表达后继续" } as Record<string, string>)[branch] || branch;
}
export function scenarioItems(p: ConversationPlaybook): ScenarioItem[] {
  const graph = p.canvas;
  const ordered: FlowNode[] = [], seen = new Set<string>();
  function visit(id: string) {
    const node = graph?.nodes.find(n => n.id === id);
    if (!node || seen.has(id) || ["end", "handoff"].includes(node.kind)) return;
    seen.add(id); ordered.push(node);
    const priority = (branch: string) => branch === "全部" ? 0 : branch === "肯定" ? 1 : 2;
    for (const edge of [...(graph?.edges.filter(e => e.source === id) || [])].sort((a, b) => priority(a.branch) - priority(b.branch))) visit(edge.target);
  }
  if (graph) { visit(graph.entry); for (const node of graph.nodes) visit(node.id); }
  const nodes = [...ordered, ...(graph?.nodes.filter(n => ["end", "handoff"].includes(n.kind)) || [])];
  return [
    ...nodes.map((n, i): ScenarioItem => ({
      key: "step:" + n.id, id: n.id, source: "step", group: ["end", "handoff"].includes(n.kind) ? "endings" : "steps",
      title: n.title, text: n.text, label: n.id === p.canvas?.entry ? "开场白" : scenarioKinds[n.kind], order: i + 1, entry: n.id === p.canvas?.entry,
    })),
    ...p.faq.map((f, i): ScenarioItem => ({ key: "faq:" + f.id, id: f.id, source: "faq", group: "faq", title: f.question, text: f.answer, label: "客户提问", order: i + 1 })),
    ...p.objections.map((o, i): ScenarioItem => ({ key: "objection:" + o.id, id: o.id, source: "objection", group: "objections", title: o.trigger, text: o.response, label: "客户异议", order: i + 1 })),
  ];
}
