/*
 * 中文导读：共享基础能力：knowledge-title.ts。相关类型、配置或辅助实现集中在本文件。
 */
/** Generate a readable heading only from the saved text; never invent facts. */
export function readableKnowledgeTitle(item: { title: string; content?: string; preview?: string; tags?: string[]; kind?: string; sourceKind?: string }) {
  const title = item.title.trim().replace(/\\([^\\]+\\)/g, "$1");
  const vague = /^(?:什么|为什么|怎么|如何|怎么办|问题|问答|知识|未命名|无标题|新建知识|新增知识)[?？。！!\s]*$/.test(title);
  if (!vague) return title;
  const text = (item.content || item.preview || "").replace(/^(?:问[：:]?\s*[^\n]*\n)?答[：:]\s*/, "").replace(/^[#*\-\s]+/, "");
  const first = text.split(/[\n。！？!?]/).map(line => line.replace(/^(?:问|答|客户|回应)[：:]\s*/, "").trim()).find(line => line.length >= 8 && !/^(?:什么|为什么|怎么|如何)[?？]?$/.test(line));
  if (first) return first.slice(0, 42) + (first.length > 42 ? "…" : "");
  const tags = item.tags?.filter(tag => tag.length >= 2 && !/^(?:待确认|常见问题|其他)$/.test(tag));
  return tags?.length ? `${tags.slice(0, 2).join("、")}相关问答` : item.kind === "note" ? "待完善的问答" : "待命名资料";
}
