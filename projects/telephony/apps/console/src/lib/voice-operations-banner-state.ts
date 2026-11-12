/*
 * 中文导读：共享基础能力：voice-operations-banner-state.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { VoiceOperationAlert } from './api/resources/voice-operations';

type AcknowledgedAlert = Pick<VoiceOperationAlert, 'id' | 'firstSeenAt' | 'severity'>;
export type VoiceBannerDismissals = { alerts: AcknowledgedAlert[]; errorAcknowledgedAt: number | null };

const changeEvent = 'taigua:voice-banner-dismissal';
const volatileSnapshots = new Map<string, string>();
export const voiceBannerStorageKey = (user: string, org: string) => `taigua:voice-banner:v1:${encodeURIComponent(user)}:${encodeURIComponent(org)}`;
export const emptyVoiceBannerSnapshot = () => '';

export function readVoiceBannerSnapshot(key: string): string {
  if (typeof window === 'undefined') return '';
  if (volatileSnapshots.has(key)) return volatileSnapshots.get(key)!;
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

export function subscribeVoiceBannerSnapshot(key: string, callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === key || event.key === null) { volatileSnapshots.delete(key); callback(); }
  };
  const localChanged = (event: Event) => { if ((event as CustomEvent<string>).detail === key) callback(); };
  window.addEventListener('storage', storageChanged);
  window.addEventListener(changeEvent, localChanged);
  return () => { window.removeEventListener('storage', storageChanged); window.removeEventListener(changeEvent, localChanged); };
}

export function parseVoiceBannerSnapshot(raw: string): VoiceBannerDismissals {
  const empty: VoiceBannerDismissals = { alerts: [], errorAcknowledgedAt: null };
  if (!raw || raw.length > 32000) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('alerts' in value) || !Array.isArray(value.alerts) || value.alerts.length > 100) return empty;
    const alerts: AcknowledgedAlert[] = [];
    for (const item of value.alerts) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length > 200 || typeof item.firstSeenAt !== 'string' || item.firstSeenAt.length > 64 || !['warning', 'critical'].includes(item.severity)) return empty;
      alerts.push({ id: item.id, firstSeenAt: item.firstSeenAt, severity: item.severity });
    }
    const errorAcknowledgedAt = 'errorAcknowledgedAt' in value && typeof value.errorAcknowledgedAt === 'number' && Number.isFinite(value.errorAcknowledgedAt) && value.errorAcknowledgedAt > 0 ? value.errorAcknowledgedAt : null;
    return { alerts, errorAcknowledgedAt };
  } catch { return empty; }
}

export function serializeVoiceBannerDismissals(value: VoiceBannerDismissals): string {
  return !value.alerts.length && value.errorAcknowledgedAt === null ? '' : JSON.stringify({ version: 1, alerts: value.alerts.slice(-100), errorAcknowledgedAt: value.errorAcknowledgedAt });
}

export function writeVoiceBannerSnapshot(key: string, snapshot: string) {
  if (typeof window === 'undefined' || readVoiceBannerSnapshot(key) === snapshot) return;
  try {
    if (snapshot) window.localStorage.setItem(key, snapshot); else window.localStorage.removeItem(key);
    volatileSnapshots.delete(key);
  } catch { volatileSnapshots.set(key, snapshot); }
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
}

export function voiceAlertAcknowledged(alert: VoiceOperationAlert, acknowledgements: AcknowledgedAlert[]): boolean {
  return acknowledgements.some(item => item.id === alert.id && item.firstSeenAt === alert.firstSeenAt && (item.severity === 'critical' || item.severity === alert.severity));
}

export function acknowledgeVoiceAlerts(current: VoiceBannerDismissals, alerts: VoiceOperationAlert[]): VoiceBannerDismissals {
  const acknowledged = current.alerts.slice();
  for (const alert of alerts) {
    const index = acknowledged.findIndex(item => item.id === alert.id && item.firstSeenAt === alert.firstSeenAt);
    const item: AcknowledgedAlert = { id: alert.id, firstSeenAt: alert.firstSeenAt, severity: alert.severity };
    if (index < 0) acknowledged.push(item); else if (acknowledged[index].severity !== 'critical') acknowledged[index] = item;
  }
  return { ...current, alerts: acknowledged };
}
