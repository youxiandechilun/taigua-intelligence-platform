/*
 * 中文导读：前端数据模型与表单约束：secrets.ts。
 */
import { z } from "zod";

export const secretSchema = z.object({
    name: z.string().min(1, "请输入名称"),
    key: z.string().min(1, "请输入标识"),
    value: z.string().min(1, "请输入值"),
});