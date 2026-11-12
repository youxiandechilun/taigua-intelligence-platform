/*
 * 中文导读：前端数据模型与表单约束：verifySchema.ts。
 */
import { z } from "zod";

export const verifySchema = z.object({
    userId: z.string().uuid(),
    code: z.string().length(6, "验证码必须为 6 个字符"),
});