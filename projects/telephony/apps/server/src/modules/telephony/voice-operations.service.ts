/*
 * 中文导读：声音库管理与语音生成相关业务。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { crmDb } from '../crm/crm.db.js';
import type { Scope } from '../crm/crm.service.js';
import { companyContext } from '../workspace/company-access.js';
import { bridgeRequest } from './bridge-client.js';
import { credentialScope } from './model-credentials.js';
import { lineHealthFromSettings } from './routing.service.js';
import { storedVoiceOperations, voiceOperationsPatchSchema, writeVoiceOperations, type VoiceOperationsAlert } from './voice-operations.settings.js';

const date = z.string().min(1).max(64).refine(v => Number.isFinite(Date.parse(v)));
const count = z.number().finite().nonnegative();
const metric = z.number().finite().nullable();
const callQualitySchema = z.object({
  attemptId: z.string().uuid(), startedAt: date, endedAt: date.optional(), networkJitterMs: count,
  localRtp: z.object({ receivedPackets: count, sentPackets: count, lostFrames: count, droppedFrames: count, filledFrames: count, lateSendTicks: count, jitterMs: metric, lastPacketAgeMs: metric, remoteLossPercent: metric, remoteJitterMs: metric }).nullable(),
  publicRtp: z.object({ receivedPackets: metric, sentPackets: metric, jitterBufferPackets: metric, skipPackets: metric, flawCount: metric, mos: metric }).nullable(),
  turnLatency: z.object({ samples: count, lastTotalMs: count, lastProviderMs: metric, maxTotalMs: count }).nullable(),
});
const operationsSchema = z.object({
  version: z.literal(1), observedAt: date, retentionSeconds: count, limit: z.number().int().min(1).max(50),
  active: z.array(callQualitySchema).max(50), recent: z.array(callQualitySchema).max(50),
  scope: z.literal('workspace'), localScope: z.literal('freeswitch_bridge'), publicScope: z.literal('freeswitch_external_hangup'),
});
const healthSchema = z.object({ switchReady: z.boolean(), externalReady: z.boolean(), executionEnabled: z.boolean(), modelConfigured: z.boolean() });
type Dependency = { key: 'bridge' | 'switch' | 'external' | 'execution' | 'model'; label: string; state: 'healthy' | 'warning' | 'critical' | 'unknown'; detail: string; checkedAt: string };
type Finding = Pick<VoiceOperationsAlert, 'key' | 'kind' | 'severity' | 'title' | 'message'>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeText = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, limit) : '';

async function dependencies(workspaceId: string): Promise<Dependency[]> {
  const checkedAt = new Date().toISOString();
  let health: z.infer<typeof healthSchema> | null = null;
  try { health = healthSchema.parse(await (await bridgeRequest('/health?scope=' + credentialScope(workspaceId), undefined, undefined, 5000)).json()); } catch { /* Report only a safe component-level state. */ }
  return [
    { key: 'bridge', label: '语音桥连接', state: health ? 'healthy' : 'critical', detail: health ? '本机认证接口可达' : '本机语音桥不可达或认证失败，请检查服务', checkedAt },
    { key: 'switch', label: 'FreeSWITCH 连接', state: !health ? 'unknown' : health.switchReady ? 'healthy' : 'critical', detail: !health ? '等待语音桥恢复后检查' : health.switchReady ? '语音桥已连接交换服务' : '语音桥未连接交换服务', checkedAt },
    { key: 'external', label: 'SIP 外线配置', state: !health ? 'unknown' : health.externalReady ? 'healthy' : 'critical', detail: !health ? '等待语音桥恢复后检查' : health.externalReady ? '本机外线配置检查通过；线路商状态以通话结果为准' : '本机 SIP 外线配置检查未通过', checkedAt },
    { key: 'execution', label: '真实通话开关', state: !health ? 'unknown' : health.executionEnabled ? 'healthy' : 'warning', detail: !health ? '等待语音桥恢复后检查' : health.executionEnabled ? '已允许真实通话' : '真实通话未开启', checkedAt },
    { key: 'model', label: '实时模型密钥', state: !health ? 'unknown' : health.modelConfigured ? 'healthy' : 'warning', detail: !health ? '等待语音桥恢复后检查' : health.modelConfigured ? '密钥已配置；此项不验证模型余额和接口可用性' : '当前工作区尚未配置实时语音模型密钥', checkedAt },
  ];
}

async function lineSnapshot(workspaceId: string) {
  const rows = await crmDb.query(`SELECT 'haokehu-default'::text AS "id",true AS "enabled","settings" FROM "SipConnection" WHERE "workspaceId"=$1 AND COALESCE("settings"->>'removedAt','')=''
    UNION ALL SELECT "id","enabled","settings" FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL`, [workspaceId]);
  return rows.map(row => {
    const raw = object(row.settings), health = lineHealthFromSettings(raw);
    // Failure history informs operators without suspending new dispatch.
    const state = health.checkedAt ? health.state : 'unknown';
    return {
      id: String(row.id), name: safeText(raw.name, 80) || '未命名线路', enabled: row.enabled === true && raw.liveEnabled === true,
      // No result yet is unknown, even when the dispatch circuit is initially open.
      state,
      consecutiveFailures: health.consecutiveFailures, cooldownUntil: null,
      lastSuccessAt: health.lastSuccessAt, lastFailureAt: health.lastFailureAt,
      lastFailureReason: safeText(health.lastFailureReason, 200), observation: 'call-results' as const,
    };
  });
}

async function qualitySnapshot(workspaceId: string) {
  try {
    const quality = operationsSchema.parse(await (await bridgeRequest('/operations?workspaceId=' + encodeURIComponent(workspaceId), undefined, undefined, 5000)).json());
    return { quality, qualityError: null };
  } catch { return { quality: null, qualityError: '通话质量暂未观测，请检查语音桥是否已更新并正常运行。' }; }
}

async function snapshot(workspaceId: string) {
  const [parts, lines, quality] = await Promise.all([dependencies(workspaceId), lineSnapshot(workspaceId), qualitySnapshot(workspaceId)]);
  return { dependencies: parts, lines, ...quality };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

function findings(current: Snapshot, now: number): Finding[] {
  const values: Finding[] = [];
  for (const part of current.dependencies) if (part.state === 'warning' || part.state === 'critical') {
    values.push({ key: 'dependency:' + part.key, kind: 'bridge', severity: part.state, title: part.label + '异常', message: part.detail });
  }
  for (const line of current.lines) if (line.enabled && (line.state === 'offline' || line.state === 'degraded')) {
    const failureAt = line.lastFailureAt && Number.isFinite(Date.parse(line.lastFailureAt)) ? new Date(line.lastFailureAt).toISOString() : null;
    const failureInfo = (failureAt ? '上次失败时间：' + failureAt + '。' : '上次失败时间未记录。')
      + (/^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(line.lastFailureReason) ? '原因代码：' + line.lastFailureReason + '。' : '原因代码未记录。')
      + '每次呼叫的 SIP 返回码请查看逐次失败明细。';
    values.push({ key: 'line:' + line.id, kind: 'line', severity: line.state === 'offline' ? 'critical' : 'warning', title: line.name + '历史通话失败待验证',
      message: '历史呼叫出现失败，等待新通话结果验证线路状态。失败记录不会暂停线路调度。' + failureInfo + '此状态根据真实通话结果判断，不代表当前 SIP 注册状态。' });
  }
  const quality = current.quality;
  if (quality) {
    const calls = [...quality.active, ...quality.recent.filter(call => call.endedAt && now - Date.parse(call.endedAt) < 120000)];
    const loss = calls.some(call => { const r = call.localRtp; return r && r.receivedPackets >= 100 && r.lostFrames / Math.max(1, r.receivedPackets + r.lostFrames) >= 0.05; });
    const publicLoss = calls.some(call => call.localRtp?.remoteLossPercent !== null && call.localRtp?.remoteLossPercent !== undefined && call.localRtp.remoteLossPercent >= 5 && call.localRtp.sentPackets >= 100);
    const jitter = calls.some(call => call.localRtp && call.localRtp.receivedPackets >= 100 && (call.localRtp.jitterMs ?? 0) >= 40);
    const slow = calls.some(call => call.turnLatency && call.turnLatency.samples > 0 && call.turnLatency.lastTotalMs >= 3000);
    if (loss || publicLoss || jitter) values.push({ key: 'quality:rtp', kind: 'quality', severity: 'warning', title: '近期通话音频存在波动', message: '最近两分钟或当前通话观测到音频缺帧、丢包或抖动较高。请结合桥接媒体和公网侧指标判断；不要直接调大缓冲。' });
    if (slow) values.push({ key: 'quality:latency', kind: 'quality', severity: 'warning', title: '近期 AI 接话超过3秒', message: '当前通话或最近两分钟内的一轮应答超过3秒，请结合模型首音耗时和整轮耗时检查。未观测的耗时不会按0计算。' });
  }
  return values;
}

function preserveUnobserved(alert: VoiceOperationsAlert, current: Snapshot) {
  if (alert.kind === 'quality') return current.quality === null;
  if (alert.kind === 'bridge') return current.dependencies.find(part => 'dependency:' + part.key === alert.key)?.state === 'unknown';
  return false;
}

async function assertAdmin(s: Scope) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('语音运行监控和网络缓冲仅系统超级管理员可以查看或修改。');
}

async function catalog(workspaceId: string) {
  const [stored, current] = await Promise.all([storedVoiceOperations(workspaceId), snapshot(workspaceId)]);
  return { canConfigure: true, settings: { networkJitterMs: stored.networkJitterMs, alertsEnabled: stored.alertsEnabled }, checkedAt: stored.checkedAt, ...current, alerts: stored.alerts };
}

export async function voiceOperationsCatalog(s: Scope) { await assertAdmin(s); return catalog(s.workspaceId); }

export async function saveVoiceOperations(s: Scope, input: unknown) {
  await assertAdmin(s);
  const patch = voiceOperationsPatchSchema.parse(input);
  await crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['voice-operations:' + s.workspaceId]);
    const prior = await storedVoiceOperations(s.workspaceId, db);
    const settings = { ...prior, ...patch };
    if (!settings.alertsEnabled) settings.alerts = prior.alerts.map(alert => alert.resolvedAt ? alert : { ...alert, resolvedAt: new Date().toISOString() });
    await writeVoiceOperations(s.workspaceId, settings, db);
  });
  await recordAuditEvent({ organizationId: s.workspaceId, userId: s.userId, action: 'voice.operations.saved', resourceType: 'WorkspaceModelSettings', resourceId: s.workspaceId, metadata: patch });
  return catalog(s.workspaceId);
}

async function collectWorkspace(workspaceId: string) {
  const current = await snapshot(workspaceId), now = new Date(), checkedAt = now.toISOString();
  const detected = findings(current, now.getTime());
  await crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['voice-operations:' + workspaceId]);
    const prior = await storedVoiceOperations(workspaceId, db);
    // Multiple API processes may run the monitor. Persist at most one observation
    // per interval and deduplicate by component rather than producing a new alert.
    if (prior.checkedAt && Date.parse(prior.checkedAt) >= now.getTime() - 20000) return;
    const alerts: VoiceOperationsAlert[] = prior.alerts.map(alert => {
      if (alert.resolvedAt || !prior.alertsEnabled) return alert;
      const finding = detected.find(value => value.key === alert.key);
      return finding ? { ...alert, ...finding, lastSeenAt: checkedAt } : preserveUnobserved(alert, current) ? alert : { ...alert, resolvedAt: checkedAt };
    });
    if (prior.alertsEnabled) for (const finding of detected) {
      if (!alerts.some(alert => alert.key === finding.key && !alert.resolvedAt)) alerts.push({ id: randomUUID(), ...finding, firstSeenAt: checkedAt, lastSeenAt: checkedAt, resolvedAt: null });
    }
    alerts.sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    await writeVoiceOperations(workspaceId, { ...prior, checkedAt, alerts: alerts.slice(0, 80) }, db);
  });
}

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
let stopping = false;
async function collectAll() {
  const workspaces = await crmDb.query(`SELECT DISTINCT w."workspaceId" FROM (
    SELECT "workspaceId" FROM "SipConnection" UNION SELECT "workspaceId" FROM "SipRegionalLine" WHERE "deletedAt" IS NULL
  ) w JOIN "Organization" o ON o."id"=w."workspaceId" WHERE o."deletedAt" IS NULL ORDER BY w."workspaceId"`);
  for (const row of workspaces) {
    if (stopping) break;
    await collectWorkspace(String(row.workspaceId)).catch(() => console.warn('[voice-operations] workspace observation unavailable'));
  }
}
export function startVoiceOperationsMonitor() {
  if (timer) return;
  stopping = false;
  const run = () => {
    if (stopping || running) return;
    running = collectAll().catch(() => console.warn('[voice-operations] monitoring temporarily unavailable')).finally(() => { running = undefined; });
  };
  timer = setInterval(run, 30000); timer.unref(); run();
}
export async function stopVoiceOperationsMonitor() {
  stopping = true; if (timer) clearInterval(timer); timer = undefined; await running;
}
