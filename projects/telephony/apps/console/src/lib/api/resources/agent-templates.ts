/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "@/src/lib/api/client";
export type AgentTemplate = {
  id: string;
  title: string;
  category: "拓客销售" | "客户服务" | "通知提醒" | "通用场景";
  description: string;
  firstMessage: string;
  fields: string[];
  evaluations: string[];
};
export function getAgentTemplates() {
  return unwrap<AgentTemplate[]>(apiClient.get("/agents/templates"));
}
