/*
 * 中文导读：前端数据模型与表单约束：conversationMessageSchema.ts。
 */
import { z } from "zod";

export const conversationMessageSchema = z.object({
    messageId: z.string(),
    role: z.enum(["user", "agent"]),
    message: z.string(),
    timestamp: z.string().datetime(),
  });