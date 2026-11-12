/*
 * 中文导读：前端数据模型与表单约束：createOrgsSchema.ts。
 */
import { z } from "zod";
export const createOrgSchema = z.object({ name: z.string().trim().min(1, "请输入名称").max(80, "名称不能超过 80 个字符") });
