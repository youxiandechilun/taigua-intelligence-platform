/*
 * 中文导读：阿里云连接：aliyun.schema.ts。定义请求数据结构与校验约束。
 */
import { z } from "zod";

export function mainlandPhone(value: string) {
  const phone = value.replace(/[\s()-]/g, "").replace(/^(\+86|0086)/, "");
  if (!/^1[3-9]\d{9}$/.test(phone) && !/^0\d{2,3}\d{7,8}$/.test(phone)) {
    throw new Error("请输入中国大陆手机号或带区号的座机号码");
  }
  return phone;
}

const phoneSchema = z.string().trim().transform((value, ctx) => {
  try { return mainlandPhone(value); }
  catch { ctx.addIssue({ code: "custom", message: "号码应为国内手机号或带区号的座机" }); return z.NEVER; }
});

const callerSchema = z.string().trim().transform((value, ctx) => {
  const normalized = value.replace(/[\s()-]/g, "").replace(/^(\+86|0086)/, "");
  // Caller numbers may also be provider-assigned domestic service numbers.
  if (/^(?:400|800)\d{7}$/.test(normalized) || /^95\d{3,9}$/.test(normalized)) return normalized;
  try { return mainlandPhone(normalized); }
  catch { ctx.addIssue({ code: "custom", message: "请填写阿里云审核的国内主叫号码" }); return z.NEVER; }
});

export const callDays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const dialPolicySchema = z.object({
  timeRestricted: z.boolean().optional(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("18:00"),
  days: z.array(z.enum(callDays)).min(1).max(7).transform(days => [...new Set(days)]).default(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]),
  retries: z.number().int().min(0).max(3).default(0),
  retryIntervalMinutes: z.number().int().min(1).max(720).default(60),
  holidayRestricted: z.boolean().default(true),
}).strict().refine(policy => policy.start < policy.end, { message: "拨打结束时间必须晚于开始时间", path: ["end"] });
export function executionPolicy(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const { concurrency, createdByUserId: _creator, ...policy } = source;
  return { ...dialPolicySchema.parse(policy), concurrency: z.number().int().min(1).max(10).default(1).parse(concurrency) };
}

export const connectionSchema = z.object({
  product: z.enum(["outboundbot", "aiccs"]).default("outboundbot"),
  communicationAgentId: z.string().trim().regex(/^\d*$/, "通信智能体 ID 应为数字").max(30).default(""),
  branchId: z.string().trim().regex(/^\d*$/).max(30).default(""),
  versionId: z.string().trim().regex(/^\d*$/).max(30).default(""),
  approvedKnowledge: z.string().trim().max(20000).default(""),
  concurrency: z.number().int().min(1).max(10).default(1),
  dialPolicy: dialPolicySchema.default(() => dialPolicySchema.parse({})),
  seatInstanceId: z.string().trim().max(200).default(""),
  regionId: z.string().regex(/^cn-[a-z]+$/, "请填写阿里云中国区地域 ID").default("cn-shanghai"),
  instanceId: z.string().trim().max(200).default(""),
  defaultScriptId: z.string().trim().max(200).default(""),
  callerNumbers: z.array(callerSchema).max(100).default([]),
  model: z.enum(["qwen-plus", "qwen-turbo", "qwen-max"]).default("qwen-plus"),
  liveEnabled: z.boolean().default(false),
  accessKeyId: z.string().trim().max(200).optional(),
  accessKeySecret: z.string().trim().max(300).optional(),
  securityToken: z.string().trim().max(10000).optional(),
  dashscopeApiKey: z.string().trim().max(300).optional(),
}).strict();

export const bindingSchema = z.object({ scriptId: z.string().trim().min(1).max(200) }).strict();
export const communicationProfileSchema = z.object({
  gender: z.enum(["neutral", "female", "male"]).default("neutral"),
  language: z.enum(["zh-CN", "zh-HK", "en", "auto"]).default("zh-CN"),
  voiceCode: z.string().trim().max(200).regex(/^[a-zA-Z0-9_./:-]*$/).default(""),
  voiceName: z.string().trim().max(200).default(""),
  dialPolicyOverride: dialPolicySchema.nullable().default(null),
}).strict();
export const profileSaveSchema = z.object({
  profile: communicationProfileSchema,
  expectedUpdatedAt: z.iso.datetime().nullable(),
}).strict();
export const communicationBindingSchema = z.object({
  agentId: z.string().regex(/^\d{1,30}$/),
  branchId: z.string().regex(/^\d{1,30}$/).optional(),
  versionId: z.string().regex(/^\d{1,30}$/).optional(),
}).strict();

export const recipientSchema = z.object({
  crmCompanyId: z.string().uuid().optional(),
  crmContactId: z.string().uuid().nullable().optional(),
  phoneNumber: phoneSchema,
  name: z.string().trim().max(200).default(""),
  variables: z.record(z.string().max(100), z.string().max(1000)).default({})
    .refine((values) => Object.keys(values).length <= 10, "阿里云每位客户最多支持 10 个自定义变量"),
}).strict().refine(r=>!r.crmContactId||Boolean(r.crmCompanyId),"请选择联系人所属企业");

export const taskSchema = z.object({
  name: z.string().trim().min(2).max(100),
  agentId: z.string().uuid(),
  callerNumber: callerSchema,
  recipients: z.array(recipientSchema).min(1).max(2000),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
}).strict().refine((task) => Date.parse(task.endTime) > Date.parse(task.startTime), {
  message: "结束时间必须晚于开始时间", path: ["endTime"],
});

export const rehearsalSchema = z.object({
  agentId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000),
  })).min(1).max(20),
}).strict();

export type ConnectionInput = z.infer<typeof connectionSchema>;
export type RecipientInput = z.infer<typeof recipientSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
