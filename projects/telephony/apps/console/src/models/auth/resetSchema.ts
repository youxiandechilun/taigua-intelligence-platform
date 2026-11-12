/*
 * 中文导读：前端数据模型与表单约束：resetSchema.ts。
 */
import { z } from "zod";

// Zod schema to validate request body
export const resetSchema = z.object({
    token: z.string().min(8, "缺少验证令牌"),
    newPassword: z.string().min(8, "密码至少需要 8 个字符"),
  });
