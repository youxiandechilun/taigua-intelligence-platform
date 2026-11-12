/*
 * 中文导读：共享基础能力：agent-sections.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const agentSections:ReadonlyArray<{value:'basic'|'script'|'voice';label:string}> = [{value:'basic',label:'基础设置'},{value:'script',label:'话术设计'}];
export const agentSectionHref = (agentId: string, tab: string) => `/agents/${encodeURIComponent(agentId)}?tab=${tab}`;
