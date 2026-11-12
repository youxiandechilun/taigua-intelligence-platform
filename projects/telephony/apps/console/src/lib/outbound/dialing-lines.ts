/*
 * 中文导读：外呼任务：dialing-lines.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CallerCatalog, RegionalCatalog } from '@/src/lib/api/resources/telephony';

export type DialProvider = 'HAOKEHU_SIP' | 'ALIYUN_ENGINE';
export type DialSelection = { provider: DialProvider; province: string; lineId: string; serviceProvider?:string };
export type DialLine = { id: string; provider: DialProvider; serviceProvider?:string; name: string; provinces: string[]; identifier: string; ready: boolean; enabled: boolean };
export const DEFAULT_PROVINCE = '__default';
export const dialProviderName = (provider?: string, serviceProvider?:string) => provider === 'ALIYUN_ENGINE' ? '阿里云' : serviceProvider||'好客呼';
export const dialProvinceName = (province: string) => province === DEFAULT_PROVINCE ? '默认范围（未分省）' : province;

/** Only expose configured routes the current employee can use. */
export function dialingLines(callers: CallerCatalog, regional: RegionalCatalog, actor: string, systemAdmin: boolean): DialLine[] {
  return callers.rows.flatMap(row => {
    if (row.provider === 'ALIYUN_LEGACY' || !row.identifier) return [];
    const route = regional.lines.find(line => line.id === row.id);
    if (row.provider === 'HAOKEHU_SIP' && row.id !== 'haokehu-default' && !route) return [];
    if (route && !systemAdmin && regional.canManage && !route.publicLine && !route.assignedUserIds?.includes(actor)) return [];
    return [{ id: row.id, provider: row.provider, serviceProvider:row.serviceProvider, name: row.name, identifier: row.identifier, provinces: route?.provinces.length ? route.provinces : [DEFAULT_PROVINCE], ready: row.ready, enabled: row.enabled && route?.enabled !== false }];
  });
}

export function selectedDialLine(lines: DialLine[], value: DialSelection) {
  return lines.find(line => line.id === value.lineId && line.provider === value.provider && line.provinces.includes(value.province));
}
