/*
 * 中文导读：线路与语音外呼：voice-operations.settings.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb } from '../crm/crm.service.js';

export const networkJitterSchema = z.union([z.literal(0), z.literal(20), z.literal(40), z.literal(60), z.literal(80)]);
export const voiceOperationsSettingsSchema = z.object({
  networkJitterMs: networkJitterSchema.default(0),
  alertsEnabled: z.boolean().default(true),
}).strict();
export const voiceOperationsPatchSchema = z.object({ networkJitterMs: networkJitterSchema.optional(), alertsEnabled: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0, '请至少修改一项配置。');
export type VoiceOperationsSettings = z.infer<typeof voiceOperationsSettingsSchema>;
export const alertSchema = z.object({
  id: z.string().uuid(),
  key: z.string().max(180),
  kind: z.enum(['line', 'bridge', 'quality']),
  severity: z.enum(['warning', 'critical']),
  title: z.string().max(100),
  message: z.string().max(400),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
}).strict();
export type VoiceOperationsAlert = z.infer<typeof alertSchema>;
export type VoiceOperationsStored = VoiceOperationsSettings & { checkedAt: string | null; alerts: VoiceOperationsAlert[] };

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function voiceOperationsFromStored(value: unknown): VoiceOperationsStored {
  const raw = object(value);
  // A malformed history record must never alter call defaults or prevent dispatch.
  const jitter = networkJitterSchema.safeParse(raw.networkJitterMs);
  const alerts = Array.isArray(raw.alerts) ? raw.alerts.slice(0, 80).flatMap(value => { const parsed = alertSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }) : [];
  return {
    networkJitterMs: jitter.success ? jitter.data : 0,
    alertsEnabled: typeof raw.alertsEnabled === 'boolean' ? raw.alertsEnabled : true,
    checkedAt: typeof raw.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null,
    alerts,
  };
}

export async function storedVoiceOperations(workspaceId: string, db: CrmDb = crmDb) {
  const row = (await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1', [workspaceId]))[0];
  return voiceOperationsFromStored(object(row?.settings).voiceOperations);
}

export async function callNetworkJitterMs(workspaceId: string, db: CrmDb = crmDb) {
  // Dispatch reads only the small setting, never the bounded alert history.
  const row = (await db.query(`SELECT "settings"->'voiceOperations'->'networkJitterMs' AS "networkJitterMs" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1`, [workspaceId]))[0];
  const parsed = networkJitterSchema.safeParse(row?.networkJitterMs);
  return parsed.success ? parsed.data : 0;
}

export async function writeVoiceOperations(workspaceId: string, settings: VoiceOperationsStored, db: CrmDb) {
  await db.query(`INSERT INTO "WorkspaceModelSettings" ("workspaceId","settings","updatedAt")
    VALUES ($1,jsonb_build_object('enabled','[]'::jsonb,'summaryModel',''::text,'voiceOperations',$2::jsonb),NOW())
    ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=jsonb_set("WorkspaceModelSettings"."settings",'{voiceOperations}',$2::jsonb),"updatedAt"=NOW()
    RETURNING "workspaceId"`, [workspaceId, JSON.stringify(settings)]);
}
