/*
 * 中文导读：通用组件：generateSlug.ts。相关类型、配置或辅助实现集中在本文件。
 */
export function generateSlug(text: string): string {
  const baseSlug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return baseSlug || "agent";
}
