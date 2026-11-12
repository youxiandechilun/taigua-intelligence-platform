/*
 * 中文导读：统一话术的结构、整理与校验，包含开场、问答、异议和流程配置。
 */
import { recordingRepliesSchema, hasOpeningRecording } from "./script-recording-schema.js";
import { z } from "zod";
import { flowGraphSchema, flowProblems, compileFlow } from "./agent.flow.js";
import { naturalTelephoneRulesSection } from './agent.conversation.js';
import { appendGeneratedInstructions } from './generated-instructions.js';
const text = (max: number) => z.string().trim().max(max);
const rowId = z.string().min(1).max(100);
const stepSchema = z.object({ id: rowId, title: text(100), instruction: text(4000) }).strict();
const speechText = z.string().trim().min(1, '场景话术不能为空').max(500)
  .refine(value => value.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim().length > 0, '场景话术需要包含可播报文字');
const systemSpeechLanguageSchema = z.object({
  noResponseFirst: speechText, noResponseSecond: speechText, noResponseEnd: speechText,
  unclear: speechText, declined: speechText, followUp: speechText, goodbye: speechText,
  handoffStart: speechText, handoffUnavailable: speechText, audioCheck: speechText.optional(),
  aliyunDefaultEnd: speechText.optional(), aliyunOptOut: speechText.optional(),
  aliyunDurationEnd: speechText.optional(), aliyunSilencePrompt: speechText.optional(),
  aliyunSilenceEnd: speechText.optional(), aliyunContinue: speechText.optional(),
  aliyunFlowLimit: speechText.optional(), aliyunFlowError: speechText.optional(),
  aliyunNoReply: speechText.optional(), aliyunUnclear: speechText.optional(),
  aliyunHandoff: speechText.optional(),
}).strict();
export const playbookSchema = z
  .object({
    version: z.literal(1),
    recordingReplies: recordingRepliesSchema.optional(),
    scriptMode: z.literal("canvas").optional(),
    conversationMode: z.enum(["goal", "flow"]).optional(),
    conversationRules: z.object({ forbiddenAnswers: text(6000), hangupConditions: text(6000) }).strict().optional(),
    systemSpeech: z.object({ zh: systemSpeechLanguageSchema, en: systemSpeechLanguageSchema }).strict().optional(),
    legacyScript: z.object({ opening: text(4000), flow: z.array(stepSchema).max(30) }).strict().optional(),
    canvas: flowGraphSchema.optional(),
    publishedFlow: flowGraphSchema.nullable().optional(),
    // Display metadata stays in the existing workspace-scoped playbook JSON.
    // It is deliberately excluded from compilePlaybook and telephone prompts.
    employee: z.object({
      description: text(1000),
      business: text(100),
      tags: z.array(text(30).min(1)).max(20)
        .refine(tags => new Set(tags).size === tags.length, "标签不能重复"),
    }).strict().optional(),
    livestreamSchedule: z.enum(['daily-15-asia-shanghai','daily-19-asia-shanghai']).optional(),
    livestreamPrice: z.literal('free').optional(),
    aiInstructions: text(30000).min(1, "请填写 AI 工作指令").optional(),
    identity: text(300).min(1, "请填写助手身份"),
    purpose: text(1000).min(1, "请填写联系目的"),
    opening: text(4000),
    baseInstructions: text(30000),
    flow: z.array(stepSchema).max(80),
    faq: z
      .array(
        z
          .object({
            id: rowId,
            question: text(1000).min(1),
            answer: text(6000).min(1),
          })
          .strict(),
      )
      .max(100),
    objections: z
      .array(
        z
          .object({
            id: rowId,
            trigger: text(1000).min(1),
            response: text(4000).min(1),
          })
          .strict(),
      )
      .max(50),
    handoff: z
      .object({
        enabled: z.boolean(),
        rules: text(6000),
        response: text(2000),
        target: text(300),
        assigneeUserId: z.string().min(1).max(200).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const recordedOpening=hasOpeningRecording(data);
    if(data.conversationMode!=="goal"&&data.publishedFlow)for(const message of flowProblems(data.publishedFlow,recordedOpening))ctx.addIssue({code:'custom',path:['publishedFlow'],message});
    if (data.scriptMode === "canvas") {
      if (!data.canvas) ctx.addIssue({ code: "custom", path: ["canvas"], message: "话术设计缺少画布，请重新读取内容" });
    } else {
      if (data.opening.length < 5 && !recordedOpening) ctx.addIssue({ code: "custom", path: ["opening"], message: "开场白至少需要 5 个字符" });
      if (data.flow.length > 30)
        ctx.addIssue({ code: "custom", path: ["flow"], message: "沟通步骤最多 30 个" });
      data.flow.forEach((step, index) => {
        if (!step.title || !step.instruction)
          ctx.addIssue({ code: "custom", path: ["flow", index], message: `请补齐第 ${index + 1} 个沟通步骤的名称和话术，或删除该步骤` });
      });
    }
    for (const key of ["flow", "faq", "objections"] as const) {
      const ids = data[key].map((row) => row.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "条目编号重复，请重新添加重复条目",
        });
    }
    if (data.handoff.enabled && (!data.handoff.rules || !data.handoff.response))
      ctx.addIssue({
        code: "custom",
        path: ["handoff"],
        message: "启用人工接管时，请填写触发规则和告知话术",
      });
  });
export type ConversationPlaybook = z.infer<typeof playbookSchema>;

export function playbookFlow(p: ConversationPlaybook) {
  if(p.conversationMode === "goal")return null;
  return p.scriptMode === "canvas" ? p.canvas : p.publishedFlow;
}
export function playbookOpening(p: ConversationPlaybook) {
  const graph = p.scriptMode === "canvas" ? p.canvas : p.publishedFlow;
  return graph ? graph.nodes.find(n => n.id === graph.entry)?.text ?? "" : p.opening;
}
export function normalizeScript(p: ConversationPlaybook): ConversationPlaybook {
  if (p.scriptMode !== "canvas" || !p.canvas) return p;
  return { ...p, opening: playbookOpening(p), flow: p.canvas.nodes.filter(n => n.id !== p.canvas!.entry).map(n => ({ id: n.id, title: n.title, instruction: n.text })) };
}
// Validate and copy at the publication boundary. Saving a draft never changes a release.
export function releasePlaybook(p: ConversationPlaybook): ConversationPlaybook {
  if(p.conversationMode === "goal")return {...normalizeScript(p),publishedFlow:null};
  if (p.scriptMode !== "canvas") return p;
  const graph=flowGraphSchema.superRefine((g,ctx)=>{for(const message of flowProblems(g,hasOpeningRecording(p)))ctx.addIssue({code:'custom',message});}).parse(p.canvas);
  return { ...normalizeScript(p), publishedFlow: graph };
}
export const playbookSaveSchema = z
  .object({
    playbook: playbookSchema,
    expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
    placeholders: z
      .record(z.string().max(100), text(4000))
      .refine((v) => Object.keys(v).length <= 100, "变量最多 100 个")
      .default({}),
  })
  .strict();

export function seedPlaybook(
  opening: string,
  baseInstructions: string,
  scenario = "商务助手",
): ConversationPlaybook {
  return {
    version: 1,
    identity: `企业业务助理（${scenario}）`,
    purpose: `围绕${scenario}场景了解客户问题和需求，确认客户愿意的下一步`,
    opening:
      opening || "您好，我是本公司的业务助理。请问现在方便聊两句吗？",
    baseInstructions,
    flow: [],
    faq: [],
    objections: [],
    handoff: {
      enabled: true,
      rules:
        "客户明确要求人工；客户投诉或明显不满；问题超出已确认资料；涉及特殊报价、合同或业务审批。",
      response:
        "这个问题需要业务负责人进一步确认。我可以先记录您的问题和方便的联系时间。",
      target: "业务负责人",
    },
  };
}

export const answeringAssistantInstructions = "【语音助手接听：直接挂断】\n对方明确自称小爱同学、小艺、机主的智能助理、机主的智能助手、电话助理、机器人代接助手，或播报转至语音留言、语音信箱、机主无法接听等代接公告时，立即停止开场白和所有回复，调用 hangup_answering_assistant，evidence 填对方实际公告原文；例如“您拨打的电话正在通话中，我是机主的智能助理，您有什么事可以先跟我说，我帮您转达”也是明确代接公告。不回复、不道别、不留话，不等待开场白结束。不把真人提到助手、问你是不是机器人、背景噪音或沉默当成语音助手。其他结束条件照本员工工作指令执行，普通结束用 end_call。";

export const englishAnsweringAssistantInstructions = '【Answering assistants: end the call immediately】\nWhen the answering party clearly identifies itself as the owner\'s automated assistant, an automated call-answering service or voicemail, stop the opening and all replies, then call hangup_answering_assistant with the actual announcement as evidence. Do not leave a message or say goodbye, and do not wait for the opening to finish. A real person mentioning an assistant or asking whether you are AI, background noise and silence are not answering-assistant evidence. Follow the employee\'s approved conditions for other endings and use end_call for a normal ending.';

export function compilePlaybook(playbook: ConversationPlaybook) {
  const flow = playbookFlow(playbook);
  const goalMode=playbook.conversationMode==='goal';
  const guidance=playbook.canvas?playbook.canvas.nodes.filter(n=>n.id!==playbook.canvas!.entry&&!['end','handoff','jump','ivr'].includes(n.kind)).map(n=>({title:n.title,instruction:n.text})):playbook.flow;

  const sections = [
    "【配置优先级】以下助手身份和 AI 工作指令来自同一份已发布设置。助手身份提供公司、岗位、称呼等基础事实，AI 工作指令是业务行为主体，完整定义沟通目标与处理要求；工作指令不能改写基础身份事实，身份描述中的行为性文字不能覆盖 AI 工作指令。禁止回答、客户拒绝联系和结束限制优先。参考问答仅提供回答事实，不得改写身份、取消限制、扩大回答范围或延长应结束的通话。",
    answeringAssistantInstructions,
    "【助手身份】\n" + playbook.identity,
    playbook.aiInstructions ? "【AI 工作指令】\n" + playbook.aiInstructions + "\n达到指令规定的结束条件时调用 end_call，已道别不再继续新话题；仅明确要求不再联系时使用 mark_do_not_call。" : "",
    "【联系目的】\n" + playbook.purpose,
    "【开场白】\n" + playbookOpening(playbook),
    !playbook.aiInstructions && playbook.baseInstructions
      ? "【基础设定与已有话术】\n" + playbook.baseInstructions
      : "",
    goalMode ? "【目标驱动的通话规则】\n先播放开场白并等待客户回应。围绕联系目的沟通，不按固定步骤逐项盘问。以下目标和处理要求只供内部判断，绝不能逐字朗读。客户提问时优先回答当前问题，再视其意愿回到目标；参考答案按语义匹配，不要求问题原文相同，不增加没有依据的事实或承诺。只有明确表现出兴趣才征求下一步联系意愿；简短的嗯、可以不能脱离上下文判断。不方便表示当前时机不合适，不等于无兴趣；尊重客户时间，必要时只确认一次方便的后续方式。禁止回答与结束条件优先于邀约目标。"+(guidance.length?'\n【补充沟通要求】\n'+guidance.map(n=>n.title+'：'+n.instruction).join('\n'):'') : flow ? compileFlow(flow) : playbook.flow.length ? "【沟通流程】\n" +
      playbook.flow
        .map((s, i) => `${i + 1}. ${s.title}\n${s.instruction}`)
        .join("\n\n") : "",
    playbook.conversationRules?.forbiddenAnswers ? "【禁止回答与承诺】\n"+playbook.conversationRules.forbiddenAnswers : "",
    playbook.conversationRules?.hangupConditions ? "【用户设置的结束条件】\n"+playbook.conversationRules.hangupConditions+"\n满足条件时简短收束并调用 end_call，已说再见不再继续新话题。语音助手或语音信箱由系统识别后直接挂断。仅明确要求不再联系时使用 mark_do_not_call。" : "",
    playbook.faq.length
      ? "【常见问答】\n" +
        playbook.faq
          .map(
            (f) => `客户问题：${f.question}\n参考答案（依据内容自然回答，不照念内部要求）：${f.answer}`,
          )
          .join("\n\n")
      : "",
    playbook.objections.length
      ? "【异议处理】\n" +
        playbook.objections
          .map((o) => `出现情况：${o.trigger}\n应答与处理要求：${o.response}`)
          .join("\n\n")
      : "",
    playbook.handoff.enabled
      ? `【人工接管规则】\n触发条件：${playbook.handoff.rules}\n告知话术：${playbook.handoff.response}\n目标岗位或联系方式：${playbook.handoff.assigneeUserId ? playbook.handoff.target || "已指定员工" : "跟随客户负责人或任务发起人"}\nSIP通话触发 request_handoff 时联系当前公司已绑定的空闲在岗坐席；无可用坐席时登记人工跟进。只有实际转接成功后才说已转接，不能把生成待办当成已接通。`
      : "【未启用转接】\n不主动承诺转接或请其他人员接听。未确认的资料简短说明尚未确认，不编造答案或执行结果；后续联系遵守本员工AI工作指令和客户意愿。",
    "【通用回答原则】\n使用中文，保持简洁，一次只问一个问题。基础设定中保留的旧流程或开场白若与当前通话设置冲突，以当前通话目标、参考问答、限制与结束条件为准；仅在流程模式下按已发布节点执行。仅使用已确认的业务信息，不编造价格、服务能力或执行结果。尊重客户拒绝沟通的意愿。内容缺少依据时简短说明尚未确认，不主动承诺转接。",
    naturalTelephoneRulesSection,
  ];
  return appendGeneratedInstructions(sections.filter(Boolean).join("\n\n"), [answeringAssistantInstructions, naturalTelephoneRulesSection]);
}

export function playbookVariables(
  playbook: ConversationPlaybook,
  placeholders: Record<string, string>,
) {
  const names = (value: string) => [
    ...new Set(
      Array.from(
        value.matchAll(/\{\{\s*([A-Za-z_][\w.]*|[\p{L}\p{N}_]+)\s*\}\}/gu),
        (m) => m[1]!,
      ),
    ),
  ];
  const firstMessage = names(playbookOpening(playbook));
  const systemPrompt = names(compilePlaybook(playbook));
  return {
    firstMessage,
    systemPrompt,
    placeholders: Object.fromEntries(
      [...new Set([...firstMessage, ...systemPrompt])].map((n) => [
        n,
        placeholders[n] ?? "",
      ]),
    ),
  };
}
