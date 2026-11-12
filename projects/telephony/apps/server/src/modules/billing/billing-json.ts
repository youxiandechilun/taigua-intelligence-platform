/*
 * 中文导读：用量与费用：billing-json.ts。相关类型、配置或辅助实现集中在本文件。
 */
export function toBillingJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toBillingJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toBillingJson(entry)]),
    );
  }
  return value;
}
