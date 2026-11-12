/*
 * 中文导读：前端数据模型与表单约束：createAgentSchema.ts。
 */
import { z } from "zod";

// Agent creation schema
export const createAgentSchema = z.object({
  name: z.string().min(2, "智能体名称至少需要 2 个字符"),
  isActive: z.boolean(),
  organizationId: z.string().min(10,"工作区编号无效"),
  userId: z.string().min(10,"用户编号无效"),
  templateId: z.string().uuid("模板编号无效").nullable(),
});
export type CreateAgentArgs = z.infer<typeof createAgentSchema>;