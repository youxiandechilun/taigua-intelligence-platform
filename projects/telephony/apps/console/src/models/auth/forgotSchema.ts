/*
 * 中文导读：前端数据模型与表单约束：forgotSchema.ts。
 */
import { z } from "zod";

// Zod schema for email
export const forgotSchema = z.object({
    email: z.string().email(),
  });   