/*
 * 中文导读：前端数据模型与表单约束：campaign.ts。
 */
import { z } from "zod";
import { campaignScheduleToIso } from "./campaign-schedule";

import { serializeCsvRows } from "@/src/lib/export-csv";

export const BATCH_TEMPLATE_BASE_COLUMNS = [
  "phone_number",
  "language",
  "voice_id",
  "first_message",
  "prompt",
] as const;

export function buildBatchTemplateHeader(variableNames: string[] = []) {
  return serializeCsvRows([
    [...BATCH_TEMPLATE_BASE_COLUMNS, ...uniqueColumns(variableNames)],
  ]);
}

export function buildBatchTemplateCsv(variableNames: string[] = []) {
  return `${buildBatchTemplateHeader(variableNames)}\n`;
}

export const BATCH_TEMPLATE_HEADER = buildBatchTemplateHeader();

function uniqueColumns(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export const batchCampaignSchema = z
  .object({
    name: z.string().trim().min(1, "请输入外呼任务名称"),
    agentId: z.string().uuid(),
    fromNumber: z.string().min(10, "主叫号码至少需要 10 位数字"),
    file: z.instanceof(File),
    scheduleMode: z.enum(["instant", "later"]),
    scheduledAt: z.string().optional(),
    timezone: z.string().default("UTC"),
    ringingTimeoutSeconds: z.coerce.number().int().min(10).max(180),
  })
  .transform((data, ctx) => {
    if (data.scheduleMode === "instant") return { ...data, scheduledAt: undefined };
    try {
      if (!data.scheduledAt) throw new Error("请选择计划执行时间");
      return { ...data, scheduledAt: campaignScheduleToIso(data.scheduledAt, data.timezone) };
    } catch (error) {
      ctx.addIssue({
        path: ["scheduledAt"],
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "计划执行时间无效",
      });
      return z.NEVER;
    }
  });

export type BatchCampaignFormInput = z.infer<typeof batchCampaignSchema>;
