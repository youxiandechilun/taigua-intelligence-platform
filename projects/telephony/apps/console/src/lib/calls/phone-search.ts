/*
 * 中文导读：通话记录：phone-search.ts。相关类型、配置或辅助实现集中在本文件。
 */
export function normalizeCallPhoneSearch(value: string): string {
  return value.replace(/[\s-]+/g, "").replace(/^(?:\+86|0086)/, "");
}
