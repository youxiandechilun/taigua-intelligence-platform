/*
 * 中文导读：数字员工与话术的 employee-editor-model 组件，封装该界面的展示与交互。
 */
import type { ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { draftFlowProblem, flowText, inspectFlow, scriptOpening } from "./studio/flow-model";
import type { CommunicationProfile } from "@/src/lib/api/resources/aliyun";

export const GENDERS = { neutral: "不指定性别", female: "女性角色", male: "男性角色" };
export const LANGUAGES = { "zh-CN": "中文（普通话）", "zh-HK": "中文（粤语）", en: "英语", auto: "跟随客户语言" };
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const rowId = () => crypto.randomUUID();

export function profileText(p: CommunicationProfile) {
  const days: Record<string, string> = { MONDAY: "周一", TUESDAY: "周二", WEDNESDAY: "周三", THURSDAY: "周四", FRIDAY: "周五", SATURDAY: "周六", SUNDAY: "周日" };
  const d = p.dialPolicyOverride;
  return `角色：${GENDERS[p.gender]}\n回答语言：${LANGUAGES[p.language]}\n期望音色：${p.voiceName || p.voiceCode || "跟随云端音色"}\n拨打规则：${d ? `${d.start}–${d.end}\n星期：${d.days.map(v => days[v] || v).join("、")}\n重拨：${d.retries} 次 / 间隔 ${d.retryIntervalMinutes} 分钟\n节假日：${d.holidayRestricted ? "限制拨打" : "不单独限制"}` : "使用工作区默认"}`;
}

export function employeeText(p: ConversationPlaybook) {
  return p.employee ? `简介：${p.employee.description}\n业务定位：${p.employee.business || "未填写"}\n员工标签：${p.employee.tags.join("、") || "无"}` : "尚未自定义基本资料";
}

export function handoffText(p: ConversationPlaybook) {
  return `${p.handoff.enabled ? "已启用" : "未启用"}\n触发规则：${p.handoff.rules}\n告知话术：${p.handoff.response}\n接管目标：${p.handoff.assigneeUserId ? p.handoff.target || "已指定员工" : "跟随客户负责人或任务发起人"}`;
}

export function completeness(p: ConversationPlaybook) {
  return [
    { label: "开场白", ok: !!(p.identity.trim() && p.purpose.trim() && scriptOpening(p).trim().length >= 5) },
    { label: "沟通流程", ok: p.scriptMode === "canvas" && p.canvas ? !inspectFlow(p.canvas).some(i => i.severity === "error") : p.flow.every(r => r.title.trim() && r.instruction.trim()) },
    { label: "常见问答", ok: p.faq.every(r => r.question.trim() && r.answer.trim()) },
    { label: "异议处理", ok: p.objections.every(r => r.trigger.trim() && r.response.trim()) },
    { label: "人工接管", ok: p.handoff.enabled && !!(p.handoff.rules.trim() && p.handoff.response.trim()) },
  ];
}

export function validateDraft(p: ConversationPlaybook, v: CommunicationProfile): string | null {
  if (!p.identity.trim() || !p.purpose.trim()) return "请在全局规则中填写业务身份和通话目标。";
  if (p.scriptMode === "canvas") {
    if (!p.canvas) return "话术设计缺少步骤数据，请重新读取内容。";
    const problem = draftFlowProblem(p.canvas);
    if (problem) return problem;
  } else {
    if (p.opening.trim().length < 5) return "请填写至少 5 个字的开场白。";
    if (p.flow.some(r => !r.title.trim() || !r.instruction.trim())) return "请补齐沟通流程的步骤名称和话术，或删除空步骤。";
  }
  if (p.faq.some(r => !r.question.trim() || !r.answer.trim()))
    return "请补齐常见问答，或删除空条目。";
  if (p.objections.some(r => !r.trigger.trim() || !r.response.trim()))
    return "请补齐异议处理，或删除空条目。";
  if (p.handoff.enabled && (!p.handoff.rules.trim() || !p.handoff.response.trim()))
    return "启用人工接管后，请填写触发规则和告知话术。";
  const d = v.dialPolicyOverride;
  if (d) {
    if (!d.start || !d.end || d.start >= d.end) return "拨打开始时间必须早于结束时间。";
    if (!d.days.length) return "请至少选择一个拨打星期。";
    if (!Number.isInteger(d.retries) || d.retries < 0 || d.retries > 3) return "重拨次数为 0 至 3 次。";
    if (!Number.isInteger(d.retryIntervalMinutes) || d.retryIntervalMinutes < 1 || d.retryIntervalMinutes > 720)
      return "重拨间隔为 1 至 720 分钟。";
  }
  return null;
}

// Local content checks are guidance, not an Aliyun approval or a legal verdict.
export function reviewDraft(p: ConversationPlaybook) {
  const opening = scriptOpening(p);
  const text = [p.identity, p.purpose, opening, (p.aiInstructions ?? p.baseInstructions),
    ...(p.scriptMode === "canvas" && p.canvas ? [flowText(p.canvas)] : p.flow.map(r => r.instruction)), ...p.faq.map(r => r.answer),
    ...p.objections.map(r => r.response), p.handoff.rules, p.handoff.response].join("\n");
  const risky = text.match(/稳赚不赔|保证收益|百分之百成交|保证成交|绝对有效|不买就|必须购买|威胁|辱骂/g);
  return [
    { ok: !!p.identity.trim(), label: "清楚介绍公司与业务身份", detail: "日常用公司和业务身份自然介绍，客户直接追问是否人工或自动化时如实回答。" },
    { ok: /方便|沟通时间|另约|预约/.test(opening), label: "先确认沟通是否方便", detail: "建议询问客户是否方便，不方便时礼貌结束或另约时间。" },
    { ok: /拒绝|不再联系|别再联系|拒呼/.test(text) && /结束|停止|不再|拒呼/.test(text), label: "明确拒绝后的结束规则", detail: "建议补充拒绝联系后的结束话术和拒呼记录要求。" },
    { ok: p.handoff.enabled && /人工|投诉|无法回答|不能回答|不确定/.test(p.handoff.rules), label: "复杂问题与投诉交给人工", detail: "建议启用人工接管，并补充投诉及无法回答场景。" },
    { ok: !risky, label: "夸大承诺与强制联系用语", detail: risky ? `发现需人工复核的用语：${[...new Set(risky)].join("、")}。请结合上下文检查。` : "基础规则未发现上述用语，仍需人工复核价格、合同和行业要求。" },
  ];
}

export function scriptText(name: string, p: ConversationPlaybook, profile: CommunicationProfile, values: Record<string, string>) {
  return [
    `${name} · 网页话术草稿`, "导出包含当前编辑内容，尚未保存的修改也会包含。实际电话使用已发布话术。",
    `【身份】\n${p.identity}`, `【联系目的】\n${p.purpose}`, `【开场白与沟通流程】\n${p.scriptMode === "canvas" && p.canvas ? flowText(p.canvas) : `${p.opening}\n\n${p.flow.map((r, i) => `${i + 1}. ${r.title}\n${r.instruction}`).join("\n\n")}`}`,
    `【常见问答】\n${p.faq.map(r => `问：${r.question}\n答：${r.answer}`).join("\n\n")}`,
    `【异议处理】\n${p.objections.map(r => `情况：${r.trigger}\n回应：${r.response}`).join("\n\n")}`,
    `【人工接管】\n${p.handoff.enabled ? "已启用" : "未启用"}\n规则：${p.handoff.rules}\n告知：${p.handoff.response}\n目标：${p.handoff.assigneeUserId ? p.handoff.target || "已指定员工" : "跟随客户负责人或任务发起人"}`,
    `【补充约束】\n${(p.aiInstructions ?? p.baseInstructions)}`,
    `【声音与拨打规则】\n${profileText(profile)}`,
    `【演练变量】\n${Object.entries(values).map(([k, v]) => `${k}：${v}`).join("\n") || "无"}`,
  ].join("\n\n");
}

export function download(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["\ufeff" + content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
