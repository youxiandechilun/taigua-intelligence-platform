/*
 * 中文导读：外呼任务：task-visibility.ts。相关类型、配置或辅助实现集中在本文件。
 */
type OutboundAccess = { isSystemAdmin?: boolean; canManage?: boolean; allData?: boolean };

export const canViewAllOutbound = (access?: OutboundAccess) =>
  access?.isSystemAdmin===true||access?.canManage===true&&access?.allData===true;
