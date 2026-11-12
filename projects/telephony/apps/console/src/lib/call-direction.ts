/*
 * 中文导读：共享基础能力：call-direction.ts。相关类型、配置或辅助实现集中在本文件。
 */
/** Older call providers return upper-case direction values. */
export function normalizeCallDirection(value: unknown): "inbound" | "outbound" | null {
  if (typeof value !== "string") return null;
  const direction = value.trim().toLowerCase();
  return direction === "inbound" || direction === "outbound" ? direction : null;
}
export function callDirectionLabel(value: unknown): string {
  const direction = normalizeCallDirection(value);
  return direction === "outbound" ? "呼出" : direction === "inbound" ? "呼入" : "未提供";
}
