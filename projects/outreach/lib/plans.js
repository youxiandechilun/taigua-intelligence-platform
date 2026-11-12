'use strict';
/**
 * 自动搜索计划（全自动无人值守）
 *
 * 一个计划 = 关键词 + 国家 + 条数 + 频率（每 N 小时跑一次）+ 是否搜完自动发信。
 * 调度器每分钟检查一次，到点就自动开一个 AI 搜索任务，跑完自动去重入库、按批次定时发信。
 * 进度统一在「任务进度」页看，不需要人点任何按钮。
 */
import store from './store.js';
import aiSearch from './ai-search.js';

const TICK_MS = 60 * 1000;

function all() {
  const db = store.get();
  if (!Array.isArray(db.searchPlans)) db.searchPlans = [];
  return db.searchPlans;
}

function pickHours(v) {
  // 最小 1 分钟（1/60 小时），最大 7 天；支持小数，如 0.25 = 15 分钟
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 6;
  return Math.min(168, Math.max(1 / 60, n));
}

/* 按单位换算成小时：unit 'min' = 分钟，'hour' = 小时（默认） */
function toHours(v, unit) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return String(unit) === 'min' ? n / 60 : n;
}

function create(input) {
  const plan = {
    id: store.nextId('pl'),
    name: String(input.name || '').trim() || `${String(input.keyword || '').trim()}`,
    keyword: String(input.keyword || '').trim(),
    country: String(input.country || '').trim() || '美国',
    audience: input.audience || 'all',
    limit: Math.min(100, Math.max(5, Number(input.limit) || 30)),
    save: input.save !== false,
    autoSend: input.autoSend === true || input.autoSend === 1 || input.autoSend === '1',
    sendChannel: input.sendChannel === 'wa' ? 'wa' : 'mail',
    batchSize: Math.max(1, Number(input.batchSize) || 10),
    batchHours: pickHours(toHours(input.batchHours, input.batchUnit) || 3),
    mailSubject: String(input.mailSubject || '').trim(),
    mailText: String(input.mailText || '').trim(),
    intervalHours: pickHours(toHours(input.intervalHours, input.intervalUnit) || 6),
    enabled: input.enabled !== false,
    createdAt: Date.now(),
    lastRunAt: 0,
    lastJobId: '',
    runs: 0,
    nextRunAt: 0,
  };
  plan.nextRunAt = Date.now() + plan.intervalHours * 3600 * 1000;
  if (!plan.keyword) throw new Error('请填写关键词（产品 / 行业）');
  all().unshift(plan);
  store.save();
  return plan;
}

function update(id, patch) {
  const p = all().find((x) => x.id === id);
  if (!p) throw new Error('计划不存在');
  for (const k of ['name', 'keyword', 'country', 'audience', 'mailSubject', 'mailText']) {
    if (patch[k] !== undefined) p[k] = String(patch[k]).trim();
  }
  for (const k of ['limit', 'batchSize']) {
    if (patch[k] !== undefined) p[k] = Number(patch[k]) || p[k];
  }
  if (patch.limit !== undefined) p.limit = Math.min(100, Math.max(5, Number(patch.limit) || 30));
  if (patch.batchSize !== undefined) p.batchSize = Math.max(1, Number(patch.batchSize) || 10);
  if (patch.batchHours !== undefined) {
    const h = toHours(patch.batchHours, patch.batchUnit) || Number(patch.batchHours) || p.batchHours;
    p.batchHours = pickHours(h);
  }
  if (patch.intervalHours !== undefined) {
    const h = toHours(patch.intervalHours, patch.intervalUnit) || Number(patch.intervalHours) || p.intervalHours;
    p.intervalHours = pickHours(h);
  }
  if (patch.sendChannel !== undefined) p.sendChannel = patch.sendChannel === 'wa' ? 'wa' : 'mail';
  if (patch.autoSend !== undefined) p.autoSend = patch.autoSend === true || patch.autoSend === 1 || patch.autoSend === '1';
  if (patch.enabled !== undefined) {
    p.enabled = patch.enabled === true || patch.enabled === 1 || patch.enabled === '1';
    if (p.enabled) p.nextRunAt = Math.max(Date.now(), p.nextRunAt || 0);
  }
  store.save();
  return p;
}

function remove(id) {
  const db = store.get();
  db.searchPlans = all().filter((x) => x.id !== id);
  store.save();
  return true;
}

/* 立即执行一次（不影响下一次定时时间） */
async function runOne(plan) {
  try {
    const jobId = await aiSearch.start({
      requestId: plan.id + ':' + (plan.runs || 0),
      keyword: plan.keyword,
      country: plan.country,
      audience: plan.audience,
      limit: plan.limit,
      save: plan.save,
      autoSend: plan.autoSend,
      sendChannel: plan.sendChannel,
      mailSubject: plan.mailSubject,
      mailText: plan.mailText,
      batchSize: plan.batchSize,
      batchHours: plan.batchHours,
    });
    plan.lastRunAt = Date.now();
    plan.lastJobId = jobId;
    plan.runs = (plan.runs || 0) + 1;
    return jobId;
  } catch (e) {
    plan.lastError = e.message;
    plan.lastRunAt = Date.now();
    return '';
  }
}

async function runNow(id) {
  const p = all().find((x) => x.id === id);
  if (!p) throw new Error('计划不存在');
  const jobId = await runOne(p);
  if (!jobId) throw new Error(p.lastError || '启动失败');
  store.save();
  return jobId;
}

async function tickTenant() {
  const now = Date.now();
  let changed = false;
  for (const p of all()) {
    if (!p.enabled) continue;
    if (!p.nextRunAt) {
      p.nextRunAt = now + p.intervalHours * 3600 * 1000;
      changed = true;
      continue;
    }
    if (p.nextRunAt <= now) {
      await runOne(p);
      p.nextRunAt = now + p.intervalHours * 3600 * 1000;
      changed = true;
      console.log('[plans] 已执行一项到期检索计划');
    }
  }
  if (changed) store.save();
}

async function tick() {
  for (const tenant of store.listTenants()) {
    await store.runTenant(tenant.mid, tickTenant);
  }
}

let timer = null;

function boot() {
  if (timer) return;
  // 启动后 20 秒做第一次检查，避免和启动流程抢资源
  setTimeout(() => tick().catch(() => {}), 20 * 1000);
  timer = setInterval(() => tick().catch(() => {}), TICK_MS);
  if (timer.unref) timer.unref();
}

export default { list: all, create, update, remove, runNow, tick, boot };
