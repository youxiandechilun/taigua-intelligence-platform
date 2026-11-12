'use strict';
/* =========================================================
   私信拓客控制台 — 前端（V3）
   全部页面接真实接口；密钥与配置只在后端。
   ========================================================= */

const NAV = [
  { g: '总览', items: [{ k: 'dashboard', t: '数据看板' }] },
  { g: '账号管理', items: [{ k: 'wa', t: 'WhatsApp 账号' }, { k: 'mail', t: '邮箱账号' }] },
  { g: '任务中心', items: [{ k: 'leads', t: 'AI 找线索' }, { k: 'plans', t: '自动搜索计划' }, { k: 'progress', t: '任务进度' }, { k: 'campaign', t: '开发信任务' }] },
  { g: '留资中心', items: [{ k: 'inbox', t: '回复收件箱' }, { k: 'crm', t: '客户管理' }, { k: 'follow', t: '跟进提醒' }] },
  { g: '知识库', items: [{ k: 'kb-company', t: '公司介绍' }, { k: 'kb-product', t: '产品介绍' }, { k: 'kb-faq', t: '常见问题' }] },
];

const META = {
  dashboard: { g: '总览', t: '数据看板', d: '双通道回执一屏掌握：今天发了多少、回了多少、看了多少，任务与账号状态实时刷新。' },
  wa: { g: '账号管理', t: 'WhatsApp 账号', d: '扫码接入多个账号，发送时按号轮换，单号限流，降低封号影响。' },
  mail: { g: '账号管理', t: '邮箱账号', d: '接入多个发信邮箱（SMTP 发信 + IMAP 收信），发信带已读追踪。' },
  leads: { g: '任务中心', t: 'AI 找线索', d: '输入产品关键词 + 指定国家，AI 联网搜索真实客户，自动核对官网上的邮箱与 WhatsApp 号，勾选后直接进群发任务。' },
  campaign: { g: '任务中心', t: '开发信任务', d: '指定发送账号 + 指定收件人范围，多号自动轮换、间隔随机、失败换号、断点续发。' },
  plans: { g: '任务中心', t: '自动搜索计划', d: '设好关键词、国家、频率，系统按点自动搜索、自动去重、自动分批发信，全程不用人盯。' },
  progress: { g: '任务中心', t: '任务进度', d: '所有自动 / 手动搜索任务的实时进度都在这里：进行到第几步、已入库多少条、发信发到第几批。' },
  inbox: { g: '留资中心', t: '回复收件箱', d: '客户回复自动进来，按关键词自动分级（A 有意向 / B 一般），点一下转成客户。' },
  crm: { g: '留资中心', t: '客户管理', d: '客户按 A/B/C 分级管理，记录每次跟进，防止跟进断档。' },
  follow: { g: '留资中心', t: '跟进提醒', d: '超过设定天数没联系的客户自动冒出来，避免线索睡着。' },
  'kb-company': { g: '知识库', t: '公司介绍', d: '公司资料是 AI 写开发信和回复客户的依据，填得越全，生成越准。' },
  'kb-product': { g: '知识库', t: '产品介绍', d: '产品参数、MOQ、报价区间，模板变量与 AI 都会引用。' },
  'kb-faq': { g: '知识库', t: '常见问题', d: '把客户常问的问题和标准答案放进来，AI 回复时优先引用。' },
};

const CHIP = {
  idle: '未启动', starting: '启动中', qr: '待扫码', authenticated: '已认证', online: '在线',
  offline: '已断线', error: '异常', stopped: '已停止', ready: '可用',
  running: '运行中', pending_approval: '待确认发送', paused: '已暂停', done: '已完成', stopped2: '已停止',
};
const DOT = { online: 'on', ready: 'on', qr: 'wait', starting: 'wait', authenticated: 'wait', offline: 'err', error: 'err' };
const COUNTRIES = ['美国', '德国', '英国', '法国', '意大利', '西班牙', '波兰', '荷兰', '沙特阿拉伯', '阿联酋', '土耳其', '墨西哥', '巴西', '智利', '越南', '泰国', '印度尼西亚', '马来西亚', '新加坡', '印度', '澳大利亚', '南非', '全部'];

const S = {
  token: localStorage.getItem('wa_token') || '',
  ov: null, wa: [], mail: [], campaigns: [], leads: [], leadsTotal: 0,
  replies: [], customers: [], followups: [], kb: null, pub: null,
  chats: { sid: '', list: [], loading: false, error: '' },
  selected: new Set(),          // WhatsApp 用户多选
  leadResults: [], leadSel: new Set(), // 搜索结果
  aiJob: null, aiBusy: false,         // AI 在线搜索任务
  aiJobs: [], plans: [], openJob: '', jobDetail: null, // 任务进度 / 自动搜索计划
  aiForm: { keyword: '', country: '美国', audience: 'all', limit: 30, save: 1,
    autoSend: 0, sendChannel: 'mail', mailSubject: 'Cooperation proposal from {{company}}', mailText: '',
    batchSize: 10, batchHours: 3, batchUnit: 'hour' },
  picked: [],                   // 待发送收件人
  editing: {},                  // 编辑态
  filter: { inbox: 'all', crm: 'all', camp: 'all', leadQ: '' },
  es: null, loaded: false, mock: false,
};

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmt = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const ago = (ts) => {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
};
/* 时长展示：0.25 → “15 分钟”，1.5 → “1.5 小时”，24 → “24 小时” */
const fmtDur = (h) => {
  const n = Number(h) || 0;
  if (n >= 1) return (Math.round(n * 10) / 10) + ' 小时';
  return Math.max(1, Math.round(n * 60)) + ' 分钟';
};
/* 数值 + 单位 → 小时（'min' = 分钟） */
const toHours = (v, unit) => {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return String(unit) === 'min' ? n / 60 : n;
};
/* 间隔输入组合框：数值 + 分钟/小时下拉 */
const durField = (id, value, unit, hint) => `
  <div style="display:flex;gap:8px">
    <input type="text" id="${id}" value="${esc(value)}" style="flex:1" />
    <select id="${id}-unit" style="width:82px;flex:none">
      <option value="min" ${unit === 'min' ? 'selected' : ''}>分钟</option>
      <option value="hour" ${unit !== 'min' ? 'selected' : ''}>小时</option>
    </select>
  </div>
  ${hint ? `<div class="hint">${hint}</div>` : ''}`;

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = 'toast'), 2600);
}

async function api(url, opt = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, opt.headers || {});
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  const r = await fetch(url, Object.assign({}, opt, { headers }));
  const j = await r.json().catch(() => ({ ok: false, error: '返回解析失败' }));
  if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

const head = (k, right = '') => {
  const m = META[k];
  return `<div class="page-head">
    <div class="eyebrow"><span class="bar"></span>${esc(m.g)}</div>
    <h1>${esc(m.t)}</h1>
    <p>${esc(m.d)}</p>
    ${right ? `<div style="margin-top:14px">${right}</div>` : ''}
  </div>`;
};
const notice = (txt, kind = '') => `<div class="notice ${kind}">
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
  <div>${txt}</div></div>`;
const empty = (title, desc, extra = '') => `<div class="placeholder"><h4>${esc(title)}</h4><p>${desc}</p>${extra}</div>`;
const badge = (t, cls = '') => `<span class="badge ${cls}">${esc(t)}</span>`;
const statusBadge = (st) => {
  const cls = st === 'online' || st === 'ready' || st === 'done' ? 'green' : st === 'qr' || st === 'paused' || st === 'starting' ? 'warn' : st === 'error' || st === 'offline' ? 'red' : '';
  return `<span class="badge ${cls}">${esc(CHIP[st] || st)}</span>`;
};

/* =========================================================
   数据加载
   ========================================================= */
async function loadCore() {
  const [ov, wa, mail, camps] = await Promise.all([
    api('/api/overview').catch(() => null),
    api('/api/wa').catch(() => ({ accounts: [] })),
    api('/api/mail').catch(() => ({ accounts: [] })),
    api('/api/campaigns').catch(() => ({ campaigns: [] })),
  ]);
  S.ov = ov;
  S.wa = wa.accounts || [];
  S.mail = mail.accounts || [];
  S.mailMock = Boolean(mail.mock);
  S.mock = Boolean(wa.mock);
  S.campaigns = camps.campaigns || [];
  if (!S.pub) await loadPub();
  S.loaded = true;
}

async function loadLeads() {
  const j = await api('/api/leads?limit=300');
  S.leads = j.leads || [];
  S.leadsTotal = j.total || 0;
}

async function loadInbox() {
  const q = S.filter.inbox === 'all' ? '' : S.filter.inbox === 'unread' ? '&handled=0' : '&grade=A';
  const j = await api('/api/replies?limit=200' + q);
  S.replies = j.replies || [];
}

async function loadCustomers() {
  const j = await api('/api/customers?limit=300');
  S.customers = j.customers || [];
}

async function loadFollow() {
  const j = await api('/api/followups');
  S.followups = j.list || [];
}

async function loadKB() {
  S.kb = (await api('/api/kb')).kb;
}

async function loadAiJobs() {
  const j = await api('/api/ai/jobs?limit=30');
  S.aiJobs = j.jobs || [];
}

async function loadPlans() {
  const j = await api('/api/plans');
  S.plans = j.plans || [];
}

async function loadJobDetail(id) {
  try {
    const j = await api('/api/ai/search/' + encodeURIComponent(id));
    S.jobDetail = j.job;
  } catch (e) {
    S.jobDetail = null;
  }
  return S.jobDetail;
}

async function loadPub() {
  S.pub = await api('/api/public/config').catch(() => null);
}

function connectSSE() {
  if (S.es) S.es.close();
  try {
    S.es = new EventSource('/api/events?t=' + encodeURIComponent(S.token));
    S.es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.overview) S.ov = d.overview;
        if (d.wa) S.wa = d.wa;
        if (d.campaigns) S.campaigns = d.campaigns;
        if (['dashboard', 'wa'].includes(route)) render();
        else if (route === 'campaign') {
          const ae = document.activeElement;
          // 正在填表时不重绘，避免输入被打断
          if (!(ae && ae.closest && ae.closest('#view'))) render();
        } else updateCounts();
      } catch {}
    };
  } catch {}
}

/* =========================================================
   侧栏
   ========================================================= */
function buildNav() {
  $('#nav').innerHTML = NAV.map((g) => `
    <div class="side-group">
      <div class="g-head">
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
        ${esc(g.g)}<span class="cnt" data-cnt="${g.g}"></span>
      </div>
      <div class="side-items">
        ${g.items.map((it) => `<div class="side-sub" data-k="${it.k}">${esc(it.t)}</div>`).join('')}
      </div>
    </div>`).join('');
  $$('#nav .g-head').forEach((h) => (h.onclick = () => h.parentElement.classList.toggle('open')));
  $$('#nav .side-sub').forEach((s) => (s.onclick = () => {
    location.hash = '#/' + s.dataset.k;
    document.body.classList.remove('side-open');
  }));
  updateCounts();
}

function updateCounts() {
  const set = (g, v) => {
    const el = document.querySelector(`[data-cnt="${g}"]`);
    if (el) el.textContent = v || '';
  };
  set('账号管理', S.wa.length + S.mail.length ? `${S.wa.filter((x) => x.status === 'online').length}/${S.wa.length} WA` : '');
  set('任务中心', S.campaigns.filter((c) => c.status === 'running').length ? `运行 ${S.campaigns.filter((c) => c.status === 'running').length}` : '');
  set('留资中心', S.ov && S.ov.replies.unread ? `${S.ov.replies.unread} 新` : '');
  set('知识库', S.kb ? `${(S.kb.products || []).length} 产品` : '');
}

function markNav(k) {
  $$('#nav .side-sub').forEach((s) => s.classList.toggle('active', s.dataset.k === k));
  $$('#nav .side-group').forEach((g) => {
    if (g.querySelector(`.side-sub[data-k="${k}"]`)) g.classList.add('open');
  });
}

/* =========================================================
   1. 数据看板
   ========================================================= */
function viewDashboard() {
  const ov = S.ov || { today: { wa: {}, mail: {}, all: {} }, allTime: { wa: {}, mail: {} }, wa: {}, mail: {}, campaigns: {}, replies: {}, customers: {}, leads: 0, followups: 0 };
  const t = ov.today || { wa: {}, mail: {} };
  const wa = t.wa || {}, ml = t.mail || {};
  const kpi = (k, v, d, cls = '') => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${cls}">${d}</div></div>`;

  const chanRow = (name, o, extra) => `<tr>
    <td><span class="cell-b">${name}</span><span class="cell-sub">${extra}</span></td>
    <td class="num">${o.sent || 0}</td>
    <td class="num">${o.read || 0}</td>
    <td class="num" style="color:var(--ok)">${o.replied || 0}</td>
    <td class="num">${pct(o.replied, o.sent) || 0}%</td>
    <td class="num" style="color:${o.failed ? 'var(--accent)' : 'inherit'}">${o.failed || 0}</td>
  </tr>`;

  return `
  ${head('dashboard', `<div class="toolbar">
    ${badge(S.ov ? '接口已连接' : '接口未连接', S.ov ? 'green' : 'red')}
    ${badge('状态实时推送')}
    ${S.mock ? badge('演示模式', 'warn') : ''}
    ${S.mock ? `<button class="btn btn-sm" data-act="seed">填充演示数据</button>` : ''}
    <button class="btn btn-sm" data-act="refresh" style="margin-left:auto">刷新</button>
  </div>`)}

  <div class="grid grid-4" style="margin-bottom:14px">
    ${kpi('WhatsApp 今日已发', wa.sent || 0, `失败 ${wa.failed || 0} · 触达 ${wa.total || 0}`)}
    ${kpi('WhatsApp 今日回复', wa.replied || 0, `回复率 ${pct(wa.replied, wa.sent) || 0}%`, wa.replied ? 'up' : '')}
    ${kpi('邮件今日已发', ml.sent || 0, `失败 ${ml.failed || 0}`)}
    ${kpi('邮件今日已读', ml.read || 0, `已读率 ${pct(ml.read, ml.sent) || 0}%`, ml.read ? 'up' : '')}
  </div>
  <div class="grid grid-4" style="margin-bottom:18px">
    ${kpi('邮件今日回复', ml.replied || 0, `回复率 ${pct(ml.replied, ml.sent) || 0}%`, ml.replied ? 'up' : '')}
    ${kpi('WhatsApp 在线', `${ov.wa.online || 0}/${ov.wa.total || 0}`, `待扫码 ${ov.wa.qr || 0} · 异常 ${ov.wa.error || 0}`, ov.wa.online ? 'up' : 'down')}
    ${kpi('运行中任务', ov.campaigns.running || 0, `累计 ${ov.campaigns.total || 0} · 暂停 ${ov.campaigns.paused || 0}`)}
    ${kpi('待处理留资', ov.replies.unread || 0, `今日新回复 ${ov.replies.today || 0}`, ov.replies.unread ? 'down' : '')}
  </div>

  <div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>今日回执（双通道）</h3><span class="r">TODAY</span></div>
    <div class="tbl-wrap"><table style="min-width:560px">
      <thead><tr><th>通道</th><th>已发</th><th>已读</th><th>回复</th><th>回复率</th><th>失败</th></tr></thead>
      <tbody>
        ${chanRow('WhatsApp 开发信', wa, `${ov.wa.online || 0} 个号在线 · 轮换发送`)}
        ${chanRow('邮件开发信', ml, `${ov.mail.ready || 0} 个邮箱可用 · 追踪已读`)}
      </tbody>
    </table></div>
    <div class="divider"></div>
    <div class="grid grid-4" style="gap:10px">
      <div><span class="small muted">累计 WhatsApp 已发</span><div class="mono" style="font-size:19px;font-weight:700">${(ov.allTime.wa || {}).sent || 0}</div></div>
      <div><span class="small muted">累计 WhatsApp 回复</span><div class="mono" style="font-size:19px;font-weight:700">${(ov.allTime.wa || {}).replied || 0}</div></div>
      <div><span class="small muted">累计邮件已发</span><div class="mono" style="font-size:19px;font-weight:700">${(ov.allTime.mail || {}).sent || 0}</div></div>
      <div><span class="small muted">累计邮件回复</span><div class="mono" style="font-size:19px;font-weight:700">${(ov.allTime.mail || {}).replied || 0}</div></div>
    </div>
  </div>

  <div class="grid grid-2" style="margin-bottom:18px">
    <div class="card plain">
      <div class="card-h"><h3>账号状态</h3><span class="r">REALTIME</span></div>
      ${S.wa.length || S.mail.length ? `<div class="tbl-wrap"><table style="min-width:0">
        <thead><tr><th>账号</th><th>类型</th><th>状态</th><th>今日已发</th></tr></thead>
        <tbody>
          ${S.wa.map((a) => `<tr>
            <td><span class="cell-b">${esc(a.label)}</span><span class="cell-sub">${a.me ? '+' + esc(a.me.id) : '未接入'}</span></td>
            <td>${badge('WhatsApp', 'blue')}</td>
            <td>${statusBadge(a.status)}</td>
            <td class="num">${a.sentToday || 0}<span class="muted small"> / ${a.limit || 40}</span></td>
          </tr>`).join('')}
          ${S.mail.map((a) => `<tr>
            <td><span class="cell-b">${esc(a.label)}</span><span class="cell-sub">${esc(a.email)}</span></td>
            <td>${badge('邮箱')}</td>
            <td>${statusBadge(a.status)}</td>
            <td class="num">${a.sentToday || 0}<span class="muted small"> / ${a.dailyLimit || 200}</span></td>
          </tr>`).join('')}
        </tbody></table></div>`
        : empty('还没有接入账号', '先接入 WhatsApp 或邮箱，才能开始发开发信。', `<div style="margin-top:14px;display:flex;gap:8px;justify-content:center"><a class="btn btn-primary" href="#/wa">接 WhatsApp</a><a class="btn" href="#/mail">接邮箱</a></div>`)}
    </div>
    <div class="card plain">
      <div class="card-h"><h3>任务进度</h3><span class="r">RUNNING</span></div>
      ${S.campaigns.filter((c) => c.status === 'running' || c.status === 'paused').length
        ? S.campaigns.filter((c) => c.status === 'running' || c.status === 'paused').slice(0, 5).map((c) => `
          <div class="bar-row">
            <span class="bar-name" title="${esc(c.name)}">${esc(c.name).slice(0, 8)}</span>
            <span class="bar-track"><i style="width:${c.percent}%"></i></span>
            <span class="bar-val">${c.stats.sent}/${c.stats.total}</span>
          </div>`).join('')
        : `<div class="placeholder" style="padding:28px 18px"><p>当前没有运行中的任务</p><div style="margin-top:12px"><a class="btn btn-sm" href="#/campaign">去建任务</a></div></div>`}
      <div class="divider"></div>
      <div class="grid grid-3" style="gap:8px">
        <div><span class="small muted">线索池</span><div class="mono" style="font-size:18px;font-weight:700">${ov.leads || 0}</div></div>
        <div><span class="small muted">客户</span><div class="mono" style="font-size:18px;font-weight:700">${ov.customers.total || 0}</div></div>
        <div><span class="small muted">A 类客户</span><div class="mono" style="font-size:18px;font-weight:700;color:var(--ok)">${ov.customers.A || 0}</div></div>
      </div>
    </div>
  </div>

  <div class="card plain">
    <div class="card-h"><h3>最近任务</h3><a class="btn btn-sm" href="#/campaign" style="margin-left:auto">新建任务</a></div>
    ${S.campaigns.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>任务</th><th>通道</th><th>进度</th><th>成功</th><th>失败</th><th>状态</th><th>开始</th></tr></thead>
      <tbody>${S.campaigns.slice(0, 8).map((c) => `<tr>
        <td><span class="cell-b">${esc(c.name)}</span><span class="cell-sub">${c.stats.total} 个收件人</span></td>
        <td>${badge(c.channel === 'wa' ? 'WhatsApp' : '邮件', c.channel === 'wa' ? 'green' : '')}</td>
        <td><div style="display:flex;align-items:center;gap:8px;min-width:120px"><span class="bar-track" style="height:7px"><i style="width:${c.percent}%"></i></span><span class="num small">${c.percent}%</span></div></td>
        <td class="num">${c.stats.sent}</td>
        <td class="num" style="color:${c.stats.failed ? 'var(--accent)' : 'inherit'}">${c.stats.failed}</td>
        <td>${statusBadge(c.status === 'stopped' ? 'stopped2' : c.status)}</td>
        <td class="num small">${fmt(c.startedAt)}</td>
      </tr>`).join('')}</tbody></table></div>`
        : empty('还没有发送任务', '在「找线索」勾选客户，或到「开发信任务」粘贴名单，就能创建第一个任务。')}
  </div>`;
}

/* =========================================================
   2. WhatsApp 账号
   ========================================================= */
function viewWA() {
  const online = S.wa.filter((s) => s.status === 'online').length;
  const bar = `<div class="toolbar">
    <button class="btn btn-primary" data-act="wa-add">+ 新增账号</button>
    <button class="btn" data-act="refresh">刷新状态</button>
    <span class="small muted" style="margin-left:auto">在线 ${online} / 共 ${S.wa.length}</span>
  </div>`;
  const tip = notice(`手机 WhatsApp → <b>设置 → 已连接的设备 → 连接设备</b> → 扫码。建议接 2~3 个号，发送时系统自动轮换，单号达到日上限会跳过，不影响其它号继续发。`, 'info');

  let body;
  if (!S.wa.length) body = empty('还没有接入 WhatsApp', '点「+ 新增账号」生成二维码，手机扫码即可接入。多个号可以轮换发送，降低单号被封的影响。', `<div style="margin-top:16px"><button class="btn btn-primary" data-act="wa-add">+ 新增账号</button></div>`);
  else body = `<div class="grid grid-3">${S.wa.map(waCard).join('')}</div>`;
  return `${head('wa', bar)}${tip}${body}`;
}

function waCard(s) {
  const st = s.status || 'idle';
  const online = st === 'online';
  const img = s.qr ? `<img src="${s.qr}" alt="WhatsApp 二维码" />` : '';
  const ph = `<div class="qr-empty">
    <strong>${st === 'starting' ? '正在启动浏览器…' : st === 'error' ? '启动失败' : online ? '已在线' : st === 'offline' ? '已断线' : '等待二维码'}</strong>
    ${online ? '保持手机联网，避免被踢下线' : st === 'error' ? '见下方提示' : st === 'offline' ? '点「重新生成」重新扫码' : '点「启动」开始'}
  </div>`;
  return `<div class="acc-card ${online ? '' : 'off'}">
    <div class="acc-top">
      <div class="acc-ava" style="background:${online ? '#16a34a' : st === 'qr' ? '#b45309' : '#71717a'}">${online ? '✓' : 'W'}</div>
      <div class="acc-info"><b>${esc(s.label)}</b><span>${s.me ? '+' + esc(s.me.id) : '未接入'}</span></div>
      <i class="dot ${DOT[st] || 'off'}"></i>
    </div>
    <div class="qr-wrap">${img || ph}</div>
    ${st === 'qr' ? `<div class="qr-state"><i class="dot wait"></i>等待扫码 · 二维码自动刷新</div>` : ''}
    ${online ? `<div class="qr-state"><i class="dot on"></i>${esc((s.me && s.me.name) || '已连接')}</div>` : ''}
    ${s.error ? `<div class="small" style="color:var(--accent);line-height:1.6">${esc(s.error)}</div>` : ''}
    <div class="acc-stats">
      <div><span class="lbl">状态</span><div class="val" style="font-size:12px">${CHIP[st] || st}</div></div>
      <div><span class="lbl">今日已发</span><div class="val">${s.sentToday || 0}<span class="muted" style="font-size:11px">/${s.limit || 40}</span></div></div>
      <div><span class="lbl">累计</span><div class="val">${s.sentTotal || 0}</div></div>
    </div>
    <div class="acc-foot">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${['idle', 'stopped', 'offline', 'error'].includes(st) ? `<button class="btn btn-sm btn-primary" data-act="wa-start" data-id="${s.id}">启动</button>` : ''}
        ${['qr', 'starting'].includes(st) ? `<button class="btn btn-sm" data-act="wa-restart" data-id="${s.id}">重新生成</button>` : ''}
        ${online ? `<button class="btn btn-sm" data-act="wa-stop" data-id="${s.id}">停止</button>
          <button class="btn btn-sm" data-act="wa-users" data-id="${s.id}">用户</button>` : ''}
        ${S.mock && st === 'qr' ? `<button class="btn btn-sm" data-act="wa-mock" data-id="${s.id}">模拟上线</button>` : ''}
      </div>
      <button class="btn btn-sm btn-danger" data-act="wa-del" data-id="${s.id}">删除</button>
    </div>
  </div>`;
}

/* =========================================================
   3. 邮箱账号
   ========================================================= */
function viewMail() {
  const bar = `<div class="toolbar">
    <button class="btn btn-primary" data-act="mail-add">+ 接入邮箱</button>
    <span class="small muted" style="margin-left:auto">可用 ${S.mail.filter((a) => a.status === 'ready').length} / 共 ${S.mail.length}</span>
  </div>`;
  const tip = notice(
    `邮箱要填 <b>IMAP/SMTP 授权码</b>（不是登录密码）：QQ 邮箱在「设置 → 账户 → POP3/SMTP 服务」开启后生成；163/126 在「设置 → POP3/SMTP/IMAP」开启。发信会自动带 1×1 追踪像素统计「已读」，收信每 3 分钟自动拉取一次，客户回复直接进留资中心。`,
    'info'
  );
  const cards = S.mail.length
    ? `<div class="grid grid-3">${S.mail.map(mailCard).join('')}</div>`
    : empty('还没有接入邮箱', '接入后可用同一套任务流程发开发信，并能统计送达、已读与回复。', `<div style="margin-top:16px"><button class="btn btn-primary" data-act="mail-add">+ 接入邮箱</button></div>`);

  const form = `<div class="card plain" id="mail-form" style="display:none;margin-bottom:18px">
    <div class="card-h"><h3>接入邮箱</h3><span class="r">SMTP + IMAP</span></div>
    <div class="form-row">
      <div class="field"><label>邮箱地址</label><input type="text" id="m-email" placeholder="sales@yourcompany.com" /></div>
      <div class="field"><label>授权码</label><input type="password" id="m-pass" placeholder="邮箱授权码，不是登录密码" />
        <div class="hint">QQ/163 需先在邮箱设置里开启 SMTP 服务并生成授权码。</div></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>显示名称</label><input type="text" id="m-label" placeholder="例如 Sales - Lisa" /></div>
      <div class="field"><label>每日上限</label><input type="text" id="m-limit" value="200" /></div>
      <div class="field"><label>服务器（可留空自动识别）</label><input type="text" id="m-host" placeholder="留空自动判断" /></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" data-act="mail-save">保存并测试连接</button>
      <button class="btn" data-act="mail-cancel">取消</button>
      <span class="small muted" id="m-status" style="align-self:center"></span>
    </div>
  </div>`;

  return `${head('mail', bar)}${tip}${form}${cards}`;
}

function mailCard(a) {
  const st = a.status || 'idle';
  return `<div class="acc-card ${st === 'ready' ? '' : 'off'}">
    <div class="acc-top">
      <div class="acc-ava" style="background:${st === 'ready' ? '#2563eb' : '#71717a'}">@</div>
      <div class="acc-info"><b>${esc(a.label || a.email)}</b><span>${esc(a.email)}</span></div>
      <i class="dot ${DOT[st] || 'off'}"></i>
    </div>
    <div class="small muted" style="font-family:var(--mono);line-height:1.7">
      SMTP ${esc(a.smtpHost || '—')}<br/>IMAP ${esc(a.host || '—')}
    </div>
    <div class="acc-stats">
      <div><span class="lbl">今日已发</span><div class="val">${a.sentToday || 0}</div></div>
      <div><span class="lbl">累计发送</span><div class="val">${a.sentTotal || 0}</div></div>
      <div><span class="lbl">累计回复</span><div class="val">${a.repliedTotal || 0}</div></div>
    </div>
    ${a.lastError ? `<div class="small" style="color:var(--accent);line-height:1.6">${esc(a.lastError)}</div>` : ''}
    <div class="acc-foot">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" data-act="mail-check" data-id="${a.id}">立即收信</button>
        <button class="btn btn-sm" data-act="mail-test-send" data-id="${a.id}">测试发信</button>
      </div>
      <button class="btn btn-sm btn-danger" data-act="mail-del" data-id="${a.id}">删除</button>
    </div>
    <div class="small muted">最近收信：${a.lastCheck ? ago(a.lastCheck) : '尚未拉取'}</div>
  </div>`;
}

/* =========================================================
   4. AI 在线搜索（找线索）
   ========================================================= */
const AUD = [
  ['all', '不限（进口商 / 批发商 / 经销商）'],
  ['importer', '进口商'],
  ['distributor', '批发商 / 经销商'],
  ['brand', '品牌方采购'],
  ['contractor', '工程商 / 项目采购'],
];

function syncAiForm() {
  const f = S.aiForm;
  if ($('#ld-kw')) f.keyword = $('#ld-kw').value;
  if ($('#ld-country')) f.country = $('#ld-country').value;
  if ($('#ld-aud')) f.audience = $('#ld-aud').value;
  if ($('#ld-limit')) f.limit = $('#ld-limit').value;
  if ($('#ld-save')) f.save = $('#ld-save').value;
  if ($('#ld-autosend')) f.autoSend = $('#ld-autosend').value;
  if ($('#ld-send-channel')) f.sendChannel = $('#ld-send-channel').value;
  if ($('#ld-mail-subject')) f.mailSubject = $('#ld-mail-subject').value;
  if ($('#ld-mail-text')) f.mailText = $('#ld-mail-text').value;
  if ($('#ld-batch-size')) f.batchSize = $('#ld-batch-size').value;
  if ($('#ld-batch-hours')) f.batchHours = $('#ld-batch-hours').value;
  if ($('#ld-batch-hours-unit')) f.batchUnit = $('#ld-batch-hours-unit').value;
}

function viewLeads() {
  const cfg = (S.ov && S.ov.lead) || {};
  const f = S.aiForm;
  const job = S.aiJob;
  const running = job && job.status === 'running';

  const aiBadge = cfg.aiConfigured ? badge('大模型已配置', 'green') : badge('大模型未配置', 'red');
  const srcBadge = cfg.searchConfigured
    ? badge((cfg.searchProvider === 'tavily' ? 'Tavily' : 'Serper') + ' 实时检索', 'blue')
    : badge('免费检索源', 'warn');

  const tip = !cfg.aiConfigured
    ? notice('还没配置大模型：当前只能做「联网检索 + 官网抓取」。到「系统 → 后端配置 → 大模型」填好接口地址、密钥和模型名后，AI 才会规划检索词、判断匹配度、写联系理由。', 'warn')
    : !cfg.searchConfigured
      ? notice('现在用服务器自带的免费检索源，速度慢、可能被限流。建议在「后端配置 → AI 在线搜索」填 Serper 或 Tavily 密钥（两个都是按次计费，很便宜），结果更全更稳。', 'info')
      : '';

  const form = `<div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>AI 搜索条件</h3><span class="r" style="margin-left:auto;display:flex;gap:6px">${aiBadge}${srcBadge}</span></div>
    ${tip}
    <div class="form-row">
      <div class="field"><label>关键词（产品 / 行业）</label>
        <input type="text" id="ld-kw" value="${esc(f.keyword)}" placeholder="例如：stainless steel hinge / building materials" />
        <div class="hint">用英文写产品词效果最好；也可以加行业词，比如 furniture hardware。</div></div>
      <div class="field"><label>指定国家 / 地区</label>
        <select id="ld-country">${COUNTRIES.map((c) => `<option ${c === f.country ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <div class="hint">AI 会按这个国家的语言、行业习惯去检索。</div></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>客户类型</label>
        <select id="ld-aud">${AUD.map(([v, t]) => `<option value="${v}" ${f.audience === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>需要多少条</label><input type="text" id="ld-limit" value="${esc(f.limit)}" />
        <div class="hint">建议 20~50；条数越多耗时越长。</div></div>
      <div class="field"><label>结果处理</label><select id="ld-save">
        <option value="1" ${String(f.save) === '1' ? 'selected' : ''}>自动存入线索池</option>
        <option value="0" ${String(f.save) === '0' ? 'selected' : ''}>只看不存</option>
      </select></div>
    </div>
    <div class="form-row-3" style="margin-top:12px">
      <div class="field"><label>搜完后自动发邮件</label><select id="ld-autosend" onchange="var d=document.getElementById('ld-mailbox'); if (d) d.style.display = this.value === '1' ? '' : 'none'">
        <option value="0" ${String(f.autoSend) === '1' ? '' : 'selected'}>不自动发（之后手动群发）</option>
        <option value="1" ${String(f.autoSend) === '1' ? 'selected' : ''}>搜完自动定时发信</option>
      </select>
      <div class="hint">搜完 → 去重（30 天内发过的邮箱自动跳过）→ 定时分批发。</div></div>
      <div class="field"><label>每批发送数量</label><input type="text" id="ld-batch-size" value="${esc(f.batchSize)}" />
        <div class="hint">例如 10 = 每批最多发 10 封。</div></div>
      <div class="field"><label>批间隔</label>${durField('ld-batch-hours', esc(f.batchHours), f.batchUnit, '例如 30 分钟 = 每隔半小时自动发下一批。')}</div>
    </div>
    <div id="ld-mailbox" style="display:${String(f.autoSend) === '1' ? '' : 'none'};margin-top:12px">
      <div class="form-row-3">
        <div class="field"><label>发送通道</label><select id="ld-send-channel">
          <option value="mail" ${f.sendChannel !== 'wa' ? 'selected' : ''}>邮箱开发信</option>
          <option value="wa" ${f.sendChannel === 'wa' ? 'selected' : ''}>WhatsApp 消息</option>
        </select>
        <div class="hint">邮箱用搜到的邮箱地址；WhatsApp 用搜到的电话号码，且需要账号已扫码在线。批发数量与间隔在上面设置。</div></div>
      </div>
      <div class="field"><label>标题 / 正文（支持 {{name}} {{co}} {{country}} {{company}} {{product}} {{sender}} {{website}} 变量，留空用默认模板）</label>
        <input type="text" id="ld-mail-subject" value="${esc(f.mailSubject)}" placeholder="邮件标题（WhatsApp 不用标题）" style="margin-bottom:8px" />
        <textarea id="ld-mail-text" rows="6" placeholder="Dear {{name}}, ...">${esc(f.mailText)}</textarea>
        <div class="hint">留空将使用系统默认英文开发信模板；变量按每个客户自动替换。</div></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" data-act="ld-run" ${running ? 'disabled' : ''}>${running ? 'AI 正在搜索…' : '开始 AI 搜索'}</button>
      <button class="btn" data-act="ld-import">粘贴导入名单</button>
      <span class="small muted" style="align-self:center" id="ld-status">${running ? '已进行到：' + esc((job.steps.find((s) => s.status === 'running') || {}).label || '') : '搜索在服务器上执行，关掉页面也会继续跑完'}</span>
    </div>
  </div>`;

  const prog = job ? `<div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>AI 搜索过程</h3>
      <span class="r">${job.status === 'running' ? badge('进行中', 'warn') : job.status === 'done' ? badge('已完成', 'green') : badge('失败', 'red')}</span>
    </div>
    ${job.notes.map((n) => `<div class="ai-note">${esc(n)}</div>`).join('')}
    <div class="ai-steps">${job.steps.map((s, i) => `<div class="ai-step ${s.status}">
      <span class="ai-dot">${s.status === 'done' ? '✓' : s.status === 'error' ? '!' : i + 1}</span>
      <span class="ai-name">${esc(s.label)}</span>
      <span class="ai-detail">${esc(s.detail || '')}</span>
      <span class="ai-ms mono">${s.ms ? (s.ms / 1000).toFixed(1) + 's' : ''}</span>
    </div>`).join('')}</div>
    ${job.status === 'error' ? notice(esc(job.error), 'bad') : ''}
    ${job.summary ? `<div class="ai-summary"><b>AI 分析</b><p>${esc(job.summary)}</p></div>` : ''}
  </div>` : '';

  const results = S.leadResults.length ? `<div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>搜索结果</h3><span class="r">${S.leadResults.length} 条 · 按匹配度排序</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="ld-all" /></th>
        <th>公司</th><th>联系人</th><th style="white-space:nowrap">国家</th><th>邮箱 / WhatsApp</th><th style="width:86px;white-space:nowrap">匹配度</th><th>AI 判断</th>
      </tr></thead>
      <tbody>${S.leadResults.map((r, i) => `<tr class="${S.leadSel.has(i) ? 'row-on' : ''}">
        <td><input type="checkbox" class="ld-chk" data-i="${i}" ${S.leadSel.has(i) ? 'checked' : ''} /></td>
        <td><span class="cell-b">${esc(r.co || '—')}</span><span class="cell-sub">${esc(r.website || r.tag || '')}</span></td>
        <td>${esc(r.person || '—')}${r.title ? `<span class="cell-sub">${esc(r.title)}</span>` : ''}</td>
        <td style="white-space:nowrap">${esc(r.country || '—')}</td>
        <td class="small">${r.email ? esc(r.email) : '<span class="muted">无邮箱</span>'}${r.phone ? `<span class="cell-sub mono">${esc(r.phone)}</span>` : ''}</td>
        <td><div class="mt-row"><span class="mt"><i style="width:${Math.min(100, r.match || 0)}%"></i></span><b class="mono">${r.match || 0}</b></div></td>
        <td class="small" style="min-width:150px">${esc(r.reason || '—')}<span class="cell-sub">${esc(r.source || '')}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="pager">
      <span>已选 <b id="ld-sel">${S.leadSel.size}</b> 条</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" data-act="ld-save-picked">存入线索池</button>
        <button class="btn btn-sm btn-primary" data-act="ld-to-camp">加入群发任务</button>
      </div>
    </div>
  </div>` : '';

  const bank = `<div class="card plain">
    <div class="card-h"><h3>线索池</h3><span class="r">${S.leadsTotal} 条</span>
      <label class="search-box" style="margin-left:auto;max-width:240px;height:34px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="text" id="ld-q" placeholder="搜索公司 / 邮箱 / 号码" value="${esc(S.filter.leadQ)}" />
      </label>
      <button class="btn btn-sm btn-danger" data-act="ld-clear" style="margin-left:8px">清空</button>
    </div>
    ${S.leads.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>公司</th><th>联系人</th><th>国家</th><th>邮箱</th><th>号码</th><th>来源</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${S.leads.map((l) => `<tr>
        <td><span class="cell-b">${esc(l.co || '—')}</span><span class="cell-sub">${esc(l.tag || '')}</span></td>
        <td>${esc(l.person || '—')}</td>
        <td>${esc(l.country || '—')}</td>
        <td class="small">${esc(l.email || '—')}</td>
        <td class="num small">${esc(l.phone || '—')}</td>
        <td>${badge(l.source || '—')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost" data-act="ld-one" data-id="${l.id}">去发送</button>
          <button class="btn btn-ghost" data-act="ld-del" data-id="${l.id}" style="color:var(--accent)">删除</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`
      : empty('线索池是空的', '用上面的 AI 搜索找一批客户，或者把已有名单粘贴进来。')}
  </div>`;

  return `${head('leads', `<div class="toolbar">
      ${aiBadge}${srcBadge}
      <span class="small muted" style="margin-left:auto">密钥与接口都在后端，前端不用填任何 Key</span>
    </div>`)}${form}${prog}${results}${bank}`;
}

/* ---------------- AI 搜索进度轮询 ---------------- */
let aiTimer = null;

function pollAi(id) {
  clearTimeout(aiTimer);
  const tick = async () => {
    let job;
    try {
      job = (await api('/api/ai/search/' + id)).job;
    } catch (e) {
      S.aiBusy = false;
      return;
    }
    const done = job.status !== 'running';
    S.aiJob = job;
    if (!done) {
      if ((location.hash || '').includes('leads')) {
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
      }
      aiTimer = setTimeout(tick, 1500);
      return;
    }
    S.aiBusy = false;
    S.leadResults = job.results || [];
    S.leadSel = new Set(S.leadResults.map((r, i) => (r.match >= 70 ? i : -1)).filter((i) => i >= 0));
    await loadLeads().catch(() => {});
    await loadCore().catch(() => {});
    if ((location.hash || '').includes('leads')) {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
    if (job.status === 'error') toast('AI 搜索失败：' + job.error, true);
    else toast(`AI 搜到 ${S.leadResults.length} 条可用线索${job.stats.saved ? '，已存入线索池' : ''}`);
  };
  tick();
}

/* =========================================================
   5. 开发信任务
   ========================================================= */
function viewCampaign() {
  const picked = S.picked.length;
  const onlineWa = S.wa.filter((s) => s.status === 'online');
  const readyMail = S.mail.filter((a) => a.status === 'ready');
  const hasWA = onlineWa.length > 0;
  const hasMail = readyMail.length > 0;

  const form = `<div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>新建开发信任务</h3><span class="r">WHATSAPP / EMAIL</span></div>

    <div class="tabs" style="margin-bottom:16px">
      <div class="tab ${S.channel !== 'mail' ? 'active' : ''}" data-act="ch-wa">WhatsApp 群发</div>
      <div class="tab ${S.channel === 'mail' ? 'active' : ''}" data-act="ch-mail">邮件群发</div>
    </div>

    ${picked ? notice(`已带入 <b>${picked.length}</b> 个收件人（来自「找线索」）。直接选账号就能发。`, 'info') : ''}

    <div class="form-row">
      <div class="field"><label>任务名称</label><input type="text" id="cp-name" placeholder="例如：德国五金批发商 · 第 1 批" /></div>
      <div class="field"><label>收件人</label>
        <textarea id="cp-targets" rows="3" placeholder="每行一个：email 或 手机号（含国家码），可带公司名，用逗号分隔">${picked ? esc(picked.map((t) => [t.to, t.name, t.co].filter(Boolean).join(', ')).join('\n')) : ''}</textarea>
        <div class="hint">每行一个收件人；也可以先去「AI 找线索」勾选，会自动带到上面。</div>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <select id="cp-country" style="height:34px;border:1px solid var(--border-strong);border-radius:8px;padding:0 9px;font-size:13px;background:var(--bg);color:var(--text);font-family:inherit">
            ${COUNTRIES.map((c) => `<option>${c}</option>`).join('')}
          </select>
          <button class="btn btn-sm" data-act="cp-fill-country">从线索池导入该国客户</button>
          <span class="small muted">只导有邮箱或号码的线索</span>
        </div>
      </div>
    </div>

    <div class="field"><label>发送账号（可多选，自动轮换）</label>
      <div class="checks">
        ${(S.channel === 'mail' ? S.mail : S.wa).map((a) => {
          const ok = S.channel === 'mail' ? a.status === 'ready' : a.status === 'online';
          return `<label class="chk ${ok ? 'on' : ''}"><input type="checkbox" class="cp-acc" value="${a.id}" ${ok ? 'checked' : ''} ${ok ? '' : 'disabled'} />
            ${esc(a.label || a.email)}${ok ? '' : '（未就绪）'}</label>`;
        }).join('') || `<span class="small muted">${S.channel === 'mail' ? '还没有可用邮箱，先去接入' : '还没有在线 WhatsApp，先扫码'}</span>`}
      </div>
      <div class="hint">多选后按顺序轮换：一个号发几条就换下一个，单号达到日上限自动跳过。</div>
    </div>

    ${S.channel === 'mail' ? `<div class="field"><label>邮件标题</label><input type="text" id="cp-subject" value="Re: {{product}} supplier from China — {{company}}" /></div>` : ''}

    <div class="field"><label>正文</label>
      <textarea rows="6" id="cp-text">Hi {{name}},

This is {{sender}} from {{company}}. We manufacture {{product}} and supply importers in {{country}} — MOQ {{moq}}, lead time {{days}} days.

May I send you our latest price list?</textarea>
      <div class="hint">变量：{{name}} 联系人 · {{co}} 公司 · {{country}} 国家 · {{product}} 产品 · {{company}} 公司名 · {{moq}} 起订量 · {{sender}} 署名</div>
      <div class="form-actions" style="margin-top:10px">
        <button class="btn btn-sm" data-act="cp-ai">用 AI 按知识库润色</button>
        <span class="small muted" style="align-self:center">${S.pub && S.pub.ai ? 'AI 已就绪' : 'AI 未启用（联系管理员开通）'}</span>
      </div>
    </div>

    <div class="form-row-3">
      <div class="field"><label>发送间隔下限（秒）</label><input type="text" id="cp-iv1" value="${S.channel === 'mail' ? 20 : 30}" /></div>
      <div class="field"><label>发送间隔上限（秒）</label><input type="text" id="cp-iv2" value="${S.channel === 'mail' ? 45 : 60}" /></div>
      <div class="field"><label>单号日上限</label><input type="text" id="cp-day" value="${S.channel === 'mail' ? 200 : 40}" /></div>
    </div>

    <div class="form-actions">
      <button class="btn btn-primary" data-act="cp-create">创建并开始发送</button>
      <button class="btn" data-act="cp-clear">清空收件人</button>
      ${!hasWA && !hasMail ? `<span class="small" style="color:var(--accent);align-self:center">先接入账号才能发送</span>` : ''}
    </div>
  </div>`;

  const tabs = `<div class="tabs" style="margin-bottom:14px">
    ${['all', 'wa', 'mail'].map((k) => `<div class="tab ${S.filter.camp === k ? 'active' : ''}" data-act="camp-filter" data-id="${k}">${k === 'all' ? '全部' : k === 'wa' ? 'WhatsApp' : '邮件'}</div>`).join('')}
  </div>`;

  const list0 = S.campaigns.filter((c) => S.filter.camp === 'all' || c.channel === S.filter.camp);
  const table = `<div class="card plain">
    <div class="card-h"><h3>任务列表</h3><span class="r">${list0.length} 个</span></div>
    ${tabs}
    ${list0.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>任务</th><th>通道</th><th>进度</th><th>成功 / 失败</th><th>状态</th><th>开始时间</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${list0.map((c) => `<tr>
        <td><span class="cell-b">${esc(c.name)}</span><span class="cell-sub">${esc(String(c.text || '').slice(0, 36))}</span></td>
        <td>${badge(c.channel === 'wa' ? 'WhatsApp' : '邮件', c.channel === 'wa' ? 'green' : '')}</td>
        <td><div style="display:flex;align-items:center;gap:8px;min-width:130px"><span class="bar-track" style="height:7px"><i style="width:${c.percent}%"></i></span><span class="num small">${c.stats.sent + c.stats.failed + c.stats.skipped}/${c.stats.total}</span></div></td>
        <td class="num"><span style="color:var(--ok)">${c.stats.sent}</span> / <span style="color:${c.stats.failed ? 'var(--accent)' : 'inherit'}">${c.stats.failed}</span></td>
        <td>${statusBadge(c.status === 'stopped' ? 'stopped2' : c.status)}</td>
        <td class="num small">${fmt(c.startedAt)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${c.status === 'running' ? `<button class="btn btn-ghost" data-act="cp-pause" data-id="${c.id}">暂停</button>` : ''}
          ${['paused', 'pending_approval'].includes(c.status) ? `<button class="btn btn-ghost" data-act="cp-resume" data-id="${c.id}">${c.status === 'pending_approval' ? '确认发送' : '继续'}</button>` : ''}
          ${['running', 'paused'].includes(c.status) ? `<button class="btn btn-ghost" data-act="cp-stop" data-id="${c.id}" style="color:var(--accent)">停止</button>` : `<span class="small muted">${fmt(c.finishedAt)}</span>`}
        </td>
      </tr>`).join('')}</tbody></table></div>`
      : empty('还没有任务', '上面填好收件人和正文，点「创建并开始发送」。')}
  </div>`;

  return `${head('campaign', `<div class="toolbar">
      ${badge(`运行中 ${S.campaigns.filter((c) => c.status === 'running').length}`, 'green')}
      ${badge(`WhatsApp 在线 ${onlineWa.length}`)}
      ${badge(`邮箱可用 ${readyMail.length}`)}
    </div>`)}${form}${table}`;
}

/* =========================================================
   6. 回复收件箱
   ========================================================= */
function viewInbox() {
  const bar = `<div class="toolbar">
    <div class="tabs" style="margin:0">
      ${[['all', '全部'], ['unread', '未处理'], ['done', '已处理'], ['a', 'A 类意向'], ['b', 'B 类一般']].map(([k, t]) => `<div class="tab ${S.filter.inbox === k ? 'active' : ''}" data-act="inbox-filter" data-id="${k}">${t}</div>`).join('')}
    </div>
    <button class="btn btn-sm" data-act="inbox-reload" style="margin-left:auto">刷新</button>
  </div>`;

  const rows = S.replies.filter((r) => {
    const f = S.filter.inbox;
    if (f === 'all') return true;
    if (f === 'unread') return !r.handled;
    if (f === 'done') return r.handled;
    if (f === 'a') return r.grade === 'A';
    if (f === 'b') return r.grade === 'B';
    return true;
  });

  const body = rows.length ? `<div class="grid" style="gap:12px">${rows.map((r) => `
    <div class="card plain reply-card ${r.handled ? 'done' : ''}">
      <div class="reply-top">
        <div class="acc-ava" style="background:${r.channel === 'wa' ? '#16a34a' : '#2563eb'};width:34px;height:34px;flex:0 0 34px;font-size:13px">${r.channel === 'wa' ? 'W' : '@'}</div>
        <div style="min-width:0;flex:1">
          <b>${esc(r.name || r.from)}</b>
          <div class="small muted">${esc(r.from)} · ${esc(r.accountLabel || '')} · ${ago(r.ts)}</div>
        </div>
        ${badge(r.grade + ' 类', r.grade === 'A' ? 'green' : 'blue')}
        ${r.campaignName ? badge('回复开发信') : ''}
        ${r.handled ? badge('已处理') : badge('待处理', 'warn')}
      </div>
      ${r.subject ? `<div class="small" style="font-weight:600;margin-bottom:4px">${esc(r.subject)}</div>` : ''}
      <div class="reply-body">${esc(r.text).slice(0, 400)}</div>
      <div class="reply-foot">
        <button class="btn btn-sm" data-act="rep-handle" data-id="${r.id}">${r.handled ? '标为未处理' : '标记已处理'}</button>
        <button class="btn btn-sm" data-act="rep-customer" data-id="${r.id}">进客户管理</button>
        <button class="btn btn-sm" data-act="rep-manual" data-id="${r.id}">手动回复</button>
        <button class="btn btn-sm" data-act="rep-reply" data-id="${r.id}">AI 起草回复</button>
        <span class="small muted" style="margin-left:auto">${badge(r.channel === 'wa' ? 'WhatsApp' : '邮件', r.channel === 'wa' ? 'green' : '')}</span>
      </div>
      <div class="reply-draft" id="draft-${r.id}" style="display:none"></div>
    </div>`).join('')}</div>`
    : empty('没有回复', '客户回复后会自动出现在这里：WhatsApp 实时推送，邮箱每 3 分钟拉取一次。系统会按关键词自动分成 A / B 类。');

  return `${head('inbox', bar)}${body}`;
}

/* =========================================================
   7. 客户管理
   ========================================================= */
function viewCRM() {
  const list0 = S.customers.filter((c) => S.filter.crm === 'all' || c.grade === S.filter.crm);
  const bar = `<div class="toolbar">
    <div class="tabs" style="margin:0">
      ${[['all', '全部'], ['A', 'A 类'], ['B', 'B 类'], ['C', 'C 类']].map(([k, t]) => `<div class="tab ${S.filter.crm === k ? 'active' : ''}" data-act="crm-filter" data-id="${k}">${t}</div>`).join('')}
    </div>
    <button class="btn btn-sm btn-primary" data-act="crm-add" style="margin-left:auto">+ 手动添加客户</button>
  </div>`;

  const stat = (g) => S.customers.filter((c) => c.grade === g).length;
  const kpis = `<div class="grid grid-4" style="margin-bottom:18px">
    <div class="kpi"><div class="k">客户总数</div><div class="v">${S.customers.length}</div><div class="d">来自回复自动入库</div></div>
    <div class="kpi"><div class="k">A 类（有意向）</div><div class="v">${stat('A')}</div><div class="d up">优先跟进</div></div>
    <div class="kpi"><div class="k">B 类（一般）</div><div class="v">${stat('B')}</div><div class="d">可跟进</div></div>
    <div class="kpi"><div class="k">超过 7 天未跟进</div><div class="v">${S.customers.filter((c) => c.stage !== '已成交' && Math.floor((Date.now() - (c.lastContact || c.createdAt)) / 86400000) >= 7).length}</div><div class="d down">去「跟进提醒」处理</div></div>
  </div>`;

  const table = `<div class="card plain">
    <div class="card-h"><h3>客户列表</h3><span class="r">${list0.length} 条</span></div>
    ${list0.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>客户</th><th>联系方式</th><th>国家</th><th>分级</th><th>阶段</th><th>最近联系</th><th>下次跟进</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${list0.map((c) => `<tr>
        <td><span class="cell-b">${esc(c.name)}</span><span class="cell-sub">${esc(c.co || '')}</span></td>
        <td class="small">${esc(c.contact)}<div class="cell-sub">${c.channel === 'wa' ? 'WhatsApp' : '邮件'}</div></td>
        <td>${esc(c.country || '—')}</td>
        <td><select data-act="crm-grade" data-id="${c.id}" class="mini-sel"><option ${c.grade === 'A' ? 'selected' : ''}>A</option><option ${c.grade === 'B' ? 'selected' : ''}>B</option><option ${c.grade === 'C' ? 'selected' : ''}>C</option></select></td>
        <td><select data-act="crm-stage" data-id="${c.id}" class="mini-sel">${['待跟进', '已回复', '已报价', '已发样', '已成交', '已放弃'].map((s) => `<option ${c.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="num small">${fmt(c.lastContact)}</td>
        <td class="num small" style="color:${c.nextFollow && c.nextFollow < Date.now() ? 'var(--accent)' : 'inherit'}">${fmt(c.nextFollow)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost" data-act="crm-touch" data-id="${c.id}">记录跟进</button>
          <button class="btn btn-ghost" data-act="crm-del" data-id="${c.id}" style="color:var(--accent)">删除</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`
      : empty('还没有客户', '客户回消息后会自动入库（按内容自动分级）。也可以手动添加。')}
  </div>`;

  return `${head('crm', bar)}${kpis}${table}`;
}

/* =========================================================
   8. 跟进提醒
   ========================================================= */
function viewFollow() {
  const list0 = S.followups;
  const body = list0.length ? `<div class="card plain">
    <div class="card-h"><h3>需要跟进的客户</h3><span class="r">${list0.length} 位</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>客户</th><th>分级</th><th>阶段</th><th>最近联系</th><th>已停</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${list0.map((c) => `<tr>
        <td><span class="cell-b">${esc(c.name)}</span><span class="cell-sub">${esc(c.contact)}</span></td>
        <td>${badge(c.grade + ' 类', c.grade === 'A' ? 'green' : 'blue')}</td>
        <td>${esc(c.stage)}</td>
        <td class="num small">${fmt(c.lastContact)}</td>
        <td><span class="badge ${c.overdue ? 'red' : 'warn'}">${c.idleDays} 天</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost" data-act="fu-push" data-id="${c.id}">加入催办任务</button>
          <button class="btn btn-ghost" data-act="fu-touch" data-id="${c.id}">已跟进</button>
        </td>
      </tr>`).join('')}</tbody></table></div>
  </div>` : empty('暂时没有要催的', '所有客户都在跟进周期内。超过设定天数没联系，就会自动出现在这里。');

  return `${head('follow', `<div class="toolbar">
      ${badge(`提醒阈值 ${(S.pub && S.pub.alertDays) || 7} 天未联系`, 'warn')}
      <button class="btn btn-sm" data-act="fu-reload" style="margin-left:auto">重新检查</button>
    </div>`)}${body}`;
}

/* =========================================================
   9-11. 知识库
   ========================================================= */
function viewKBCompany() {
  const c = (S.kb && S.kb.company) || {};
  const f = (k, label, ph = '') => `<div class="field"><label>${label}</label><input type="text" data-kb="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}" /></div>`;
  return `${head('kb-company', `<div class="toolbar">
      ${badge(S.kb && S.kb.company.name ? '已填写' : '待填写', S.kb && S.kb.company.name ? 'green' : 'warn')}
      <span class="small muted" style="margin-left:auto">这些内容会作为 AI 写开发信 / 回复客户的依据</span>
    </div>`)}
    <div class="grid grid-2">
      <div class="card plain">
        <div class="card-h"><h3>公司档案</h3><span class="r">COMPANY</span></div>
        ${f('name', '公司名称（英文）', 'XX Industrial Co., Ltd.')}
        ${f('website', '官网', 'https://www.example.com')}
        ${f('founded', '成立年份', '2010')}
        ${f('location', '所在地', 'Ningbo, China')}
        ${f('products', '主营产品', 'hardware fittings, building materials')}
        ${f('markets', '主要出口市场', 'Germany, Saudi Arabia, Mexico')}
        ${f('certs', '认证 / 资质', 'ISO 9001, CE, RoHS')}
        <div class="form-actions"><button class="btn btn-primary" data-act="kb-save-company">保存公司档案</button></div>
      </div>
      <div class="card plain">
        <div class="card-h"><h3>简介与卖点</h3><span class="r">TEXT</span></div>
        <div class="field"><label>英文简介</label>
          <textarea data-kb="intro" rows="8" placeholder="XX Industrial Co., Ltd. is a manufacturer of ...">${esc(c.intro || '')}</textarea>
          <div class="hint">建议 400 字符以内，AI 会引用这段作为公司介绍。</div>
        </div>
        <div class="field"><label>一句话卖点</label><input type="text" data-kb="selling" value="${esc(c.selling || '')}" placeholder="12 years OEM experience, MOQ 500 pcs, 25-day lead time." /></div>
        <div class="form-actions">
          <button class="btn btn-primary" data-act="kb-save-company">保存</button>
          <button class="btn" data-act="kb-test-ai">用 AI 生成一段简介</button>
        </div>
      </div>
    </div>`;
}

function viewKBProduct() {
  const list0 = (S.kb && S.kb.products) || [];
  const e = S.editing.product || {};
  const rows = list0.map((p) => `<tr>
    <td><span class="cell-b">${esc(p.name)}</span><span class="cell-sub">${esc(p.desc || '')}</span></td>
    <td class="num">${esc(p.model || '—')}</td>
    <td class="num">${esc(p.moq || '—')}</td>
    <td class="num">${esc(p.price || '—')}</td>
    <td class="small">${esc(p.market || '—')}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-ghost" data-act="p-edit" data-id="${esc(p.id)}">编辑</button>
      <button class="btn btn-ghost" data-act="p-del" data-id="${esc(p.id)}" style="color:var(--accent)">删除</button>
    </td>
  </tr>`).join('');

  return `${head('kb-product', `<div class="toolbar">${badge(`${list0.length} 个产品`)}<span class="small muted" style="margin-left:auto">模板里用 {{product}} {{moq}} 引用，AI 也会读这些参数</span></div>`)}
    <div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>产品列表</h3><span class="r">PRODUCTS</span></div>
      ${list0.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>产品</th><th>型号</th><th>MOQ</th><th>报价</th><th>主推市场</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : empty('还没有产品', '加一个产品，开发信里的 {{product}} / {{moq}} 才有内容可用。')}
    </div>
    <div class="card plain">
      <div class="card-h"><h3>${e.id ? '编辑产品' : '新增产品'}</h3><span class="r">${e.id ? 'EDIT' : 'NEW'}</span></div>
      <div class="form-row">
        <div class="field"><label>产品名称</label><input type="text" id="p-name" value="${esc(e.name || '')}" placeholder="Stainless Steel Hinge" /></div>
        <div class="field"><label>型号</label><input type="text" id="p-model" value="${esc(e.model || '')}" placeholder="SS-201" /></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>MOQ</label><input type="text" id="p-moq" value="${esc(e.moq || '')}" placeholder="500 pcs" /></div>
        <div class="field"><label>报价区间</label><input type="text" id="p-price" value="${esc(e.price || '')}" placeholder="USD 0.85 ~ 1.20" /></div>
        <div class="field"><label>主推市场</label><input type="text" id="p-market" value="${esc(e.market || '')}" placeholder="德国 · 波兰" /></div>
      </div>
      <div class="field"><label>产品描述</label><textarea id="p-desc" rows="3" placeholder="304 stainless steel, satin finish, 120-hour salt spray test.">${esc(e.desc || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="p-save">${e.id ? '保存修改' : '新增产品'}</button>
        ${e.id ? `<button class="btn" data-act="p-cancel">取消编辑</button>` : ''}
      </div>
    </div>`;
}

function viewKBFAQ() {
  const list0 = (S.kb && S.kb.faq) || [];
  const e = S.editing.faq || {};
  return `${head('kb-faq', `<div class="toolbar">${badge(`${list0.length} 条问答`)}<span class="small muted" style="margin-left:auto">客户问到类似问题，AI 会优先照着这里的答案回</span></div>`)}
    <div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>问答列表</h3><span class="r">FAQ</span></div>
      ${list0.length ? list0.map((f) => `<div class="faq-item">
        <div class="faq-q">${esc(f.q)} ${f.tag ? badge(f.tag) : ''}</div>
        <div class="faq-a">${esc(f.a)}</div>
        <div class="faq-act">
          <button class="btn btn-ghost" data-act="f-edit" data-id="${f.id}">编辑</button>
          <button class="btn btn-ghost" data-act="f-del" data-id="${f.id}" style="color:var(--accent)">删除</button>
        </div>
      </div>`).join('') : empty('还没有问答', '把客户常问的问题放进来：MOQ、交期、付款方式、认证、样品政策……')}
    </div>
    <div class="card plain">
      <div class="card-h"><h3>${e.id ? '编辑问答' : '新增问答'}</h3><span class="r">${e.id ? 'EDIT' : 'NEW'}</span></div>
      <div class="field"><label>问题</label><input type="text" id="f-q" value="${esc(e.q || '')}" placeholder="What is your MOQ?" /></div>
      <div class="field"><label>答案</label><textarea id="f-a" rows="4" placeholder="Our MOQ is 500 pcs for standard items...">${esc(e.a || '')}</textarea></div>
      <div class="field"><label>分类（可选）</label><input type="text" id="f-tag" value="${esc(e.tag || '')}" placeholder="价格 / 交期 / 认证" /></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="f-save">${e.id ? '保存修改' : '新增'}</button>
        ${e.id ? `<button class="btn" data-act="f-cancel">取消</button>` : ''}
      </div>
    </div>`;
}

/* =========================================================
   任务进度（任务列表 + 完整执行过程 / AI 对话）
   ========================================================= */
const TRACE_KIND = {
  step: { t: '开始', cls: 'k-step' },
  plan: { t: '规划', cls: 'k-plan' },
  ai: { t: '提问', cls: 'k-ai' },
  'ai-reply': { t: 'AI 回复', cls: 'k-ai' },
  tool: { t: '工具', cls: 'k-tool' },
  result: { t: '结果', cls: 'k-result' },
  note: { t: '说明', cls: 'k-note' },
  error: { t: '异常', cls: 'k-error' },
};

function jobPct(j) {
  const steps = j.steps || [];
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.status === 'done').length;
  const running = steps.some((s) => s.status === 'running') ? 0.5 : 0;
  return Math.min(100, Math.round(((done + running) / steps.length) * 100));
}

function viewProgress() {
  const jobs = S.aiJobs || [];
  const running = jobs.filter((j) => j.status === 'running');
  const detail = S.jobDetail;

  const kpi = (k, v, d) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const statRow = `<div class="grid grid-4" style="margin-bottom:14px">
    ${kpi('进行中任务', running.length, '实时刷新')}
    ${kpi('最近任务', jobs.length, '含历史记录')}
    ${kpi('累计入库', jobs.reduce((a, j) => a + ((j.stats && j.stats.saved) || 0), 0), '条线索')}
    ${kpi('自动计划', (S.plans || []).filter((p) => p.enabled).length, '个在跑')}
  </div>`;

  const list = jobs.length
    ? `<div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>任务列表</h3><span class="r">点任意一条看完整执行过程</span>
        <button class="btn btn-sm" data-act="prog-refresh" style="margin-left:10px">刷新</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>任务</th><th style="width:120px">状态</th><th style="width:190px">进度</th><th style="width:96px">线索</th><th style="width:110px">开始时间</th><th style="width:88px;text-align:right">操作</th></tr></thead>
        <tbody>${jobs.map((j) => {
          const p = jobPct(j);
          const cur = (j.steps || []).find((s) => s.status === 'running');
          const st = j.status === 'running' ? 'warn' : j.status === 'done' ? 'green' : 'red';
          const stT = j.status === 'running' ? '进行中' : j.status === 'done' ? '已完成' : '失败';
          return `<tr class="${S.openJob === j.id ? 'row-on' : ''}">
            <td><span class="cell-b">${esc(j.keyword || '—')}</span><span class="cell-sub">${esc(j.country || '')}${j.autoSend ? ' · 自动发信' : ''}${j.inMemory === false ? ' · 历史' : ''}</span></td>
            <td>${badge(stT, st)}</td>
            <td><div class="bar-row" style="padding:0"><span class="bar-track"><i style="width:${p}%"></i></span><span class="bar-val" style="width:38px">${p}%</span></div>
              <span class="cell-sub">${esc(cur ? cur.label : (j.status === 'done' ? '全部完成' : '等待中'))}</span></td>
            <td class="small">${(j.stats && j.stats.withContact) || 0} 条<span class="cell-sub">入库 ${(j.stats && j.stats.saved) || 0}</span></td>
            <td class="small mono">${fmt(j.createdAt)}</td>
            <td style="text-align:right"><button class="btn btn-sm" data-act="prog-open" data-id="${j.id}">${S.openJob === j.id ? '收起' : '看过程'}</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`
    : `<div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>任务列表</h3><button class="btn btn-sm" data-act="prog-refresh" style="margin-left:auto">刷新</button></div>
      ${empty('还没有任务', '去「AI 找线索」点一次搜索，或在「自动搜索计划」里建一个计划，任务会出现在这里。')}
    </div>`;

  const detailCard = detail ? `<div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>执行过程 · ${esc(detail.input.keyword)} / ${esc(detail.input.country)}</h3>
      <span class="r" style="margin-left:auto;display:flex;gap:6px;align-items:center">
        ${badge(detail.status === 'running' ? '进行中' : detail.status === 'done' ? '已完成' : '失败', detail.status === 'running' ? 'warn' : detail.status === 'done' ? 'green' : 'red')}
        <span class="mono small">${fmt(detail.createdAt)}</span>
        <button class="btn btn-sm" data-act="prog-close">关闭</button>
      </span>
    </div>
    <div class="form-row-3" style="margin-bottom:12px">
      <div><span class="cell-sub">目标条数</span><div class="cell-b">${detail.input.limit}</div></div>
      <div><span class="cell-sub">客户类型</span><div class="cell-b">${esc((AUD.find((x) => x[0] === detail.input.audience) || [])[1] || detail.input.audience)}</div></div>
      <div><span class="cell-sub">自动发信</span><div class="cell-b">${detail.input.autoSend ? (detail.input.sendChannel === 'wa' ? 'WhatsApp' : '邮箱') + ' · 每 ' + fmtDur(detail.input.batchHours) + ' ' + detail.input.batchSize + ' 个' : '否'}</div></div>
    </div>
    <div class="ai-steps">${(detail.steps || []).map((s, i) => `<div class="ai-step ${s.status}">
      <span class="ai-dot">${s.status === 'done' ? '✓' : s.status === 'error' ? '!' : i + 1}</span>
      <span class="ai-name">${esc(s.label)}</span>
      <span class="ai-detail">${esc(s.detail || '')}</span>
      <span class="ai-ms mono">${s.ms ? (s.ms / 1000).toFixed(1) + 's' : ''}</span>
    </div>`).join('')}</div>
    ${detail.summary ? `<div class="ai-summary"><b>AI 结论</b><p>${esc(detail.summary)}</p></div>` : ''}
    <div class="trace-head">完整执行过程 <span class="mono">${(detail.trace || []).length} 步</span>${detail.status === 'running' ? '<i class="live-dot"></i> 实时刷新中' : ''}</div>
    <div class="trace">${(detail.trace || []).length
      ? detail.trace.map((e) => {
          const k = TRACE_KIND[e.kind] || TRACE_KIND.note;
          const hh = new Date(e.t);
          const p = (n) => String(n).padStart(2, '0');
          return `<div class="trace-item ${k.cls}">
            <div class="trace-side"><span class="trace-kind">${k.t}</span><span class="trace-time mono">${p(hh.getHours())}:${p(hh.getMinutes())}:${p(hh.getSeconds())}</span></div>
            <div class="trace-body"><b>${esc(e.title)}</b>${e.text ? `<pre>${esc(e.text)}</pre>` : ''}</div>
          </div>`;
        }).join('')
      : '<div class="small muted" style="padding:10px 0">这次任务没有留下轨迹（可能是升级前的旧任务）。</div>'}</div>
    ${detail.campaignId ? `<div class="form-actions"><button class="btn btn-sm" data-act="prog-gocamp">查看发信任务进度 →</button></div>` : ''}
  </div>` : '';

  const camp = (S.campaigns || []).filter((c) => c.status === 'running' || c.status === 'paused');
  const campCard = camp.length ? `<div class="card plain">
    <div class="card-h"><h3>正在执行的发信任务</h3><span class="r">${camp.length} 个</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>任务</th><th>通道</th><th style="width:200px">发送进度</th><th>批次</th><th style="width:120px">状态</th></tr></thead>
      <tbody>${camp.map((c) => {
        const total = (c.targets || []).length || c.stats.total || 0;
        const sent = c.stats.sent || 0;
        return `<tr>
          <td><span class="cell-b">${esc(c.name)}</span><span class="cell-sub">已发 ${sent} / ${total}</span></td>
          <td>${c.channel === 'mail' ? '邮件' : 'WhatsApp'}</td>
          <td><span class="bar-track"><i style="width:${total ? Math.round((sent / total) * 100) : 0}%"></i></span></td>
          <td class="small">${c.batch ? `每 ${fmtDur(c.batch.hours)} ${c.batch.size} 个` : '一次性'}<span class="cell-sub">${c.nextBatchAt ? '下一批 ' + fmt(c.nextBatchAt) : ''}</span></td>
          <td>${statusBadge(c.status)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>` : '';

  return `${head('progress')}${statRow}${detailCard}${list}${campCard}`;
}

/* =========================================================
   自动搜索计划
   ========================================================= */
function viewPlans() {
  const plans = S.plans || [];
  const list = plans.length
    ? `<div class="tbl-wrap"><table>
      <thead><tr><th>计划</th><th style="width:110px">频率</th><th style="width:130px">下次执行</th><th style="width:150px">发信</th><th style="width:110px">运行情况</th><th style="width:88px">状态</th><th style="width:170px;text-align:right">操作</th></tr></thead>
      <tbody>${plans.map((p) => `<tr>
        <td><span class="cell-b">${esc(p.name || p.keyword)}</span><span class="cell-sub">${esc(p.keyword)} · ${esc(p.country)} · 每次 ${p.limit} 条</span></td>
        <td>每 ${fmtDur(p.intervalHours)}</td>
        <td class="small mono">${p.enabled ? fmt(p.nextRunAt) : '已暂停'}</td>
        <td class="small">${p.autoSend ? (p.sendChannel === 'wa' ? 'WhatsApp' : '邮箱') + ` · 每 ${fmtDur(p.batchHours)} ${p.batchSize} 个` : '不发（只入库）'}</td>
        <td class="small">已跑 ${p.runs || 0} 次<span class="cell-sub">${p.lastRunAt ? '上次 ' + ago(p.lastRunAt) : '还没跑过'}</span></td>
        <td>${p.enabled ? badge('运行中', 'green') : badge('已暂停', 'warn')}</td>
        <td style="text-align:right">
          <button class="btn btn-sm" data-act="plan-run" data-id="${p.id}">立即执行</button>
          <button class="btn btn-sm" data-act="plan-toggle" data-id="${p.id}">${p.enabled ? '暂停' : '启用'}</button>
          <button class="btn btn-sm" data-act="plan-del" data-id="${p.id}" style="color:var(--accent)">删除</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`
    : empty('还没有自动计划', '建一个计划后，系统会按你设的频率自动「搜索 → 去重 → 分批发信」，全程不用动手。');

  return `${head('plans')}
  <div class="card plain" style="margin-bottom:18px">
    <div class="card-h"><h3>现有计划</h3><span class="r">${plans.length} 个 · 到点自动执行</span></div>
    ${list}
  </div>
  <div class="card plain">
    <div class="card-h"><h3>新建自动计划</h3><span class="r">全自动 · 无人值守</span></div>
    <div class="form-row">
      <div class="field"><label>计划名称（可选）</label><input type="text" id="pl-name" placeholder="例如：德国五金批发商 · 每天" /></div>
      <div class="field"><label>关键词（产品 / 行业）</label><input type="text" id="pl-kw" placeholder="例如：stainless steel hinge" /></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>国家 / 地区</label><select id="pl-country">${COUNTRIES.map((c) => `<option ${c === '美国' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>每次搜多少条</label><input type="text" id="pl-limit" value="30" /><div class="hint">建议 20~50</div></div>
      <div class="field"><label>每隔多久跑一次</label>${durField('pl-interval', 6, 'hour', '例如 6 小时 = 每 6 小时跑一轮；30 分钟 = 每半小时跑一轮')}</div>
    </div>
    <div class="form-row-3" style="margin-top:12px">
      <div class="field"><label>搜完后自动发信</label><select id="pl-autosend">
        <option value="1" selected>自动发（全自动）</option>
        <option value="0">不发，只入库</option>
      </select></div>
      <div class="field"><label>发送通道</label><select id="pl-channel">
        <option value="mail" selected>邮箱开发信</option>
        <option value="wa">WhatsApp 消息</option>
      </select></div>
      <div class="field"><label>每批发送数量</label><input type="text" id="pl-batch-size" value="10" />
        <div class="hint">例如 10 = 每批发 10 个，发完等一个间隔再发下一批。</div></div>
    </div>
    <div class="form-row" style="margin-top:12px">
      <div class="field"><label>每批间隔</label>${durField('pl-batch-hours', 3, 'hour', '例如 3 小时 = 每隔 3 小时发一批；20 分钟 = 每隔 20 分钟发一批')}</div>
      <div class="field"><label>&nbsp;</label><div class="hint" style="padding-top:8px">节奏建议：搜索间隔 ≥ 批次间隔 × 批数，避免上一轮还没发完又开始下一轮。</div></div>
    </div>
    <div class="form-row">
      <div class="field"><label>邮件标题（可选）</label><input type="text" id="pl-subject" value="Cooperation proposal from {{company}}" /></div>
      <div class="field"><label>正文（可选，留空用默认模板）</label><textarea id="pl-text" rows="3" placeholder="Dear {{name}}, ..."></textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" data-act="plan-create">创建计划并开始自动执行</button>
      <span class="small muted" style="align-self:center">创建后立即可在「任务进度」看到执行过程；服务器每分钟检查一次，到点自动跑。</span>
    </div>
  </div>`;
}

/* =========================================================
   路由
   ========================================================= */
let route = 'dashboard';
const VIEWS = {
  dashboard: viewDashboard, wa: viewWA, mail: viewMail, leads: viewLeads, campaign: viewCampaign,
  plans: viewPlans, progress: viewProgress,
  inbox: viewInbox, crm: viewCRM, follow: viewFollow,
  'kb-company': viewKBCompany, 'kb-product': viewKBProduct, 'kb-faq': viewKBFAQ,
};

function render() {
  const k = VIEWS[route] ? route : 'dashboard';
  const m = META[k];
  $('#crumb').innerHTML = `${esc(m.g)}<span class="sep">/</span><b>${esc(m.t)}</b>`;
  $('#view').innerHTML = VIEWS[k]();
  bind();
  updateCounts();
}

/* =========================================================
   事件绑定
   ========================================================= */
function bind() {
  $$('#view [data-act]').forEach((el) => {
    if (el.tagName === 'SELECT') {
      el.onchange = (e) => handle(el.dataset.act, el.dataset.id, el);
    } else {
      el.onclick = (e) => handle(el.dataset.act, el.dataset.id, el, e);
    }
  });
  $$('.chk input').forEach((c) => (c.onchange = () => c.closest('.chk').classList.toggle('on', c.checked)));

  const all = $('#ld-all');
  if (all) {
    all.onchange = () => {
      S.leadSel.clear();
      if (all.checked) S.leadResults.forEach((_, i) => S.leadSel.add(i));
      $$('.ld-chk').forEach((c) => {
        c.checked = all.checked;
        c.closest('tr').classList.toggle('row-on', all.checked);
      });
      const el = $('#ld-sel');
      if (el) el.textContent = S.leadSel.size;
    };
    $$('.ld-chk').forEach((c) => {
      c.onchange = () => {
        const i = Number(c.dataset.i);
        c.checked ? S.leadSel.add(i) : S.leadSel.delete(i);
        c.closest('tr').classList.toggle('row-on', c.checked);
        const el = $('#ld-sel');
        if (el) el.textContent = S.leadSel.size;
      };
    });
  }

  const q = $('#ld-q');
  if (q) {
    q.oninput = () => {
      clearTimeout(q._t);
      q._t = setTimeout(async () => {
        S.filter.leadQ = q.value.trim();
        await loadLeads();
        render();
        const el = $('#ld-q');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 400);
    };
  }
}

async function handle(act, id, el) {
  if (!act) return;
  try {
    /* ---- 通用 ---- */
    if (act === 'refresh') { await loadCore(); render(); return toast('已刷新'); }
    if (act === 'seed') {
      el.disabled = true;
      el.textContent = '生成中…';
      await api('/api/demo/seed', { method: 'POST' });
      await loadCore();
      render();
      return toast('演示数据已填充');
    }

    /* ---- WhatsApp ---- */
    if (act === 'wa-add') {
      const label = prompt('给这个账号起个名字', 'WhatsApp ' + (S.wa.length + 1));
      if (label === null) return;
      await api('/api/wa', { method: 'POST', body: JSON.stringify({ label }) });
      await loadCore();
      render();
      return toast('已创建，正在生成二维码…');
    }
    if (act === 'wa-start') { await api(`/api/wa/${id}/start`, { method: 'POST' }); await loadCore(); render(); return toast('正在启动'); }
    if (act === 'wa-restart') { await api(`/api/wa/${id}/stop`, { method: 'POST' }); await api(`/api/wa/${id}/start`, { method: 'POST' }); await loadCore(); render(); return toast('已重新生成二维码'); }
    if (act === 'wa-stop') { await api(`/api/wa/${id}/stop`, { method: 'POST' }); await loadCore(); render(); return toast('已停止'); }
    if (act === 'wa-del') {
      if (!confirm('删除后该账号需要重新扫码，确认？')) return;
      await api(`/api/wa/${id}`, { method: 'DELETE' });
      await loadCore();
      render();
      return toast('已删除');
    }
    if (act === 'wa-mock') { await api(`/api/wa/${id}/mock-online`, { method: 'POST' }); await loadCore(); render(); return toast('已模拟上线'); }
    if (act === 'wa-users') { location.hash = '#/campaign'; return; }

    /* ---- 邮箱 ---- */
    if (act === 'mail-add') { const f = $('#mail-form'); if (f) f.style.display = 'block'; window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (act === 'mail-cancel') { const f = $('#mail-form'); if (f) f.style.display = 'none'; return; }
    if (act === 'mail-save') {
      const body = {
        email: ($('#m-email') || {}).value || '',
        pass: ($('#m-pass') || {}).value || '',
        label: ($('#m-label') || {}).value || '',
        dailyLimit: ($('#m-limit') || {}).value || 200,
        smtpHost: ($('#m-host') || {}).value || '',
      };
      const st = $('#m-status');
      if (st) st.textContent = '正在测试连接…';
      const t = await api('/api/mail/test', { method: 'POST', body: JSON.stringify(body) });
      if (!t.result.ok) {
        if (st) st.textContent = t.result.error || '连接失败';
        return toast(t.result.error || '连接失败', true);
      }
      await api('/api/mail', { method: 'POST', body: JSON.stringify(body) });
      await loadCore();
      render();
      return toast('邮箱已接入');
    }
    if (act === 'mail-del') {
      if (!confirm('删除这个邮箱账号？')) return;
      await api(`/api/mail/${id}`, { method: 'DELETE' });
      await loadCore();
      render();
      return toast('已删除');
    }
    if (act === 'mail-check') {
      toast('正在收信…');
      const j = await api(`/api/mail/${id}/check`, { method: 'POST' });
      await loadCore();
      render();
      return toast(`拉到 ${j.fetched} 封，新增 ${j.added} 条回复`);
    }
    if (act === 'mail-test-send') {
      const to = prompt('发一封测试邮件到（输入邮箱地址）', '');
      if (!to) return;
      await api(`/api/mail/${id}/send`, { method: 'POST', body: JSON.stringify({ to, subject: 'Test from console', text: 'This is a test message.' }) });
      await loadCore();
      return toast('测试邮件已发送');
    }

    /* ---- 任务进度 ---- */
    if (act === 'prog-refresh') {
      el.disabled = true;
      await Promise.all([loadAiJobs(), loadPlans(), loadCore().catch(() => {})]).catch(() => {});
      if (S.openJob) await loadJobDetail(S.openJob);
      el.disabled = false;
      render();
      return;
    }
    if (act === 'prog-open') {
      const id = el.dataset.id;
      if (S.openJob === id) {
        S.openJob = '';
        S.jobDetail = null;
        return render();
      }
      S.openJob = id;
      S.jobDetail = null;
      render();
      await loadJobDetail(id);
      return render();
    }
    if (act === 'prog-close') {
      S.openJob = '';
      S.jobDetail = null;
      return render();
    }
    if (act === 'prog-gocamp') {
      location.hash = '#/campaign';
      return;
    }

    /* ---- 自动搜索计划 ---- */
    if (act === 'plan-create') {
      const body = {
        name: ($('#pl-name') || {}).value || '',
        keyword: ($('#pl-kw') || {}).value || '',
        country: ($('#pl-country') || {}).value || '美国',
        limit: Number(($('#pl-limit') || {}).value) || 30,
        intervalHours: toHours(($('#pl-interval') || {}).value, ($('#pl-interval-unit') || {}).value) || 6,
        autoSend: String(($('#pl-autosend') || {}).value) === '1',
        sendChannel: ($('#pl-channel') || {}).value || 'mail',
        batchSize: Number(($('#pl-batch-size') || {}).value) || 10,
        batchHours: toHours(($('#pl-batch-hours') || {}).value, ($('#pl-batch-hours-unit') || {}).value) || 3,
        mailSubject: ($('#pl-subject') || {}).value || '',
        mailText: ($('#pl-text') || {}).value || '',
      };
      if (!String(body.keyword).trim()) return toast('请填写关键词', true);
      el.disabled = true;
      try {
        const j = await api('/api/plans', { method: 'POST', body: JSON.stringify(body) });
        await loadPlans();
        S.plans = (await api('/api/plans')).plans || [];
        render();
        toast(`计划已创建，${fmtDur(j.plan.intervalHours)}后自动跑第一轮`);
      } catch (e) {
        el.disabled = false;
        toast(e.message, true);
      }
      return;
    }
    if (act === 'plan-toggle') {
      const p = (S.plans || []).find((x) => x.id === el.dataset.id);
      if (!p) return;
      await api('/api/plans/' + p.id, { method: 'POST', body: JSON.stringify({ enabled: !p.enabled }) });
      await loadPlans();
      render();
      return toast(p.enabled ? '已暂停' : '已启用');
    }
    if (act === 'plan-run') {
      el.disabled = true;
      el.textContent = '启动中…';
      try {
        const j = await api('/api/plans/' + el.dataset.id + '/run', { method: 'POST' });
        await loadPlans();
        S.openJob = j.jobId;
        S.jobDetail = j.job || null;
        location.hash = '#/progress';
        if (route === 'progress') {
          await loadAiJobs();
          render();
        }
        toast('已开始执行，进度见「任务进度」');
      } catch (e) {
        el.disabled = false;
        el.textContent = '立即执行';
        toast(e.message, true);
      }
      return;
    }
    if (act === 'plan-del') {
      if (!confirm('删除这个计划？已发出的消息和已入库线索不受影响。')) return;
      await api('/api/plans/' + el.dataset.id, { method: 'DELETE' });
      await loadPlans();
      render();
      return toast('已删除');
    }

    /* ---- 找线索 ---- */
    if (act === 'ld-run') {
      syncAiForm();
      const f = S.aiForm;
      if (!String(f.keyword || '').trim()) return toast('请填写关键词', true);
      S.leadResults = [];
      S.leadSel.clear();
      S.aiBusy = true;
      S.aiJob = null;
      try {
        const j = await api('/api/ai/search', {
          method: 'POST',
          body: JSON.stringify({
            keyword: f.keyword,
            country: f.country,
            audience: f.audience,
            limit: Number(f.limit) || 30,
            save: String(f.save) === '1',
            autoSend: String(f.autoSend) === '1',
            sendChannel: f.sendChannel === 'wa' ? 'wa' : 'mail',
            mailSubject: f.mailSubject || '',
            mailText: f.mailText || '',
            batchSize: Number(f.batchSize) || 10,
            batchHours: toHours(f.batchHours, f.batchUnit) || 3,
          }),
        });
        S.aiJob = j.job;
        render();
        pollAi(j.jobId);
      } catch (e) {
        S.aiBusy = false;
        render();
        toast('启动失败：' + e.message, true);
      }
      return;
    }
    if (act === 'ld-import') {
      const text = prompt('粘贴名单：每行一个，支持「邮箱」或「手机号」，可加公司名，用逗号分隔\n例如：sales@abc.com, ABC Trading, John');
      if (!text) return;
      const j = await api('/api/leads/import', { method: 'POST', body: JSON.stringify({ text }) });
      await loadLeads();
      render();
      return toast(`导入 ${j.added} 条`);
    }
    if (act === 'ld-save-picked') {
      const picked = [...S.leadSel].map((i) => S.leadResults[i]);
      if (!picked.length) return toast('先勾选线索', true);
      const j = await api('/api/leads/import', { method: 'POST', body: JSON.stringify({ text: picked.map((r) => [r.email, r.co, r.person].filter(Boolean).join(',')).join('\n') }) });
      await loadLeads();
      render();
      return toast(`已存入 ${j.added} 条`);
    }
    if (act === 'ld-to-camp') {
      const picked = [...S.leadSel].map((i) => S.leadResults[i]);
      if (!picked.length) return toast('先勾选线索', true);
      S.picked = picked.map((r) => ({ to: r.email || r.phone || '', name: r.person || '', co: r.co || '', country: r.country || '' })).filter((t) => t.to);
      S.channel = S.picked.some((t) => /@/.test(t.to)) ? 'mail' : 'wa';
      location.hash = '#/campaign';
      return toast(`已带入 ${S.picked.length} 个收件人`);
    }
    if (act === 'ld-one') {
      const l = S.leads.find((x) => x.id === id);
      if (!l) return;
      S.picked = [{ to: l.email || l.phone, name: l.person, co: l.co, country: l.country }];
      S.channel = l.email ? 'mail' : 'wa';
      location.hash = '#/campaign';
      return;
    }
    if (act === 'ld-del') { await api('/api/leads/' + id, { method: 'DELETE' }); await loadLeads(); await loadCore(); render(); return toast('已删除'); }
    if (act === 'ld-clear') {
      if (!confirm('清空整个线索池？')) return;
      await api('/api/leads/clear', { method: 'POST' });
      await loadLeads();
      render();
      return toast('已清空');
    }

    /* ---- 任务 ---- */
    if (act === 'ch-wa' || act === 'ch-mail') { S.channel = act === 'ch-mail' ? 'mail' : 'wa'; render(); return; }
    if (act === 'cp-clear') { S.picked = []; render(); return; }
    if (act === 'cp-ai') {
      const btn = el;
      btn.disabled = true;
      try {
        const j = await api('/api/llm/draft', { method: 'POST', body: JSON.stringify({ kind: S.channel === 'mail' ? 'mailBody' : 'wa', ctx: { co: '目标客户', country: (S.picked[0] || {}).country || '' } }) });
        const t = $('#cp-text');
        if (t) t.value = j.text;
        toast('已生成，可再手动改');
      } catch (e) {
        toast(e.message, true);
      }
      btn.disabled = false;
      return;
    }
    if (act === 'cp-create') {
      const raw = ($('#cp-targets') || {}).value || '';
      const targets = raw.split(/\r?\n/).map((line) => {
        const cells = line.split(/[,\t;]/).map((x) => x.trim()).filter(Boolean);
        const to = cells.find((c) => /@/.test(c) || /^[+\d][\d\s\-()]{5,}$/.test(c)) || '';
        const rest = cells.filter((c) => c !== to);
        return { to: String(to).replace(/^\+/, ''), name: rest[1] || rest[0] || '', co: rest[0] || '' };
      }).filter((t) => t.to);
      if (!targets.length) return toast('收件人为空', true);
      const accountIds = $$('.cp-acc:checked').map((c) => c.value);
      if (!accountIds.length) return toast('至少选一个发送账号', true);
      const j = await api('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: ($('#cp-name') || {}).value || '',
          channel: S.channel || 'wa',
          subject: ($('#cp-subject') || {}).value || '',
          text: ($('#cp-text') || {}).value || '',
          accountIds,
          targets,
          intervalMin: Number(($('#cp-iv1') || {}).value) || 0,
          intervalMax: Number(($('#cp-iv2') || {}).value) || 0,
        }),
      });
      S.picked = [];
      await loadCore();
      render();
      return toast(`任务已创建，共 ${j.campaign.stats.total} 条，开始发送`);
    }
    if (act === 'camp-filter') { S.filter.camp = id; render(); return; }
    if (act === 'cp-pause' || act === 'cp-resume' || act === 'cp-stop') {
      await api(`/api/campaigns/${id}/${act.replace('cp-', '')}`, { method: 'POST' });
      await loadCore();
      render();
      return toast(act === 'cp-pause' ? '已暂停' : act === 'cp-resume' ? '继续发送' : '已停止');
    }

    /* ---- 回复收件箱 ---- */
    if (act === 'inbox-filter') { S.filter.inbox = id; render(); return; }
    if (act === 'inbox-reload') { await loadInbox(); await loadCore(); render(); return toast('已刷新'); }
    if (act === 'rep-handle') {
      const r = S.replies.find((x) => x.id === id);
      await api(`/api/replies/${id}/handle`, { method: 'POST', body: JSON.stringify({ handled: !(r && r.handled) }) });
      await loadInbox();
      await loadCore();
      render();
      return toast('已更新');
    }
    if (act === 'rep-customer') {
      const r = S.replies.find((x) => x.id === id);
      await loadCustomers();
      location.hash = '#/crm';
      return toast(r ? `客户 ${r.name} 已在客户管理` : '已打开客户管理');
    }
    if (act === 'rep-reply') {
      const r = S.replies.find((x) => x.id === id);
      const box = $('#draft-' + id);
      if (!box) return;
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.innerHTML = '<div class="small muted">正在生成…</div>';
      try {
        const j = await api('/api/llm/draft', { method: 'POST', body: JSON.stringify({ kind: 'reply', ctx: { text: r.text } }) });
        box.innerHTML = `<div class="draft-box">${esc(j.text)}</div>
          <div class="form-actions" style="margin-top:8px">
            <button class="btn btn-sm" data-act="draft-copy" data-id="${id}">复制</button>
            <button class="btn btn-sm" data-act="rep-handle" data-id="${id}">标记已处理</button>
          </div>`;
        bind();
        box.dataset.draft = j.text;
      } catch (e) {
        box.innerHTML = `<div class="small" style="color:var(--accent)">${esc(e.message)}</div>`;
      }
      return;
    }
    if (act === 'rep-manual') {
      const r = S.replies.find((x) => x.id === id);
      const box = $('#draft-' + id);
      if (!box) return;
      if (box.style.display === 'block' && box.dataset.mode === 'manual') { box.style.display = 'none'; box.dataset.mode = ''; return; }
      box.dataset.mode = 'manual';
      box.style.display = 'block';
      const ch = r && r.channel === 'wa' ? 'WhatsApp' : '邮件';
      box.innerHTML = `<div class="manual-box">
        <div class="small muted" style="margin-bottom:6px">通过${ch}回复 <b>${esc(r ? r.from : '')}</b>${r && r.accountLabel ? '（账号：' + esc(r.accountLabel) + '）' : ''}</div>
        <textarea id="mtx-${id}" rows="5" placeholder="输入回复内容…" style="width:100%">${esc((box.dataset.draft || '').trim())}</textarea>
        <div class="form-actions" style="margin-top:8px">
          <button class="btn btn-sm btn-primary" data-act="rep-send" data-id="${id}">发送</button>
          <button class="btn btn-sm" data-act="rep-manual" data-id="${id}">收起</button>
        </div>
        <div class="small" id="msend-${id}" style="margin-top:6px"></div>
      </div>`;
      bind();
      const ta = $('#mtx-' + id);
      if (ta) ta.focus();
      return;
    }
    if (act === 'rep-send') {
      const r = S.replies.find((x) => x.id === id);
      const ta = $('#mtx-' + id);
      const st = $('#msend-' + id);
      if (!r || !ta) return;
      const text = ta.value.trim();
      if (!text) { if (st) st.textContent = '请输入内容'; return; }
      if (st) st.textContent = '发送中…';
      try {
        if (r.channel === 'wa') {
          if (!r.accountId) throw new Error('找不到接收这条消息的 WhatsApp 账号，请到「账号管理」确认在线后重试');
          await api(`/api/wa/${r.accountId}/send`, { method: 'POST', body: JSON.stringify({ to: r.from, text }) });
        } else {
          if (!r.accountId) throw new Error('找不到接收账号，请在邮箱列表里确认账号存在');
          await api(`/api/mail/${r.accountId}/send`, { method: 'POST', body: JSON.stringify({ to: r.from, subject: 'Re: ' + (r.subject || 'Your inquiry'), text }) });
        }
        await api(`/api/replies/${id}/handle`, { method: 'POST', body: JSON.stringify({ handled: true, note: '已手动回复' }) });
        await loadInbox();
        await loadCore();
        render();
        return toast('回复已发送，已标记为已处理');
      } catch (e) {
        if (st) st.textContent = e.message;
        toast(e.message, true);
      }
      return;
    }
    if (act === 'draft-copy') {
      const box = $('#draft-' + id);
      const txt = box ? box.dataset.draft : '';
      if (txt) await navigator.clipboard.writeText(txt).catch(() => {});
      return toast('已复制');
    }

    /* ---- 客户 ---- */
    if (act === 'crm-filter') { S.filter.crm = id; render(); return; }
    if (act === 'crm-grade' || act === 'crm-stage') {
      const key = act === 'crm-grade' ? 'grade' : 'stage';
      await api('/api/customers/' + id, { method: 'PUT', body: JSON.stringify({ [key]: el.value }) });
      toast('已更新');
      return;
    }
    if (act === 'crm-touch') {
      const note = prompt('这次跟进说了什么？（会记进跟进记录）', '');
      if (note === null) return;
      await api('/api/customers/' + id, { method: 'PUT', body: JSON.stringify({ touch: note || '已跟进' }) });
      await loadCustomers();
      render();
      return toast('已记录跟进');
    }
    if (act === 'crm-add') {
      const name = prompt('客户名称', '');
      if (!name) return;
      const contact = prompt('联系方式（邮箱或手机号）', '');
      await api('/api/customers', { method: 'POST', body: JSON.stringify({ name, contact, channel: /@/.test(contact || '') ? 'mail' : 'wa' }) });
      await loadCustomers();
      render();
      return toast('已添加');
    }
    if (act === 'crm-del') {
      if (!confirm('删除这个客户？')) return;
      await api('/api/customers/' + id, { method: 'DELETE' });
      await loadCustomers();
      render();
      return toast('已删除');
    }

    /* ---- 跟进 ---- */
    if (act === 'fu-reload') { await loadFollow(); render(); return toast('已重新检查'); }
    if (act === 'fu-touch') {
      await api('/api/customers/' + id, { method: 'PUT', body: JSON.stringify({ touch: '已在提醒中标记跟进' }) });
      await loadFollow();
      await loadCustomers();
      render();
      return toast('已记录');
    }
    if (act === 'fu-push') {
      const c = S.followups.find((x) => x.id === id);
      if (!c) return;
      S.picked = [{ to: String(c.contact || '').replace(/^\+/, ''), name: c.name, co: c.co, country: c.country }];
      S.channel = c.channel === 'mail' ? 'mail' : 'wa';
      location.hash = '#/campaign';
      return toast('已带入，确认后即可发送催办');
    }

    /* ---- 知识库 ---- */
    if (act === 'kb-save-company') {
      const company = {};
      $$('[data-kb]').forEach((x) => (company[x.dataset.kb] = x.value));
      const j = await api('/api/kb/company', { method: 'PUT', body: JSON.stringify(company) });
      S.kb = j.kb;
      render();
      return toast('已保存');
    }
    if (act === 'kb-test-ai') {
      try {
        const j = await api('/api/llm/draft', { method: 'POST', body: JSON.stringify({ kind: 'wa', ctx: {} }) });
        toast('AI 已连通，可在任务里用它生成文案');
      } catch (e) {
        toast(e.message, true);
      }
      return;
    }
    if (act === 'p-save') {
      const body = {
        name: ($('#p-name') || {}).value || '',
        model: ($('#p-model') || {}).value || '',
        moq: ($('#p-moq') || {}).value || '',
        price: ($('#p-price') || {}).value || '',
        market: ($('#p-market') || {}).value || '',
        desc: ($('#p-desc') || {}).value || '',
      };
      if (!body.name.trim()) return toast('产品名称不能为空', true);
      const e = S.editing.product;
      const j = e && e.id
        ? await api('/api/kb/products/' + e.id, { method: 'PUT', body: JSON.stringify(body) })
        : await api('/api/kb/products', { method: 'POST', body: JSON.stringify(body) });
      S.kb = j.kb;
      S.editing.product = null;
      render();
      return toast(e && e.id ? '已保存修改' : '已新增产品');
    }
    if (act === 'p-edit') { S.editing.product = ((S.kb && S.kb.products) || []).find((p) => p.id === id); render(); return; }
    if (act === 'p-cancel') { S.editing.product = null; render(); return; }
    if (act === 'p-del') {
      if (!confirm('删除这个产品？')) return;
      const j = await api('/api/kb/products/' + id, { method: 'DELETE' });
      S.kb = j.kb;
      render();
      return toast('已删除');
    }
    if (act === 'f-save') {
      const body = { q: ($('#f-q') || {}).value || '', a: ($('#f-a') || {}).value || '', tag: ($('#f-tag') || {}).value || '' };
      if (!body.q.trim()) return toast('问题不能为空', true);
      const e = S.editing.faq;
      const j = e && e.id
        ? await api('/api/kb/faq/' + e.id, { method: 'PUT', body: JSON.stringify(body) })
        : await api('/api/kb/faq', { method: 'POST', body: JSON.stringify(body) });
      S.kb = j.kb;
      S.editing.faq = null;
      render();
      return toast(e && e.id ? '已保存' : '已新增');
    }
    if (act === 'f-edit') { S.editing.faq = ((S.kb && S.kb.faq) || []).find((f) => f.id === id); render(); return; }
    if (act === 'f-cancel') { S.editing.faq = null; render(); return; }
    if (act === 'f-del') {
      if (!confirm('删除这条问答？')) return;
      const j = await api('/api/kb/faq/' + id, { method: 'DELETE' });
      S.kb = j.kb;
      render();
      return toast('已删除');
    }

    if (act === 'cp-fill-country') {
      const c = ($('#cp-country') || {}).value || '全部';
      const list = S.leads.filter((l) => (c === '全部' || l.country === c) && (l.email || l.phone));
      if (!list.length) return toast(`线索池里没有${c === '全部' ? '' : c}的线索`, true);
      const ta = $('#cp-targets');
      if (ta) ta.value = list.map((l) => [l.email || l.phone, l.person, l.co].filter(Boolean).join(', ')).join('\n');
      return toast(`已导入 ${list.length} 个收件人`);
    }
  } catch (e) {
    toast(e.message, true);
  }
}

/* =========================================================
   启动
   ========================================================= */
function onHash() {
  const k = (location.hash || '').replace(/^#\//, '') || 'dashboard';
  route = VIEWS[k] ? k : 'dashboard';
  markNav(route);
  render();
  window.scrollTo({ top: 0 });
  if (route === 'leads' && !S.leads.length) loadLeads().then(render).catch(() => {});
  if (route === 'progress') {
    Promise.all([loadAiJobs(), loadPlans()]).then(render).catch(() => {});
    if (S.openJob) loadJobDetail(S.openJob).then(render).catch(() => {});
  }
  if (route === 'plans') loadPlans().then(render).catch(() => {});
  if (route === 'inbox') loadInbox().then(render).catch(() => {});
  if (route === 'crm') loadCustomers().then(render).catch(() => {});
  if (route === 'follow') loadFollow().then(render).catch(() => {});
  if (route.startsWith('kb-')) loadKB().then(render).catch(() => {});
}

async function ensureAccess() {
  let status = await api('/api/auth/status');
  if (status.platform) {
    S.token = '';
    localStorage.removeItem('wa_token');
    status = await api('/api/auth/status');
  }
  if (status.authed) return true;
  $('#view').innerHTML = `<div class="page-head"><h1>登录私信拓客工作台</h1></div><div class="card" style="max-width:460px;padding:28px">${status.platform
    ? `<p>请从平台主页登录后进入工作台。</p><a class="btn btn-primary" href="${esc(status.platformUrl || '/')}">前往平台主页</a>`
    : '<form id="access-form"><div class="field"><label for="access-password">访问口令</label><input type="password" id="access-password" required autocomplete="current-password"></div><button class="btn btn-primary" type="submit">登录</button><p id="access-error" role="alert"></p></form>'}</div>`;
  const form = $('#access-form');
  if (form) form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#access-password').value }) });
      S.token = result.token;
      localStorage.setItem('wa_token', result.token);
      await boot();
    } catch (error) {
      $('#access-error').textContent = error.message;
      button.disabled = false;
    }
  });
  return false;
}

async function boot() {
  if (!await ensureAccess()) return;
  buildNav();
  onHash();
  window.addEventListener('hashchange', onHash);
  $('#menu-btn').onclick = () => document.body.classList.toggle('side-open');
  $('#scrim').onclick = () => document.body.classList.remove('side-open');
  const tb = $('#theme-btn');
  const saved = localStorage.getItem('wa_theme');
  if (saved) document.documentElement.dataset.theme = saved;
  tb.onclick = () => {
    const next = (document.documentElement.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('wa_theme', next);
  };
  S.channel = 'wa';
  await loadCore().catch(() => {});
  // 恢复上次的 AI 搜索任务（刷新页面不丢结果）
  api('/api/ai/search/latest')
    .then(({ job }) => {
      if (!job) return;
      S.aiJob = job;
      if (job.status === 'running') {
        S.aiBusy = true;
        pollAi(job.id);
      } else if (job.results && job.results.length && !S.leadResults.length) {
        S.leadResults = job.results;
        S.leadSel = new Set(S.leadResults.map((r, i) => (r.match >= 70 ? i : -1)).filter((i) => i >= 0));
      }
      if (route === 'leads') render();
    })
    .catch(() => {});
  render();
  connectSSE();
  setInterval(() => {
    if (!S.es || S.es.readyState === 2) {
      loadCore().then(() => {
        if (['dashboard', 'wa', 'campaign'].includes(route)) render();
      }).catch(() => {});
    }
  }, 15000);

  /* 任务进度：自动刷新（进行中的任务实时更新，不用手动点） */
  setInterval(async () => {
    if (route !== 'progress') return;
    try {
      await Promise.all([loadAiJobs(), loadPlans()]);
      if (S.openJob) await loadJobDetail(S.openJob);
      render();
    } catch (e) {
      /* 静默重试 */
    }
  }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
});
