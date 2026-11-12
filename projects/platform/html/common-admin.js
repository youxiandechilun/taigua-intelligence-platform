/* ==========================================================
   泰卦智能 · 管理后台 — 公共脚本
   依赖 common.css + common-admin.css
   ========================================================== */

const TOKEN = localStorage.getItem('tk_token') || '';
/* 管理端专属登录入口（与商家登录页完全隔离） */
const ADMIN_LOGIN = '/ht';

/* ---------- 请求封装 ---------- */
async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Authorization': 'Bearer ' + TOKEN } };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opt);
  } catch (e) {
    return { code: -1, msg: '网络异常，请检查后端是否已启动' };
  }
  let j;
  try { j = await res.json(); } catch (e) { j = { code: res.status, msg: '服务异常（' + res.status + '）' }; }
  if (j.code === 401) {
    localStorage.removeItem('tk_token');
    location.href = ADMIN_LOGIN;
  }
  return j;
}

/* ---------- 图标 ---------- */
const AICONS = {
  dash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  shop: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-6h6v6"/></svg>',
  agent: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M12 7V3M8 3h8"/></svg>',
  coin: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7c0 2.4-5 1.6-5 4 0 1 1 1.7 2.5 1.7s2.5-.7 2.5-1.7"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 9v6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 20a2 2 0 0 0 3 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 4-6 7.5-6s6.7 2 7.5 6"/></svg>',
  log: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V8a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  store: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v10h16V9"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  headset: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="13" width="4" height="7" rx="2"/><rect x="18" y="13" width="4" height="7" rx="2"/><path d="M19 20v1a2 2 0 0 1-2 2h-3"/></svg>',
  site: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.9 5.7 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.7-3.9-9S9.4 5.6 12 3z"/></svg>',
  card: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
};

/* ---------- 导航配置 ---------- */
const ADM_NAV = [
  { group: '概览', items: [['admin.html', 'dash', '数据总览', 'dash']] },
  {
    group: '运营管理', items: [
      ['admin-merchants.html', 'shop', '商家管理', 'pending'],
      ['admin-agents.html', 'agent', '智能体管理', ''],
      ['admin-site.html', 'site', '独立站入口', ''],
      ['admin-points.html', 'coin', '点数与流水', ''],
      ['admin-redeem.html', 'ticket', '兑换码管理', ''],
      ['admin-tickets.html', 'ticket', '工单管理', 'tickets'],
      ['admin-announcements.html', 'bell', '公告管理', ''],
    ]
  },
  {
    group: '客服与 AI', items: [
      ['admin-cs.html', 'headset', '客服团队', ''],
      ['admin-kb.html', 'spark', 'AI 客服与知识库', ''],
    ]
  },
  {
    group: '系统', items: [
      ['admin-accounts.html', 'user', '管理员账号', ''],
      ['admin-logs.html', 'log', '操作日志', ''],
      ['admin-pay.html', 'card', '支付配置', ''],
      ['admin-tiers.html', 'coin', '充值档位', ''],
      ['admin-settings.html', 'gear', '系统设置', ''],
    ]
  },
];

const PAGE_TITLES = {
  'admin.html': '数据总览',
  'admin-merchants.html': '商家管理',
  'admin-agents.html': '智能体管理',
  'admin-site.html': '独立站入口',
  'admin-points.html': '点数与流水',
  'admin-redeem.html': '兑换码管理',
  'admin-tickets.html': '工单管理',
  'admin-announcements.html': '公告管理',
  'admin-cs.html': '客服团队',
  'admin-kb.html': 'AI 客服与知识库',
  'admin-accounts.html': '管理员账号',
  'admin-logs.html': '操作日志',
  'admin-pay.html': '支付配置',
  'admin-tiers.html': '充值档位',
  'admin-settings.html': '系统设置',
};

/* ---------- 侧栏 + 顶栏 ---------- */
function buildAdmShell(active) {
  const nav = ADM_NAV.map(g => {
    const items = g.items.map(([href, ic, label, badgeKey]) => {
      const badge = badgeKey ? `<span class="num" id="bd-${badgeKey}" style="display:none">0</span>` : '';
      return `<a class="adm-item${active === href ? ' active' : ''}" href="/ht/${href.replace('.html', '')}">${AICONS[ic]}<span>${label}</span>${badge}</a>`;
    }).join('');
    return `<div class="adm-group">${g.group}</div>${items}`;
  }).join('');
  const name = (window.ME && (window.ME.company || window.ME.phone)) || '管理员';
  return {
    side: `
    <aside class="adm-side">
      <div class="adm-logo">
        <a href="/ht/admin"><img src="../assets/logo.jpg" alt="泰卦智能" /></a>
        <span class="tag">ADMIN</span>
      </div>
      <nav class="adm-nav">${nav}</nav>
      <div class="adm-foot">
        <div class="u">
          <div class="av">${esc(name.slice(0, 1))}</div>
          <div style="min-width:0"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${esc(name)}</b><small style="color:#71717a">超级管理员</small></div>
        </div>
      </div>
    </aside>`,
    top: `
    <header class="adm-top">
      <div class="crumb">管理后台 <span style="color:var(--muted-2)">/</span> <b>${PAGE_TITLES[active] || '控制台'}</b></div>
      <div class="spacer"></div>
      <a class="t-act" href="/html/agent-console.html" target="_blank" title="打开客服工作台">${AICONS.headset}<span>客服工作台</span></a>
      <a class="t-act" href="/zt/merchant" title="以当前账号进入商家端">${AICONS.store}<span>商家端</span></a>
      <a class="t-act" id="adm-theme" title="切换深浅色">${AICONS.moon}</a>
      <a class="t-act" onclick="location.reload()" title="刷新页面">${AICONS.refresh}</a>
      <a class="t-act" id="adm-logout" title="退出登录">${AICONS.logout}<span>退出</span></a>
    </header>`,
  };
}

/* ---------- 主题 ---------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('tk-theme') || 'light');
}

/* ---------- 初始化 ---------- */
async function admInit(active) {
  applyTheme();
  if (!TOKEN) { location.href = ADMIN_LOGIN; return null; }
  const j = await api('/api/auth/me');
  if (j.code !== 0) { location.href = ADMIN_LOGIN; return null; }
  if (j.data.role !== 'admin') {
    // 商家账号的登录态不能用于后台，清除后回管理员登录页
    localStorage.removeItem('tk_token');
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-family:system-ui;color:#71717a;gap:12px">'
      + '<div style="font-size:15px">当前账号不是管理员，无法访问管理后台</div>'
      + '<a href="' + ADMIN_LOGIN + '" style="padding:9px 18px;border-radius:9px;background:#18181b;color:#fff;text-decoration:none;font-size:13px">前往管理员登录</a></div>';
    return null;
  }
  window.ME = j.data;

  const shell = buildAdmShell(active);
  document.getElementById('adm-side-root').outerHTML = shell.side;
  document.getElementById('adm-top-root').outerHTML = shell.top;

  const themeBtn = document.getElementById('adm-theme');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const cur = localStorage.getItem('tk-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('tk-theme', cur);
    applyTheme();
  });
  const outBtn = document.getElementById('adm-logout');
  if (outBtn) outBtn.addEventListener('click', async () => {
    if (!confirm('确定退出登录？')) return;
    try { await api('/api/auth/logout', 'POST'); } catch (e) { }
    localStorage.removeItem('tk_token');
    location.href = ADMIN_LOGIN;
  });

  loadBadges();
  return window.ME;
}

/* 侧栏角标：待审核商家 / 未关闭工单 */
async function loadBadges() {
  const j = await api('/api/admin/stats');
  if (j.code !== 0) return;
  const map = { pending: j.data.pending, tickets: j.data.tickets_open };
  Object.keys(map).forEach(k => {
    const el = document.getElementById('bd-' + k);
    if (el && map[k] > 0) { el.textContent = map[k] > 99 ? '99+' : map[k]; el.style.display = ''; }
  });
}

/* ---------- 轻提示 ---------- */
let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- 弹窗 ---------- */
function openModal(html, wide) {
  let mask = document.getElementById('mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'mask'; mask.className = 'mask';
    mask.innerHTML = '<div class="modal" id="modal"></div>';
    mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
    document.body.appendChild(mask);
  }
  const box = mask.querySelector('#modal');
  box.className = 'modal' + (wide ? ' wide' : '');
  box.innerHTML = html;
  mask.classList.add('show');
}
function closeModal() {
  const mask = document.getElementById('mask');
  if (mask) mask.classList.remove('show');
}

/* ---------- 抽屉 ---------- */
function openDrawer(title, html, footHtml) {
  let mask = document.getElementById('dw-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'dw-mask'; mask.className = 'drawer-mask';
    mask.innerHTML = '<div class="drawer" id="drawer"><div class="drawer-h"><b id="dw-title"></b>'
      + '<button class="x" onclick="closeDrawer()">✕</button></div>'
      + '<div class="drawer-b" id="dw-body"></div><div class="drawer-f" id="dw-foot"></div></div>';
    mask.addEventListener('click', e => { if (e.target === mask) closeDrawer(); });
    document.body.appendChild(mask);
  }
  document.getElementById('dw-title').textContent = title;
  document.getElementById('dw-body').innerHTML = html;
  const foot = document.getElementById('dw-foot');
  foot.innerHTML = footHtml || '';
  foot.style.display = footHtml ? '' : 'none';
  mask.classList.add('show');
  document.getElementById('drawer').classList.add('show');
}
function closeDrawer() {
  const mask = document.getElementById('dw-mask');
  if (mask) mask.classList.remove('show');
  const d = document.getElementById('drawer');
  if (d) d.classList.remove('show');
}

/* ---------- 分页控件 ---------- */
function renderPager(el, total, page, size, onGo) {
  const pages = Math.max(1, Math.ceil(total / size));
  window.__pagerCb = onGo;
  let nums = [];
  const push = n => { if (!nums.includes(n)) nums.push(n); };
  push(1);
  for (let i = page - 2; i <= page + 2; i++) if (i > 1 && i < pages) push(i);
  if (pages > 1) push(pages);
  nums.sort((a, b) => a - b);
  let html = `<div class="pager"><div class="info">共 ${total} 条 · 第 ${page}/${pages} 页</div>`;
  html += `<button ${page <= 1 ? 'disabled' : ''} onclick="__pagerCb(${page - 1})">‹</button>`;
  let last = 0;
  nums.forEach(n => {
    if (last && n - last > 1) html += '<span style="color:var(--muted-2);font-size:12px">…</span>';
    html += `<button class="${n === page ? 'on' : ''}" onclick="__pagerCb(${n})">${n}</button>`;
    last = n;
  });
  html += `<button ${page >= pages ? 'disabled' : ''} onclick="__pagerCb(${page + 1})">›</button></div>`;
  el.innerHTML = html;
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(s) { return (s || '').replace('T', ' ').slice(0, 16) || '—'; }
function maskPhone(p) { return p && p.length === 11 ? p.slice(0, 3) + '****' + p.slice(7) : (p || '—'); }
function num(n) { return (n == null ? 0 : Number(n)).toLocaleString('zh-CN'); }
function copyText(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('已复制'));
  else {
    const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i);
    i.select(); document.execCommand('copy'); i.remove(); toast('已复制');
  }
}
function statusBadge(s) {
  const map = {
    '已认证': 'badge green', '待审核': 'badge warn', '已驳回': 'badge red', '已过期': 'badge',
    '处理中': 'badge warn', '已关闭': 'badge green',
    'running': 'badge green', 'stopped': 'badge', 'published': 'badge green',
    'draft': 'badge warn', 'offline': 'badge',
  };
  const label = { running: '运行中', stopped: '已停用', published: '已发布', draft: '草稿', offline: '已下线' }[s] || s;
  return `<span class="${map[s] || 'badge'}">${esc(label)}</span>`;
}
/* 下载（带 token） */
function download(kind) {
  const url = '/api/admin/export/' + kind + '?token=' + encodeURIComponent(TOKEN);
  window.open(url, '_blank');
  toast('正在导出 CSV…');
}
