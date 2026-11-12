/*
 * 中文导读：前端数据模型与表单约束：quickCall.ts。
 */
import { z } from "zod";

export const quickCallSchema = z.object({
  agentId: z.string().uuid(),
  phoneNumber: z.string().min(10, "电话号码至少需要 10 位数字"),
  fromNumber: z.string().min(10, "主叫号码至少需要 10 位数字"),
  firstMessage: z.string().optional(),
  systemPrompt: z.string().optional(),
  username: z.string().optional(),
  dynamicVariables: z.record(z.string(), z.string()).optional(),
});

export type QuickCallInput = z.infer<typeof quickCallSchema>;
