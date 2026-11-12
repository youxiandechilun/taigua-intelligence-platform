/*
 * 中文导读：共享基础能力：settings-navigation.ts。相关类型、配置或辅助实现集中在本文件。
 */
export type SettingsAccess = { canManage: boolean; canManageAnnouncements?: boolean; isSystemAdmin: boolean; canManageMembers?:boolean; canManageDepartments?:boolean; canManageRoles?:boolean; canManageSeats?:boolean; permissions?:Record<string,string[]> };
type CompanySettingAccess="canManageAnnouncements"|"canManageMembers"|"canManageDepartments"|"canManageRoles"|"canManageSeats";
export type SettingsTab = { label: string; href: string; icon?:'phone'|'cloud'|'rules'|'building'|'notice'|'screen'|'palette'|'users'|'shield'|'model'|'voice'|'plug'|'key'|'message'|'chart'; systemOnly?: boolean; managerOnly?: boolean; resource?:string; permission?:{resource:string;action:string}; access?: CompanySettingAccess; anyAccess?:CompanySettingAccess[] };
export type SettingsGroup = { title: string; description: string; section: '业务配置'|'公司与人员'|'平台维护'; pageOwnHeading?:boolean; tabs: SettingsTab[] };

const groups: SettingsGroup[] = [
  { title: "线路管理", description: "SIP 与云线路、通话参数及员工分配", section: "业务配置", tabs: [
    { label: "SIP线路", href: "/settings/telephony", icon:"phone", resource:"lines" },
    { label: "阿里云", href: "/settings/telephony/aliyun", icon:"cloud", resource:"lines" },
  ] },
  { title: "大模型配置", description: "模型平台、调用授权与连通检查", section: "业务配置", tabs: [
    { label: "大模型配置", href: "/settings/models", icon:"model", systemOnly:true },
  ] },
  { title: "企业微信", description: "企业接入、员工绑定与客户联动", section: "业务配置", pageOwnHeading:true, tabs: [
    { label: "企业微信", href: "/settings/wecom", icon:"message", systemOnly:true },
  ] },
  { title: "用量与费用", description: "通话用量、云账单与费用明细", section: "业务配置", pageOwnHeading:true, tabs: [
    { label: "用量与费用", href: "/settings/billing", icon:"chart", permission:{resource:"billing",action:"read"} },
  ] },
  { title: "公司设置", description: "公司信息、公告及品牌设置", section: "公司与人员", tabs: [
    { label: "公司设置", href: "/settings/organization", icon:"building", access:"canManageAnnouncements" },
  ] },
  { title: "组织与人员", description: "员工账号、部门、角色与接听设置", section: "公司与人员", tabs: [
    { label: "组织与人员", href: "/settings/members", icon:"users", anyAccess:["canManageMembers","canManageSeats","canManageDepartments","canManageRoles"] },
  ] },
  { title: "界面外观", description: "个人主题与显示偏好", section: "公司与人员", tabs: [
    { label: "界面外观", href: "/settings/appearance", icon:"palette" },
  ] },
  { title: "平台管理", description: "公司工作区、回收站与超级管理员", section: "平台维护", tabs: [
    { label: "平台管理", href: "/settings/accounts", icon:"shield", systemOnly:true },
  ] },
  { title: "高级配置", description: "工具连接、集成凭据与系统 API 密钥", section: "平台维护", tabs: [
    { label: "工具与服务连接", href: "/settings/tools", icon:"plug", systemOnly:true },
    { label: "集成凭据", href: "/settings/credentials", icon:"key", systemOnly:true },
    { label: "系统 API 密钥", href: "/settings/api-keys", icon:"key", systemOnly:true },
  ] },
];

export function settingsGroup(pathname: string): SettingsGroup | undefined {
  return groups.find(group => group.tabs.some(tab => tab.href === pathname));
}

export function visibleSettingsTabs(group: SettingsGroup, access: SettingsAccess): SettingsTab[] {
  return group.tabs.filter(tab => (!tab.permission || access.permissions?.[tab.permission.resource]?.includes(tab.permission.action) || access.isSystemAdmin) && (!tab.anyAccess || tab.anyAccess.some(key=>access[key]) || access.isSystemAdmin) && (!tab.resource || access.permissions?.[tab.resource]?.includes("assign") || access.isSystemAdmin) && (!tab.access || access[tab.access] || access.isSystemAdmin) && (!tab.systemOnly || access.isSystemAdmin) && (!tab.managerOnly || access.canManage || access.isSystemAdmin));
}

// The center and subpage navigation use the same permission-filtered entries.
export function visibleSettingsGroups(access: SettingsAccess): SettingsGroup[] {
  return groups.map(group => ({...group, tabs:visibleSettingsTabs(group,access)})).filter(group => group.tabs.length > 0);
}
