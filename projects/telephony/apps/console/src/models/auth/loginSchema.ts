/*
 * 中文导读：前端数据模型与表单约束：loginSchema.ts。
 */
import { z } from "zod";
import { memberAccountError } from "@/src/lib/member-batch";

export const loginSchema = z.object({
  account: z.string().trim().min(1, "请输入账号").refine(
    value => z.email().safeParse(value).success || !memberAccountError(value),
    { message: "请输入有效账号，支持中文、字母或数字" },
  ),
  password: z.string().min(6, { message: "密码至少需要6个字符" }),
  remember: z.boolean().optional(),
});
