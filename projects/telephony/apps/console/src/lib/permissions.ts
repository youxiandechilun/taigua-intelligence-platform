/*
 * 中文导读：资源操作权限的声明与辅助判断。
 */
// Mirror of the server's permission statement in apps/server/src/lib/permissions.ts.
// Used by the Roles settings page to build the permission matrix editor.
// Keep in sync with the server when new resources or actions are added.

export const RESOURCES = [
  {
    id: "agent",
    label: "智能体",
    actions: ["create", "read", "update", "delete"],
  },
  {
    id: "agentConfiguration",
    label: "智能体配置",
    actions: ["create", "read", "update", "delete"],
  },
  {
    id: "phoneNumber",
    label: "电话号码",
    actions: ["create", "read", "update", "delete"],
  },
  {
    id: "knowledgeSource",
    label: "知识库",
    actions: ["create", "read", "update", "delete"],
  },
  { id: "callLogs", label: "通话记录", actions: ["read", "delete"] },
  {
    id: "outboundCalls",
    label: "外呼通话",
    actions: ["create", "read", "delete"],
  },
  {
    id: "campaigns",
    label: "外呼任务",
    actions: ["create", "read", "delete"],
  },
  {
    id: "tools",
    label: "工具",
    actions: ["create", "read", "update", "delete"],
  },
  { id: "secrets", label: "密钥", actions: ["create", "read", "delete"] },
  {
    id: "agentWidget",
    label: "网站语音组件",
    actions: ["create", "read", "update", "delete"],
  },
] as const;

export type ResourceId = (typeof RESOURCES)[number]["id"];
export type Permissions = Partial<Record<ResourceId, string[]>>;

export const BUILTIN_ROLES = ["owner", "admin", "member"] as const;
