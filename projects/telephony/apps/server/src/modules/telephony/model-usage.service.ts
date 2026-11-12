/*
 * 中文导读：记录通话关联的供应商模型用量，供费用和看板汇总。
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import { crmDb } from '../crm/crm.db.js';
import type { Scope, CrmDb, Row } from '../crm/crm.service.js';
import { companyContext } from '../workspace/company-access.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { modelKey } from './model-credentials.js';
import { modelPlatforms, type ModelPlatformId } from './model-platforms.js';
import { collectModelBalance, balanceIdentity, billingCredentialConfigured, billingCredentialSchema, type ModelBalance } from './model-balances.js';
import { encryptSecretValue } from '../../lib/secrets.js';

const providerSchema = z.enum(['qwen', 'stepfun', 'deepseek', 'zhipu']);
const accountSchema = z.object({
  balanceSource: z.enum(['auto', 'manual']).default('auto'),
  manualBalance: z.number().finite().min(-1e9).max(1e9).nullable().default(null),
  currency: z.enum(['CNY', 'USD', 'JPY']).default('CNY'),
  lowBalanceThreshold: z.number().finite().min(0).max(1e9).nullable().default(50),
  monthlyTokenLimit: z.number().int().min(1).max(1e12).nullable().default(null),
  tokenWarningPercent: z.number().int().min(1).max(100).default(80),
  alertsEnabled: z.boolean().default(true),
}).strict();
const defaults = (provider: string) => accountSchema.parse(provider === 'zhipu' ? { balanceSource: 'manual' } : {});
const iso = (v: unknown) => v ? new Date(v as string | Date).toISOString() : null;
function periods() {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { today, month: today.slice(0, 7), dayStart: new Date(today + 'T00:00:00+08:00'), monthStart: new Date(today.slice(0, 7) + '-01T00:00:00+08:00') };
}
const sum = (rows: Row[], field: string) => rows.reduce((total, r) => total + Number(r[field] || 0), 0);
async function accounts(workspaceId: string, db: CrmDb = crmDb) {
  const p = periods();
  const [saved, usage, coverage] = await Promise.all([
    db.query('SELECT * FROM "WorkspaceModelAccount" WHERE "workspaceId"=$1', [workspaceId]),
    db.query(`SELECT "provider","modelId","purpose",SUM("inputTokens")::text AS "inputTokens",SUM("outputTokens")::text AS "outputTokens",SUM("totalTokens")::text AS "totalTokens",SUM("inputAudioTokens")::text AS "inputAudioTokens",SUM("outputAudioTokens")::text AS "outputAudioTokens",SUM("cachedTokens")::text AS "cachedTokens",SUM("requests")::int AS "requests",SUM("missingUsage")::int AS "missingUsage",COALESCE(SUM("totalTokens") FILTER (WHERE "createdAt">=$3),0)::text AS "todayTokens",MAX("updatedAt") AS "lastUsageAt" FROM "ModelUsageRecord" WHERE "workspaceId"=$1 AND "createdAt">=$2 GROUP BY "provider","modelId","purpose"`, [workspaceId, p.monthStart, p.dayStart]),
    db.query(`SELECT finished_at AS "startedAt" FROM "_prisma_migrations" WHERE migration_name='20261016090000_model_usage_alerts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`),
  ]);
  const values = await Promise.all(modelPlatforms.map(async platform => {
    const row = saved.find(r => r.provider === platform.id), settings = row ? accountSchema.parse(row.settings) : defaults(platform.id);
    const configured = !!await modelKey(workspaceId, platform.key).catch(() => '');
    const fingerprint = settings.balanceSource === 'auto' && row?.balances ? await balanceIdentity(workspaceId, platform.id).catch(() => '') : '';
    const matches = !!fingerprint && row?.balanceFingerprint === fingerprint;
    const balances: ModelBalance[] = settings.balanceSource === 'manual' ? settings.manualBalance === null ? [] : [{ currency: settings.currency, available: settings.manualBalance }] : matches && Array.isArray(row?.balances) ? row.balances : [];
    const checkedAt = settings.balanceSource === 'manual' ? iso(row?.manualBalanceAt) : matches ? iso(row?.balanceCheckedAt) : null;
    const stale = !!checkedAt && (settings.balanceSource === 'auto' ? Date.now() - Date.parse(checkedAt) > 15 * 60000 : Date.now() - Date.parse(checkedAt) > 24 * 3600000);
    const rows = usage.filter(r => r.provider === platform.id), totalTokens = sum(rows, 'totalTokens');
    return { id: platform.id, name: platform.name, configured, automaticBalance: platform.balance !== 'manual', billingUrl: platform.billingUrl, settings, balanceCredentialsConfigured: platform.id === 'qwen' ? await billingCredentialConfigured(workspaceId) : false, balances, balanceCheckedAt: checkedAt, balanceStale: stale, balanceError: settings.balanceSource === 'manual' ? '' : row?.balanceError || '', balanceAttemptedAt: iso(row?.balanceAttemptedAt), balanceScope: platform.id === 'qwen' ? '阿里云账户可用额度（含其他云产品）' : '平台账户可用余额', month: p.month, todayTokens: sum(rows, 'todayTokens'), totalTokens, inputTokens: sum(rows, 'inputTokens'), outputTokens: sum(rows, 'outputTokens'), inputAudioTokens: sum(rows, 'inputAudioTokens'), outputAudioTokens: sum(rows, 'outputAudioTokens'), cachedTokens: sum(rows, 'cachedTokens'), requests: sum(rows, 'requests'), missingUsage: sum(rows, 'missingUsage'), remainingBudget: settings.monthlyTokenLimit === null ? null : Math.max(0, settings.monthlyTokenLimit - totalTokens), models: rows.map(r => ({ modelId: r.modelId as string, purpose: r.purpose as string, totalTokens: r.totalTokens === null ? null : Number(r.totalTokens), inputTokens: r.inputTokens === null ? null : Number(r.inputTokens), outputTokens: r.outputTokens === null ? null : Number(r.outputTokens), requests: Number(r.requests), missingUsage: Number(r.missingUsage) })) };
  }));
  return { platforms: values, trackingSince: iso(coverage[0]?.startedAt), updatedAt: new Date().toISOString() };
}
export async function modelUsageCatalog(s: Scope) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('模型用量和平台余额由系统超级管理员查看。');
  return accounts(s.workspaceId);
}
export async function saveBillingCredentials(s: Scope, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('仅系统超级管理员可以配置余额查询授权。');
  const credentials = billingCredentialSchema.parse(input);
  await crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['model-balance:' + s.workspaceId + ':qwen']);
    await db.query(`INSERT INTO "WorkspaceModelAccount" ("workspaceId","provider","settings","billingCredentials") VALUES ($1,'qwen',$2::jsonb,$3) ON CONFLICT ("workspaceId","provider") DO UPDATE SET "billingCredentials"=EXCLUDED."billingCredentials","balances"=NULL,"balanceFingerprint"='',"balanceCheckedAt"=NULL,"balanceAttemptedAt"=NULL,"balanceError"='',"updatedAt"=NOW() RETURNING "provider"`, [s.workspaceId, JSON.stringify(defaults('qwen')), encryptSecretValue(JSON.stringify(credentials))]);
  });
  await prisma.auditLog.create({ data: { organizationId: s.workspaceId, userId: s.userId, action: 'MODEL_BALANCE_CREDENTIAL_SAVED', resourceType: 'WorkspaceModelAccount', resourceId: 'qwen', metadata: { provider: 'qwen' } } });
  return refreshModelAccounts(s, 'qwen');
}
export async function evaluateModelAlerts(workspaceId: string) {
  const data = await accounts(workspaceId);
  for (const p of data.platforms) {
    const s = p.settings, balance = p.balances.find(b => b.currency === s.currency);
    const conditions = [
      { kind: 'BALANCE', active: s.lowBalanceThreshold !== null && !!balance && balance.available <= s.lowBalanceThreshold, title: p.name + '余额不足', message: balance ? `${p.balanceScope}为 ${balance.available.toFixed(2)} ${balance.currency}，已达到预警线 ${s.lowBalanceThreshold}。${p.balanceStale ? '余额数据已较久未更新，请刷新核对。' : ''}${s.balanceSource === 'manual' ? '当前为手动记录的余额，请到官方账单核对。' : ''}` : '' },
      { kind: 'TOKENS', active: s.monthlyTokenLimit !== null && p.totalTokens >= s.monthlyTokenLimit * s.tokenWarningPercent / 100, title: p.name + '本月用量提醒', message: `${p.month} 本系统已记录 ${p.totalTokens.toLocaleString('zh-CN')} Token，月度提醒额度 ${s.monthlyTokenLimit?.toLocaleString('zh-CN')} Token。${p.missingUsage ? '另有未返回用量的调用，实际消耗可能更高。' : ''}` },
      { kind: 'BALANCE_SYNC', active: s.lowBalanceThreshold !== null && (!balance || p.balanceStale || !!p.balanceError), title: p.name + (p.id === 'qwen' && s.balanceSource === 'auto' && !p.balanceCredentialsConfigured ? '余额待授权' : '余额待核对'), message: s.balanceSource === 'manual' ? '余额采用手动维护，请更新余额后核对预警。' : p.balanceError || (p.balanceStale ? '最近余额数据已过时，请刷新后核对。' : '尚未取得当前账户余额，请刷新或手动记录。') },
    ];
    for (const c of conditions) {
      const active = s.alertsEnabled && p.configured && c.active;
      if (!active) { await crmDb.query('UPDATE "ModelUsageAlert" SET "active"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "provider"=$2 AND "kind"=$3 AND "active"=true RETURNING "id"', [workspaceId, p.id, c.kind]); continue; }
      const id = createHash('sha256').update(workspaceId + ':' + p.id + ':' + c.kind).digest('hex');
      await crmDb.query(`INSERT INTO "ModelUsageAlert" ("id","workspaceId","provider","kind","title","message") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("workspaceId","provider","kind") DO UPDATE SET "title"=EXCLUDED."title","message"=EXCLUDED."message","triggeredAt"=CASE WHEN "ModelUsageAlert"."active" THEN "ModelUsageAlert"."triggeredAt" ELSE NOW() END,"active"=true,"updatedAt"=NOW() RETURNING "id"`, [id, workspaceId, p.id, c.kind, c.title, c.message]);
    }
  }
}
export async function modelUsageAlerts(s: Scope) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) return { alerts: [], updatedAt: new Date().toISOString() };
  await evaluateModelAlerts(s.workspaceId);
  return { alerts: await crmDb.query('SELECT "id","provider","kind","title","message","triggeredAt" FROM "ModelUsageAlert" WHERE "workspaceId"=$1 AND "active"=true ORDER BY "triggeredAt" DESC', [s.workspaceId]), updatedAt: new Date().toISOString() };
}
export async function saveModelAccount(s: Scope, rawProvider: unknown, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('仅系统超级管理员可以设置模型额度与余额预警。');
  const provider = providerSchema.parse(rawProvider), settings = accountSchema.parse(input);
  if (provider === 'zhipu' && settings.balanceSource === 'auto') throw new BadRequestError('智谱暂未接入余额接口，请选择手动维护。');
  await crmDb.query(`INSERT INTO "WorkspaceModelAccount" ("workspaceId","provider","settings","manualBalanceAt") VALUES ($1,$2,$3::jsonb,CASE WHEN $4::boolean THEN NOW() ELSE NULL END) ON CONFLICT ("workspaceId","provider") DO UPDATE SET "manualBalanceAt"=EXCLUDED."manualBalanceAt","settings"=EXCLUDED."settings","updatedAt"=NOW() RETURNING "provider"`, [s.workspaceId, provider, JSON.stringify(settings), settings.manualBalance !== null]);
  await prisma.auditLog.create({ data: { organizationId: s.workspaceId, userId: s.userId, action: 'MODEL_USAGE_SETTINGS_SAVED', resourceType: 'WorkspaceModelAccount', resourceId: provider, metadata: { balanceSource: settings.balanceSource, alertsEnabled: settings.alertsEnabled } } });
  await evaluateModelAlerts(s.workspaceId);
  return modelUsageCatalog(s);
}
export async function refreshModelBalance(workspaceId: string, provider: ModelPlatformId) {
  return crmDb.transaction(async db => {
    const lock = (await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS locked', ['model-balance:' + workspaceId + ':' + provider]))[0];
    if (!lock?.locked) return;
    const row = (await db.query('SELECT * FROM "WorkspaceModelAccount" WHERE "workspaceId"=$1 AND "provider"=$2', [workspaceId, provider]))[0];
    if (row && accountSchema.parse(row.settings).balanceSource === 'manual') return;
    if (row?.balanceAttemptedAt && Date.now() - new Date(row.balanceAttemptedAt).getTime() < 60000) return;
    await db.query('INSERT INTO "WorkspaceModelAccount" ("workspaceId","provider","settings","balanceAttemptedAt") VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT ("workspaceId","provider") DO UPDATE SET "balanceAttemptedAt"=NOW() RETURNING "provider"', [workspaceId, provider, JSON.stringify(defaults(provider))]);
    try {
      const result = await collectModelBalance(workspaceId, provider);
      // Recheck after the network request in case an administrator changed keys.
      if (await balanceIdentity(workspaceId, provider) !== result.fingerprint) return;
      await db.query('UPDATE "WorkspaceModelAccount" SET "balances"=$3::jsonb,"balanceFingerprint"=$4,"balanceCheckedAt"=NOW(),"balanceError"=\'\' WHERE "workspaceId"=$1 AND "provider"=$2 RETURNING "provider"', [workspaceId, provider, JSON.stringify(result.balances), result.fingerprint]);
    } catch (e) {
      const message = e instanceof Error && !(e instanceof z.ZodError) && !e.message.includes('fetch') && !e.message.includes('abort') ? e.message : '平台余额暂时无法读取，请稍后刷新';
      // Only our bounded messages are stored. Provider payloads and credentials
      // never belong in billing errors, alerts, or audit metadata.
      const safe = ['余额查询未获授权，请核对平台密钥权限', '平台余额暂时无法读取，请稍后刷新', '需配置阿里云费用查询凭据，也可先手动维护余额', '阿里云费用查询未获授权，请核对只读账单权限', '请先配置平台密钥', '此平台暂未接入官方余额查询，请手动维护'].includes(message) ? message : '平台余额暂时无法读取，请稍后刷新';
      await db.query('UPDATE "WorkspaceModelAccount" SET "balanceError"=$3 WHERE "workspaceId"=$1 AND "provider"=$2 RETURNING "provider"', [workspaceId, provider, safe]);
    }
  });
}
export async function refreshModelAccounts(s: Scope, rawProvider: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('仅系统超级管理员可以刷新平台余额。');
  const provider = providerSchema.parse(rawProvider);
  await refreshModelBalance(s.workspaceId, provider);
  await evaluateModelAlerts(s.workspaceId);
  return modelUsageCatalog(s);
}
let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
async function tick() {
  const workspaces = await crmDb.query('SELECT "workspaceId" FROM "WorkspaceModelSettings" ORDER BY "workspaceId"');
  for (const w of workspaces) {
    for (const p of modelPlatforms.filter(p => p.balance !== 'manual')) {
      if (await modelKey(w.workspaceId, p.key).catch(() => '')) await refreshModelBalance(w.workspaceId, p.id);
    }
    await evaluateModelAlerts(w.workspaceId);
  }
}
export function startModelUsageMonitor() {
  if (timer) return;
  const run = () => { if (!running) running = tick().catch(() => console.warn('[model-usage] balance refresh delayed')).finally(() => { running = undefined; }); };
  timer = setInterval(run, 5 * 60000); timer.unref(); run();
}
export async function stopModelUsageMonitor() { if (timer) clearInterval(timer); timer = undefined; if (running) await running; }
