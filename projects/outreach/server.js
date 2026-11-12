import { validate as validatePlatformSession } from './lib/platform-client.js';
import { billable, reconcileBilling, recoverBilling, reviewOperation } from './lib/billing.js';
import { installAuthRoutes, sendError, requestToken } from './lib/auth-routes.js';
import { installRequestGuard } from './lib/request-guard.js';
import { installDomesticRoutes } from './lib/domestic-routes.js';
import { installChannelRoutes } from './lib/channel-routes.js';
import { pushCustomer } from './lib/crm-service.js';
'use strict';
/**
 * 私信拓客系统 —— 独立服务
 * 端口 WA_PORT（默认 8100）
 * 数据 data/db.json；WhatsApp 会话 data/sessions/
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import express from 'express';

import store from './lib/store.js';
import wa from './lib/wa.js';
import mail from './lib/mail.js';
import campaign from './lib/campaign.js';
import leads from './lib/leads.js';
import aiSearch from './lib/ai-search.js';
import plans from './lib/plans.js';
import replies from './lib/replies.js';
import llm from './lib/llm.js';

const PORT = Number(process.env.WA_PORT || 8100);
const AUTH_DISABLED = false;
const MOCK = String(process.env.WA_MOCK || '0') === '1';
const app = express();
app.use(express.json({ limit: '4mb', verify: (req, res, buffer) => { req.rawBody = buffer; } }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

/* =========================================================
   鉴权（顾客只用前端，口令在后端）
   ========================================================= */
installChannelRoutes(app);
installAuthRoutes(app);
installRequestGuard(app);
installDomesticRoutes(app);
app.post('/api/admin/password', (req, res) => {
  const next = String(req.body.next || '');
  if (next.length < 6) return res.status(400).json({ ok: false, error: '管理员口令至少 6 位' });
  const d = store.get();
  d.auth = d.auth || {};
  d.auth.admin = store.hashAdminPassword(next);
  store.saveNow();
  res.json({ ok: true });
});

/** 设置顾客端访问口令（只能管理员改，避免顾客把自己锁死） */
app.post('/api/admin/customer-password', (req, res) => {
  const next = String(req.body.next || '');
  if (next && next.length < 4) return res.status(400).json({ ok: false, error: '顾客口令至少 4 位' });
  const d = store.get();
  if (!next) {
    d.auth.password = '';
    d.auth.salt = '';
  } else {
    d.auth = { ...d.auth, ...store.hashPassword(next) };
  }
  store.saveNow();
  res.json({ ok: true, enabled: Boolean(next) });
});


app.get('/api/public/config', (req, res) => {
  const s = store.get().settings;
  res.json({
    ok: true,
    mock: MOCK,
    ai: Boolean(s.llm.enabled && s.llm.key && s.llm.baseUrl),
    aiModel: s.llm.model || '',
    search: Boolean(s.lead.searchKey),
    alertDays: (s.follow && s.follow.alertDays) || 7,
    consoleName: process.env.CONSOLE_NAME || '私信拓客控制台',
  });
});



/* =========================================================
   已读追踪像素
   ========================================================= */
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime(), mock: MOCK }));

app.get('/t/:sid.gif', (req, res) => {
  const sid = String(req.params.sid || '').replace(/\.gif$/, '');
  const d = store.getRoot();
  // 发送时 sid 与 sends.id 不同：这里按 externalId 前缀或单独字段匹配
  const rec = d.sends.find((s) => s.trackId === sid || s.id === sid || (s.externalId || '').includes(sid));
  if (rec && !rec.readAt) {
    rec.readAt = Date.now();
    store.save();
    campaign.bus.emit('change');
  }
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' });
  res.end(gif);
});

/* =========================================================
   SSE 实时推送
   ========================================================= */
const sseClients = new Set();

function overview() {
  const d = store.get();
  const day = store.todayKey();
  const s = store.statsOfDay(day);
  const waList = wa.list();
  const mailList = mail.list();
  const camps = campaign.list(200);
  const running = camps.filter((c) => c.status === 'running').length;

  // 累计口径（全部历史）
  const all = d.sends.reduce(
    (a, x) => {
      if (x.channel === 'wa') a.wa.total += 1;
      else a.mail.total += 1;
      if (x.status === 'sent') {
        if (x.channel === 'wa') a.wa.sent += 1;
        else a.mail.sent += 1;
      }
      if (x.status === 'failed') x.channel === 'wa' ? (a.wa.failed += 1) : (a.mail.failed += 1);
      if (x.readAt) x.channel === 'wa' ? (a.wa.read += 1) : (a.mail.read += 1);
      if (x.repliedAt) x.channel === 'wa' ? (a.wa.replied += 1) : (a.mail.replied += 1);
      return a;
    },
    { wa: { sent: 0, failed: 0, read: 0, replied: 0, total: 0 }, mail: { sent: 0, failed: 0, read: 0, replied: 0, total: 0 } }
  );

  return {
    today: s,
    allTime: all,
    wa: {
      total: waList.length,
      online: waList.filter((x) => x.status === 'online').length,
      started: waList.filter((x) => ['online', 'qr', 'starting', 'authenticated'].includes(x.status)).length,
      qr: waList.filter((x) => x.status === 'qr').length,
      error: waList.filter((x) => ['error', 'offline'].includes(x.status)).length,
    },
    mail: {
      total: mailList.length,
      ready: mailList.filter((x) => x.status === 'ready').length,
      error: mailList.filter((x) => x.status === 'error').length,
    },
    campaigns: { total: camps.length, running, paused: camps.filter((c) => c.status === 'paused').length, done: camps.filter((c) => c.status === 'done').length },
    leads: d.leads.length,
    replies: { total: d.replies.length, unread: replies.unreadCount(), today: d.replies.filter((r) => store.todayKey(r.ts) === day).length },
    customers: {
      total: d.customers.length,
      A: d.customers.filter((c) => c.grade === 'A').length,
      B: d.customers.filter((c) => c.grade === 'B').length,
      C: d.customers.filter((c) => c.grade === 'C').length,
    },
    followups: replies.followUps().length,
    authConfigured: store.authConfigured(),
    llm: llm.status(),
    lead: {
      mode: 'ai',
      aiConfigured: llm.cfg().enabled,
      searchConfigured: Boolean(store.get().settings.lead.searchKey),
      searchProvider: store.get().settings.lead.searchKey ? store.get().settings.lead.searchProvider || 'serper' : 'builtin',
      apiConfigured: Boolean(store.get().settings.lead.apiUrl && store.get().settings.lead.apiKey),
    },
  };
}

function broadcast() {
  for (const client of sseClients) {
    store.runTenant(client.mid, () => {
      try {
        if (!store.resolveSession(client.sid)) {
          client.response.end();
          sseClients.delete(client);
          return;
        }
        const payload = { ts: Date.now(), overview: overview(), wa: wa.list(), campaigns: campaign.list(20) };
        client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    });
  }
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('\n');
  res.write(`data: ${JSON.stringify({ ts: Date.now(), overview: overview(), wa: wa.list(), campaigns: campaign.list(20) })}\n\n`);
  const client = { mid: store.currentMid(), response: res, sid: requestToken(req) };
  sseClients.add(client);
  const ping = setInterval(async () => {
    try {
      const session = store.resolveSession(client.sid);
      if (!session) throw new Error('会话已失效');
      if (session.platformToken) await validatePlatformSession(session.platformToken);
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
      sseClients.delete(client);
      res.end();
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(client);
  });
});

wa.bus.on('change', broadcast);
campaign.bus.on('change', broadcast);

/* =========================================================
   看板
   ========================================================= */
app.get('/api/operations', (req, res) => res.json({ ok: true, data: store.get().billableOperations.map(({ id, requestId, action, status, createdAt }) => ({ id, requestId, action, status, createdAt })) }));
app.post('/api/operations/:id/review', async (req, res) => {
  try { res.json({ ok: true, data: await reviewOperation(req.params.id, req.body.outcome, req.body.note) }); }
  catch (error) { sendError(res, error); }
});
app.post('/api/customers/:id/push', async (req, res) => {
  try { res.json({ ok: true, data: await pushCustomer(req.params.id, req.body.owner, req.get('Idempotency-Key')) }); }
  catch (error) { sendError(res, error); }
});

app.get('/api/overview', (req, res) => res.json({ ok: true, ...overview() }));

/* =========================================================
   WhatsApp 账号
   ========================================================= */
app.get('/api/wa', (req, res) => res.json({ ok: true, accounts: wa.list(), mock: MOCK }));

app.post('/api/wa', async (req, res) => {
  try {
    const s = await wa.create(req.body.label);
    broadcast();
    res.json({ ok: true, account: s });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/wa/:id/start', async (req, res) => {
  try {
    const s = await wa.start(req.params.id);
    broadcast();
    res.json({ ok: true, account: s });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/wa/:id/stop', async (req, res) => {
  try {
    await wa.stop(req.params.id, false);
    broadcast();
    res.json({ ok: true, accounts: wa.list() });
  } catch (error) { sendError(res, error); }
});

app.delete('/api/wa/:id', async (req, res) => {
  try {
    await wa.stop(req.params.id, true);
    broadcast();
    res.json({ ok: true, accounts: wa.list() });
  } catch (error) { sendError(res, error); }
});

app.post('/api/wa/:id/mock-online', async (req, res) => {
  try {
    const s = await wa.mockOnline(req.params.id);
    broadcast();
    res.json({ ok: true, account: s });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/wa/:id/chats', async (req, res) => {
  try {
    res.json({ ok: true, chats: await wa.chats(req.params.id) });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/wa/:id/send', async (req, res) => {
  try {
    const r = await wa.send(req.params.id, req.body.to, String(req.body.text || ''), req.get('Idempotency-Key'));
    res.json({ ok: true, ...r });
  } catch (e) {
    sendError(res, e);
  }
});

/* =========================================================
   邮箱账号
   ========================================================= */
app.get('/api/mail', (req, res) => res.json({ ok: true, accounts: mail.list(), mock: MOCK }));

app.post('/api/mail/test', async (req, res) => {
  try {
    res.json({ ok: true, result: await mail.testConn(req.body || {}) });
  } catch (e) {
    res.json({ ok: true, result: { ok: false, error: e.message } });
  }
});

app.post('/api/mail', async (req, res) => {
  try {
    const a = await mail.create(req.body || {});
    broadcast();
    res.json({ ok: true, account: a });
  } catch (e) {
    sendError(res, e);
  }
});

app.put('/api/mail/:id', (req, res) => {
  try {
    res.json({ ok: true, account: mail.update(req.params.id, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

app.delete('/api/mail/:id', (req, res) => {
  mail.remove(req.params.id);
  broadcast();
  res.json({ ok: true, accounts: mail.list() });
});

app.post('/api/mail/:id/check', async (req, res) => {
  try {
    const list0 = await mail.fetchReplies(req.params.id);
    const added = [];
    for (const r of list0) {
      const acc = mail.get(req.params.id);
      const rep = replies.handleIncoming({ channel: 'mail', accountId: acc.id, accountLabel: acc.label, ...r });
      if (rep) added.push(rep);
    }
    broadcast();
    res.json({ ok: true, fetched: list0.length, added: added.length, replies: added });
  } catch (e) {
    res.status(400).json({ ok: false, error: '收信失败：' + e.message });
  }
});

app.post('/api/mail/:id/send', async (req, res) => {
  try {
    const r = await mail.send(req.params.id, {
      to: req.body.to,
      subject: req.body.subject,
      text: req.body.text,
      baseUrl: req.body.baseUrl,
      sendId: store.nextId('sd'),
      requestId: req.get('Idempotency-Key'),
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    sendError(res, e);
  }
});

/* =========================================================
   AI 在线搜索（任务中心 · 找线索）
   异步任务：POST 建任务 → 前端轮询进度 → 结果直接可用
   ========================================================= */
app.get('/api/ai/health', (req, res) => res.json({ ok: true, ...aiSearch.health() }));

/* ---------------- 管理后台专用 ---------------- */
app.get('/api/admin/storage', (req, res) => {
  let dbSize = 0;
  try {
    dbSize = fs.statSync(store.DB_FILE).size;
  } catch {}
  let sessions = 0;
  try {
    sessions = fs.readdirSync(store.SESSIONS_DIR).filter((x) => !x.startsWith('.')).length;
  } catch {}
  res.json({
    ok: true,
    dbFile: 'db.json',
    dbSize,
    sessionsDir: 'sessions',
    sessions,
    uptime: process.uptime(),
    node: process.version,
    mock: MOCK,
  });
});

/** 测试检索通道（后台按钮） */
app.post('/api/ai/test-search', async (req, res) => {
  const t0 = Date.now();
  try {
    const hits = await leads.searchWeb('stainless steel hinge importer Germany contact email', 3);
    if (!hits.length) throw new Error('检索返回空结果，可能是网络受限或密钥无效');
    res.json({ ok: true, count: hits.length, ms: Date.now() - t0, sample: hits[0] });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/ai/search', async (req, res) => {
  try {
    const id = await aiSearch.start({
      requestId: req.get('Idempotency-Key'),
      keyword: req.body.keyword,
      country: req.body.country,
      limit: req.body.limit,
      audience: req.body.audience,
      save: req.body.save !== false,
      autoSend: req.body.autoSend,
      sendChannel: req.body.sendChannel,
      mailSubject: req.body.mailSubject,
      mailText: req.body.mailText,
      batchSize: req.body.batchSize,
      batchHours: req.body.batchHours,
    });
    broadcast();
    res.json({ ok: true, jobId: id, job: aiSearch.get(id) });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/ai/search/latest', (req, res) => {
  const j = aiSearch.latest();
  res.json({ ok: true, job: j });
});

/* 全部搜索任务（任务进度页用） */
app.get('/api/ai/jobs', (req, res) => {
  res.json({ ok: true, jobs: aiSearch.list(Number(req.query.limit) || 30) });
});

/* ---------- 自动搜索计划（全自动无人值守） ---------- */
app.get('/api/plans', (req, res) => {
  res.json({ ok: true, plans: plans.list() });
});

app.post('/api/plans', (req, res) => {
  try {
    const p = plans.create(req.body || {});
    res.json({ ok: true, plan: p });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/plans/:id', (req, res) => {
  try {
    res.json({ ok: true, plan: plans.update(req.params.id, req.body || {}) });
  } catch (e) {
    sendError(res, e);
  }
});

app.delete('/api/plans/:id', (req, res) => {
  try {
    plans.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/plans/:id/run', async (req, res) => {
  try {
    const jobId = await plans.runNow(req.params.id);
    broadcast();
    res.json({ ok: true, jobId, job: aiSearch.get(jobId) });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/ai/search/:id', (req, res) => {
  const j = aiSearch.get(req.params.id);
  if (!j) return res.status(404).json({ ok: false, error: '任务不存在或已过期' });
  res.json({ ok: true, job: j });
});

/* 旧接口保留（早期调用方 / /simple.html 仍可用） */
app.post('/api/leads/search', async (req, res) => {
  try {
    const searchInput = { keyword: req.body.keyword, country: req.body.country, limit: req.body.limit, mode: req.body.mode };
    const r = await billable('lead_search', req.get('Idempotency-Key') || store.nextId('search-'), searchInput, () => leads.search({
      keyword: req.body.keyword,
      country: req.body.country,
      limit: req.body.limit,
      mode: req.body.mode,
    }));
    let saved = 0;
    if (req.body.save !== false) saved = leads.saveLeads(r.results);
    broadcast();
    res.json({ ok: true, results: r.results, mode: r.mode, note: r.note || '', saved });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/leads', (req, res) => {
  const d = store.get();
  let arr = d.leads.slice().reverse();
  const q = String(req.query.q || '').toLowerCase();
  if (q) arr = arr.filter((l) => (l.co + l.person + l.email + l.phone + l.country + l.tag).toLowerCase().includes(q));
  if (req.query.country) arr = arr.filter((l) => l.country === req.query.country);
  const limit = Math.min(2000, Number(req.query.limit) || 300);
  res.json({ ok: true, total: arr.length, leads: arr.slice(0, limit) });
});

app.delete('/api/leads/:id', (req, res) => {
  const d = store.get();
  d.leads = d.leads.filter((l) => l.id !== req.params.id);
  store.saveNow();
  res.json({ ok: true, total: d.leads.length });
});

app.post('/api/leads/clear', (req, res) => {
  const d = store.get();
  d.leads = [];
  store.saveNow();
  res.json({ ok: true });
});

/** 粘贴导入：一行一个，支持 邮箱/号码，逗号或制表符分隔 */
app.post('/api/leads/import', (req, res) => {
  const raw = String(req.body.text || '');
  const rows = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(/[,\t;]/).map((c) => c.trim());
      const email = cells.find((c) => /@/.test(c)) || '';
      const phone = cells.find((c) => /^[+\d][\d\s\-()]{6,}$/.test(c)) || '';
      const rest = cells.filter((c) => c && c !== email && c !== phone);
      return { co: rest[0] || '', person: rest[1] || '', email, phone };
    })
    .filter((x) => x.email || x.phone);
  const added = leads.saveLeads(rows);
  res.json({ ok: true, added, total: store.get().leads.length });
});

/* =========================================================
   群发任务
   ========================================================= */
app.get('/api/campaigns', (req, res) => res.json({ ok: true, campaigns: campaign.list(Number(req.query.limit) || 50) }));

app.post('/api/campaigns', (req, res) => {
  try {
    const baseUrl = req.body.baseUrl || `${req.protocol}://${req.get('host')}`;
    const c = campaign.create({ ...req.body, baseUrl, approved: true });
    broadcast();
    res.json({ ok: true, campaign: campaign.view(c) });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/campaigns/:id', (req, res) => {
  const c = campaign.get(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: '任务不存在' });
  res.json({ ok: true, campaign: campaign.view(c) });
});

app.post('/api/campaigns/:id/:act', (req, res) => {
  const { id, act } = req.params;
  try {
    let c = null;
    if (act === 'stop') c = campaign.stop(id);
    else if (act === 'pause') c = campaign.pause(id);
    else if (act === 'resume') c = campaign.resume(id);
    else return res.status(400).json({ ok: false, error: '未知操作' });
    broadcast();
    res.json({ ok: true, campaign: c });
  } catch (e) {
    sendError(res, e);
  }
});

app.delete('/api/campaigns/:id', (req, res) => {
  const d = store.get();
  d.campaigns = d.campaigns.filter((c) => c.id !== req.params.id);
  store.saveNow();
  res.json({ ok: true });
});

/* =========================================================
   发送明细 / 回复 / 客户
   ========================================================= */
app.get('/api/sends', (req, res) => {
  const d = store.get();
  let arr = d.sends.slice().reverse();
  if (req.query.channel) arr = arr.filter((s) => s.channel === req.query.channel);
  if (req.query.campaignId) arr = arr.filter((s) => s.campaignId === req.query.campaignId);
  if (req.query.status) arr = arr.filter((s) => s.status === req.query.status);
  if (req.query.day) arr = arr.filter((s) => s.day === req.query.day);
  res.json({ ok: true, total: arr.length, sends: arr.slice(0, Math.min(1000, Number(req.query.limit) || 200)) });
});

app.get('/api/replies', (req, res) => {
  const filter = { channel: req.query.channel, q: req.query.q, grade: req.query.grade, limit: req.query.limit };
  if (req.query.handled === '0') filter.handled = false;
  if (req.query.handled === '1') filter.handled = true;
  res.json({ ok: true, replies: replies.list(filter), unread: replies.unreadCount() });
});

app.post('/api/replies/:id/handle', (req, res) => {
  try {
    res.json({ ok: true, reply: replies.markHandled(req.params.id, req.body.handled !== false, req.body.note) });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/customers', (req, res) => {
  const d = store.get();
  let arr = d.customers.slice().reverse();
  if (req.query.grade) arr = arr.filter((c) => c.grade === req.query.grade);
  if (req.query.stage) arr = arr.filter((c) => c.stage === req.query.stage);
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    arr = arr.filter((c) => (c.name + c.co + c.contact + c.country).toLowerCase().includes(q));
  }
  res.json({ ok: true, total: arr.length, customers: arr.slice(0, Math.min(2000, Number(req.query.limit) || 300)) });
});

app.post('/api/customers', (req, res) => {
  const d = store.get();
  const c = {
    id: store.nextId('cu'),
    name: req.body.name || req.body.contact || '未命名',
    co: req.body.co || '',
    country: req.body.country || '',
    channel: req.body.channel === 'mail' ? 'mail' : 'wa',
    contact: req.body.contact || '',
    grade: req.body.grade || 'C',
    stage: req.body.stage || '待跟进',
    owner: req.body.owner || '',
    note: req.body.note || '',
    lastContact: Date.now(),
    nextFollow: Date.now() + (Number(store.get().settings.follow.firstFollowDays) || 3) * 86400000,
    repliedCount: 0,
    thread: [],
    createdAt: Date.now(),
  };
  d.customers.push(c);
  store.saveNow();
  res.json({ ok: true, customer: c });
});

app.put('/api/customers/:id', (req, res) => {
  const c = store.get().customers.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: '客户不存在' });
  const b = req.body || {};
  ['name', 'co', 'country', 'channel', 'contact', 'grade', 'stage', 'owner', 'note'].forEach((k) => {
    if (b[k] !== undefined) c[k] = b[k];
  });
  if (b.touch) {
    c.lastContact = Date.now();
    c.nextFollow = Date.now() + (Number(b.followDays) || Number(store.get().settings.follow.firstFollowDays) || 3) * 86400000;
    c.thread = (c.thread || []).concat([{ ts: Date.now(), dir: 'out', text: String(b.touch).slice(0, 500) }]).slice(-30);
  }
  if (b.nextFollow !== undefined) c.nextFollow = Number(b.nextFollow);
  store.saveNow();
  res.json({ ok: true, customer: c });
});

app.delete('/api/customers/:id', (req, res) => {
  const d = store.get();
  d.customers = d.customers.filter((c) => c.id !== req.params.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/followups', (req, res) => res.json({ ok: true, list: replies.followUps() }));

/* =========================================================
   知识库
   ========================================================= */
app.get('/api/kb', (req, res) => res.json({ ok: true, kb: store.get().kb }));

app.put('/api/kb/company', (req, res) => {
  const kb = store.get().kb;
  kb.company = { ...kb.company, ...(req.body || {}) };
  store.saveNow();
  res.json({ ok: true, kb });
});

app.post('/api/kb/products', (req, res) => {
  const kb = store.get().kb;
  kb.products.push({ ...(req.body || {}), id: store.nextId('p') });
  store.saveNow();
  res.json({ ok: true, kb });
});

app.put('/api/kb/products/:pid', (req, res) => {
  const kb = store.get().kb;
  const i = kb.products.findIndex((p) => p.id === req.params.pid);
  if (i < 0) return res.status(404).json({ ok: false, error: '产品不存在' });
  kb.products[i] = { ...kb.products[i], ...(req.body || {}), id: req.params.pid };
  store.saveNow();
  res.json({ ok: true, kb });
});

app.delete('/api/kb/products/:pid', (req, res) => {
  const kb = store.get().kb;
  kb.products = kb.products.filter((p) => p.id !== req.params.pid);
  store.saveNow();
  res.json({ ok: true, kb });
});

app.post('/api/kb/faq', (req, res) => {
  const kb = store.get().kb;
  kb.faq.push({ id: store.nextId('f'), q: req.body.q || '', a: req.body.a || '', tag: req.body.tag || '' });
  store.saveNow();
  res.json({ ok: true, kb });
});

app.put('/api/kb/faq/:fid', (req, res) => {
  const kb = store.get().kb;
  const i = kb.faq.findIndex((f) => f.id === req.params.fid);
  if (i < 0) return res.status(404).json({ ok: false, error: '条目不存在' });
  kb.faq[i] = { ...kb.faq[i], ...(req.body || {}), id: req.params.fid };
  store.saveNow();
  res.json({ ok: true, kb });
});

app.delete('/api/kb/faq/:fid', (req, res) => {
  const kb = store.get().kb;
  kb.faq = kb.faq.filter((f) => f.id !== req.params.fid);
  store.saveNow();
  res.json({ ok: true, kb });
});

/* =========================================================
   系统配置（客户看不到密钥，只看到是否已配置）
   ========================================================= */
function maskKey(k) {
  if (!k) return '';
  return k.length <= 6 ? '******' : k.slice(0, 3) + '****' + k.slice(-3);
}

app.get('/api/settings', (req, res) => {
  const s = store.get().settings;
  res.json({
    ok: true,
    settings: {
      llm: { enabled: s.llm.enabled, baseUrl: s.llm.baseUrl, model: s.llm.model, keyMask: maskKey(s.llm.key), hasKey: Boolean(s.llm.key), ...llm.status() },
      lead: {
        mode: s.lead.mode,
        apiUrl: s.lead.apiUrl,
        apiKeyMask: maskKey(s.lead.apiKey),
        hasApiKey: Boolean(s.lead.apiKey),
        searchKeyMask: maskKey(s.lead.searchKey),
        hasSearchKey: Boolean(s.lead.searchKey),
        searchProvider: s.lead.searchProvider,
        pageSize: s.lead.pageSize,
      },
      send: s.send,
      follow: s.follow,
    },
    auth: { configured: store.authConfigured() },
  });
});

app.put('/api/settings', (req, res) => {
  const s = store.get().settings;
  const b = req.body || {};
  if (b.llm) {
    if (b.llm.baseUrl !== undefined) s.llm.baseUrl = b.llm.baseUrl;
    if (b.llm.model !== undefined) s.llm.model = b.llm.model;
    if (b.llm.enabled !== undefined) s.llm.enabled = Boolean(b.llm.enabled);
    if (b.llm.key) s.llm.key = b.llm.key;
  }
  if (b.lead) {
    ['mode', 'apiUrl', 'searchProvider', 'pageSize'].forEach((k) => {
      if (b.lead[k] !== undefined) s.lead[k] = b.lead[k];
    });
    if (b.lead.apiKey) s.lead.apiKey = b.lead.apiKey;
    if (b.lead.searchKey) s.lead.searchKey = b.lead.searchKey;
  }
  if (b.send) {
    ['waDailyLimit', 'waIntervalMin', 'waIntervalMax', 'waPerRound', 'mailDailyLimit', 'mailIntervalMin', 'mailIntervalMax'].forEach((k) => {
      if (b.send[k] !== undefined) s.send[k] = Number(b.send[k]) || s.send[k];
    });
    ['retrySwitch', 'textVary'].forEach((k) => {
      if (b.send[k] !== undefined) s.send[k] = Boolean(b.send[k]);
    });
  }
  if (b.follow) {
    ['firstFollowDays', 'alertDays'].forEach((k) => {
      if (b.follow[k] !== undefined) s.follow[k] = Number(b.follow[k]) || s.follow[k];
    });
    if (b.follow.gradeAKeywords !== undefined) s.follow.gradeAKeywords = b.follow.gradeAKeywords;
  }
  store.saveNow();
  res.json({ ok: true });
});

app.post('/api/settings/test-llm', async (req, res) => {
  try {
    const text = await llm.test();
    res.json({ ok: true, text });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/llm/draft', async (req, res) => {
  try {
    const text = await billable('ai_generate', req.get('Idempotency-Key') || store.nextId('draft-'), { kind: req.body.kind, ctx: req.body.ctx }, () => llm.draft(String(req.body.kind || 'wa'), req.body.ctx || {}));
    res.json({ ok: true, text });
  } catch (e) {
    sendError(res, e);
  }
});

/* =========================================================
   演示数据（仅演示模式）
   ========================================================= */
app.post('/api/demo/seed', async (req, res) => {
  if (!MOCK) return res.status(400).json({ ok: false, error: '仅在演示模式（WA_MOCK=1）可用' });
  try {
    await (await import('./lib/demo.js')).default.seed();
    broadcast();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* =========================================================
   旧版接口兼容（/simple.html 与早期调用方仍可用）
   ========================================================= */
const compat = express.Router();
compat.get('/sessions', (req, res) => res.json({ ok: true, sessions: wa.list() }));
compat.post('/sessions', async (req, res) => {
  try {
    res.json({ ok: true, session: await wa.create(req.body.label) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
compat.post('/sessions/:id/start', async (req, res) => {
  try {
    res.json({ ok: true, session: await wa.start(req.params.id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
compat.post('/sessions/:id/stop', async (req, res) => {
  await wa.stop(req.params.id, false);
  res.json({ ok: true, sessions: wa.list() });
});
compat.delete('/sessions/:id', async (req, res) => {
  await wa.stop(req.params.id, true);
  res.json({ ok: true, sessions: wa.list() });
});
compat.post('/sessions/:id/mock-online', async (req, res) => {
  try {
    res.json({ ok: true, session: await wa.mockOnline(req.params.id) });
  } catch (e) {
    sendError(res, e);
  }
});
compat.get('/sessions/:id/chats', async (req, res) => {
  try {
    res.json({ ok: true, chats: await wa.chats(req.params.id) });
  } catch (e) {
    sendError(res, e);
  }
});
compat.get('/jobs', (req, res) => {
  const camps = campaign.list(50);
  res.json({
    ok: true,
    jobs: {
      total: camps.length,
      running: camps.filter((c) => c.status === 'running').length,
      done: camps.filter((c) => c.status === 'done').length,
      sent: camps.reduce((a, c) => a + c.stats.sent, 0),
      failed: camps.reduce((a, c) => a + c.stats.failed, 0),
      items: camps.map((c) => ({ id: c.id, sessionId: c.accountIds[0], sessionLabel: c.name, total: c.stats.total, sent: c.stats.sent, failed: c.stats.failed, status: c.status, startedAt: c.startedAt })),
    },
  });
});
app.use('/api', compat);

/* =========================================================
   静态页面
   ========================================================= */
app.use(express.static(path.join(store.ROOT, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(store.ROOT, 'public', process.env.TAIGUA_AGENT_SLUG === 'ztwt' ? 'console.html' : 'domestic.html')));
app.get('/domestic', (req, res) => res.sendFile(path.join(store.ROOT, 'public', 'domestic.html')));
app.get('/console', (req, res) => res.sendFile(path.join(store.ROOT, 'public', 'console.html')));
/** 管理后台：独立页面、独立口令，顾客端不会链接到这里 */
app.get(['/admin', '/admin/', '/manage'], (req, res) => res.sendFile(path.join(store.ROOT, 'public', 'admin.html')));

/* =========================================================
   收信 → 留资中心
   ========================================================= */
function onIncoming(p) {
  const account = store.getRoot()[p.channel === 'mail' ? 'mailAccounts' : 'waAccounts'].find((row) => row.id === p.accountId);
  if (!account) return;
  const r = store.runTenant(account.mid, () => replies.handleIncoming(p));
  if (r) {
    console.log('[留资] 已归集一条新回复');
    broadcast();
  }
}
wa.bus.on('incoming', onIncoming);
if (process.env.OUTREACH_DISABLE_JOBS !== '1') mail.startPolling(onIncoming, Number(process.env.MAIL_POLL_SEC || 180));

recoverBilling();
campaign.restore();
if (process.env.OUTREACH_DISABLE_JOBS !== '1') {
  plans.boot();
  const billingTimer = setInterval(() => reconcileBilling(), 30000);
  billingTimer.unref();
}

const server = app.listen(PORT, process.env.OUTREACH_HOST || '127.0.0.1', () => {
  console.log(`私信拓客系统已启动：http://127.0.0.1:${PORT}`);
  console.log(`数据目录：${store.DATA_DIR}${MOCK ? '（演示模式）' : ''}`);
  console.log(AUTH_DISABLED ? '登录：已关闭（打开网址直接进入，如需口令登录设 CONSOLE_AUTH=1）' : '登录：已启用口令');
});

process.on('SIGINT', async () => {
  for (const s of wa.list()) await wa.stop(s.id, false);
  process.exit(0);
});

export { app, server };
