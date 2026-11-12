/*
 * 中文导读：前端数据模型与表单约束：registerSchema.ts。
 */
import { z } from "zod";

export const registerSchema = z
  .object({
    name: z.string().min(5, "请输入姓名"),
    email: z.string().email("邮箱格式不正确"),
    password: z.string().min(6, "密码至少需要 6 个字符"),
    confirmPassword: z.string().min(6, "请再次输入密码"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });