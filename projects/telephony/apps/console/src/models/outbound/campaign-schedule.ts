/*
 * 中文导读：前端数据模型与表单约束：campaign-schedule.ts。
 */
import { Temporal } from "temporal-polyfill";

/** Resolve a local clock consistently: earlier overlap, shift forward across gaps. */
export function campaignScheduleToIso(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    throw new Error("请输入有效的计划日期和时间");
  }
  try {
    if (/:60(?:\.|$)/.test(value)) throw new Error("秒数无效");
    const local = Temporal.PlainDateTime.from(value.replace(" ", "T"), { overflow: "reject" });
    return new Date(local.toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds).toISOString();
  } catch {
    throw new Error("请输入有效的日期、时间和时区");
  }
}
