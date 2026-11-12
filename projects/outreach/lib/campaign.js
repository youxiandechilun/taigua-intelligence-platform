'use strict';
/**
 * 群发调度：多账号轮换 + 单号日限 + 随机间隔 + 失败换号 + 断点续发
 * 任务落库（db.campaigns），服务重启后未完成的任务可继续。
 */
import EventEmitter from 'events';
import store from './store.js';
import wa from './wa.js';
import mail from './mail.js';

const bus = new EventEmitter();
const MOCK = String(process.env.WA_MOCK || '0') === '1';
const timers = new Map(); // id -> timeout
const running = new Set();

/* ---------------- 模板变量 ---------------- */

function render(text, t, ctx = {}) {
  const d = store.get();
  const c = d.kb.company || {};
  const sender = ctx.sender || 'Sales Team';
  const vars = {
    name: t.name || (t.co ? 'there' : 'there'),
    co: t.co || '',
    country: t.country || '',
    product: (d.kb.products[0] && d.kb.products[0].name) || c.products || '',
    company: c.name || '',
    sender,
    website: c.website || '',
    moq: (d.kb.products[0] && d.kb.products[0].moq) || '',
    days: '25',
  };
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

/* ---------------- 账号选择（轮换） ---------------- */

function pickAccount(camp, from = 0) {
  const sendCfg = store.get().settings.send;
  const ids = (camp.accountIds || []).filter(Boolean);
  if (!ids.length) return null;
  const n = ids.length;
  for (let i = 0; i < n; i += 1) {
    const id = ids[(from + i) % n];
    if (camp.channel === 'wa') {
      const s = wa.get(id);
      if (!s || s.status !== 'online') continue;
      if (wa.sentToday(id) >= (sendCfg.waDailyLimit || 40)) continue;
      return id;
    }
    const a = mail.get(id);
    if (!a) continue;
    if (mail.sentToday(id) >= (a.dailyLimit || sendCfg.mailDailyLimit || 200)) continue;
    return id;
  }
  return null;
}

function intervalMs(camp) {
  if (MOCK) return 600;
  const c = store.get().settings.send;
  const min = camp.channel === 'wa' ? c.waIntervalMin : c.mailIntervalMin;
  const max = camp.channel === 'wa' ? c.waIntervalMax : c.mailIntervalMax;
  const lo = Math.max(1, Number(camp.intervalMin || min) || 20);
  const hi = Math.max(lo, Number(camp.intervalMax || max) || lo + 20);
  return (lo + Math.random() * (hi - lo)) * 1000;
}

/* ---------------- 发送记录 ---------------- */

function record(camp, target, accountId, status, extra = {}) {
  const d = store.get();
  const rec = {
    id: store.nextId('sd'),
    campaignId: camp.id,
    campaignName: camp.name,
    channel: camp.channel,
    accountId: accountId || '',
    to: target.to || target.email || '',
    name: target.name || target.co || '',
    co: target.co || '',
    country: target.country || '',
    status,
    day: store.todayKey(),
    ts: Date.now(),
    readAt: 0,
    repliedAt: 0,
    error: extra.error || '',
    externalId: extra.externalId || '',
    trackId: extra.trackId || '',
    subject: extra.subject || '',
  };
  d.sends.push(rec);
  if (d.sends.length > store.LIMITS.sends) d.sends = d.sends.slice(-store.LIMITS.sends);
  store.save();
  return rec;
}

/** 30 天内同目标不重复发（避免骚扰被举报） */
function alreadySent(channel, to, days = 30) {
  const since = Date.now() - days * 86400000;
  const key = String(to || '').replace(/[^\d@.a-zA-Z]/g, '').toLowerCase();
  return store.get().sends.some((s) => {
    if (s.ts < since) return false;
    if (s.channel !== channel) return false;
    if (s.status !== 'sent') return false;
    const k = String(s.to || '').replace(/[^\d@.a-zA-Z]/g, '').toLowerCase();
    return k && (k === key || k.endsWith(key) || key.endsWith(k));
  });
}

/* ---------------- 创建 / 控制 ---------------- */

function create(opt) {
  const channel = opt.channel === 'mail' ? 'mail' : 'wa';
  const targets = (Array.isArray(opt.targets) ? opt.targets : [])
    .map((t) => ({
      to: String(t.to || t.email || t.phone || '').replace(/^\+/, '').trim(),
      name: t.name || t.person || '',
      co: t.co || '',
      country: t.country || '',
      leadId: t.leadId || '',
    }))
    .filter((t) => t.to);
  if (!targets.length) throw new Error('没有有效收件人（缺少邮箱或号码）');
  if (!String(opt.text || '').trim()) throw new Error('消息内容为空');

  const camp = {
    id: store.nextId('c'),
    name: String(opt.name || '').trim() || `${channel === 'wa' ? 'WhatsApp' : '邮件'}开发信 ${new Date().toLocaleDateString('zh-CN')}`,
    channel,
    subject: channel === 'mail' ? String(opt.subject || 'Cooperation proposal').trim() : '',
    text: String(opt.text || ''),
    accountIds: (opt.accountIds || []).filter(Boolean),
    targets,
    intervalMin: Number(opt.intervalMin) || 0,
    intervalMax: Number(opt.intervalMax) || 0,
    status: opt.approved === true ? 'running' : 'pending_approval',
    cursor: 0,
    turn: 0,
    stats: { sent: 0, failed: 0, skipped: 0, total: targets.length },
    log: [],
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
    baseUrl: opt.baseUrl || '',
    /* 定时定量批量：每批发 size 个，休息 hours 小时再发下一批（null = 一次发完） */
    batch: (() => {
      const s = Math.max(1, Number(opt.batchSize) || 0);
      const h = Math.max(1 / 60, Number(opt.batchHours) || 0); // 最小 1 分钟
      return s && h && s < targets.length ? { size: s, hours: h } : null;
    })(),
    batchSent: 0,
    nextBatchAt: 0,
  };
  if (!camp.accountIds.length) throw new Error('请至少选择一个发送账号');

  store.get().campaigns.push(camp);
  store.saveNow();
  if (camp.status === 'running') run(camp.id);
  return camp;
}

function get(id) {
  return store.get().campaigns.find((c) => c.id === id);
}

function view(c) {
  if (!c) return null;
  const per = c.stats.total ? Math.round(((c.stats.sent + c.stats.failed + c.stats.skipped) / c.stats.total) * 100) : 0;
  return { ...c, percent: Math.min(100, per) };
}

function list(limit = 50) {
  const arr = store.get().campaigns.slice();
  return arr.slice(-limit).reverse().map(view);
}

function stop(id) {
  const c = get(id);
  if (!c) throw new Error('任务不存在');
  c.status = 'stopped';
  c.finishedAt = Date.now();
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  running.delete(id);
  store.saveNow();
  bus.emit('change');
  return view(c);
}

function pause(id) {
  const c = get(id);
  if (!c) throw new Error('任务不存在');
  if (c.status !== 'running') return view(c);
  c.status = 'paused';
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  running.delete(id);
  store.saveNow();
  bus.emit('change');
  return view(c);
}

function resume(id) {
  const c = get(id);
  if (!c) throw new Error('任务不存在');
  if (c.status === 'running') return view(c);
  c.status = 'running';
  store.saveNow();
  run(id);
  return view(c);
}

/* ---------------- 执行循环 ---------------- */

async function run(id) {
  if (running.has(id)) return;
  const camp = get(id);
  if (!camp || camp.status !== 'running') return;
  running.add(id);

  const step = async () => {
    const c = get(id);
    if (!c || c.status !== 'running') {
      running.delete(id);
      timers.delete(id);
      return;
    }

    if (c.cursor >= c.targets.length) {
      c.status = 'done';
      c.finishedAt = Date.now();
      running.delete(id);
      store.saveNow();
      bus.emit('change');
      return;
    }

    // 定时定量：本批发满后休息 hours 小时再发下一批
    if (c.batch && c.batchSent >= c.batch.size && c.cursor < c.targets.length) {
      const waitMs = Math.round(c.batch.hours * 3600 * 1000);
      c.batchSent = 0;
      c.nextBatchAt = Date.now() + waitMs;
      const waitTxt = c.batch.hours >= 1 ? `${c.batch.hours} 小时` : `${Math.round(c.batch.hours * 60)} 分钟`;
      c.log.push({ ts: Date.now(), to: '', status: 'batch-wait', error: `本批 ${c.batch.size} 个已发完，${waitTxt}后自动发下一批` });
      store.saveNow();
      bus.emit('change');
      timers.set(id, setTimeout(step, waitMs));
      return;
    }

    // 每发 N 条换一个号
    const perRound = Math.max(1, Number(store.get().settings.send.waPerRound) || 1);
    const accountId = pickAccount(c, Math.floor(c.cursor / perRound));
    const target = c.targets[c.cursor];

    if (!accountId) {
      // 没有可用账号：暂停而不是失败，等账号恢复/次日额度重置
      c.status = 'paused';
      c.log.push({ ts: Date.now(), to: target.to, status: 'paused', error: '没有可用账号（未在线或已达日限）' });
      running.delete(id);
      store.saveNow();
      bus.emit('change');
      return;
    }

    c.cursor += 1;
    const toKey = c.channel === 'mail' ? target.to : String(target.to).replace(/\D/g, '');

    if (alreadySent(c.channel, toKey)) {
      c.stats.skipped += 1;
      c.log.push({ ts: Date.now(), to: toKey, status: 'skipped', error: '30 天内已发过' });
      store.save();
      bus.emit('change');
      timers.set(id, setTimeout(step, 60));
      return;
    }

    const attempt = async (acc) => {
      if (c.channel === 'wa') {
        const r = await wa.send(acc, toKey, render(c.text, target), c.id + ':' + (c.cursor - 1));
        record(c, { ...target, to: toKey }, acc, 'sent', { externalId: r.id });
      } else {
        const text = render(c.text, target);
        const trackId = store.nextId('sd');
        const r = await mail.send(acc, {
          to: toKey,
          requestId: c.id + ':' + (c.cursor - 1),
          subject: render(c.subject, target),
          text,
          html: text,
          sendId: trackId,
          baseUrl: c.baseUrl,
        });
        record(c, { ...target, to: toKey }, acc, 'sent', { externalId: r.messageId, trackId });
      }
    };

    let ok = false;
    let errMsg = '';
    let usedAccount = accountId;
    try {
      await attempt(accountId);
      ok = true;
    } catch (e) {
      errMsg = e.message;
      // 失败换号重试一次（单号被限制时换另一个号接着发）
      if (store.get().settings.send.retrySwitch) {
        const alt = pickAccount(c, Math.floor(c.cursor / perRound) + 1);
        if (alt && alt !== accountId) {
          try {
            await attempt(alt);
            ok = true;
            usedAccount = alt;
          } catch (e2) {
            errMsg += ' / 换号后仍失败：' + e2.message;
          }
        }
      }
    }

    if (ok) {
      c.stats.sent += 1;
      if (c.batch) c.batchSent += 1;
    } else {
      c.stats.failed += 1;
      record(c, { ...target, to: toKey }, usedAccount, 'failed', { error: errMsg });
    }

    c.log.push({ ts: Date.now(), to: toKey, status: ok ? 'sent' : 'failed', accountId: usedAccount, error: ok ? '' : errMsg });
    if (c.log.length > 300) c.log = c.log.slice(-200);
    store.save();
    bus.emit('change');

    if (c.status === 'running') timers.set(id, setTimeout(step, intervalMs(c)));
  };

  timers.set(id, setTimeout(step, 300));
}

/** 服务重启后恢复未完成的任务 */
function restore() {
  for (const c of store.get().campaigns) {
    if (c.status === 'running') {
      c.status = 'paused';
      c.log.push({ ts: Date.now(), to: '', status: 'paused', error: '服务重启，任务已暂停，可手动继续' });
    }
  }
  store.save();
}

export default { bus, create, list, get, view, stop, pause, resume, record, alreadySent, render, restore, pickAccount };
