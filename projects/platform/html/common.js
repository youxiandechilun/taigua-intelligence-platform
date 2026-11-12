/* ==========================================================
   泰卦智能 · 商家服务平台 — 公共脚本
   ========================================================== */

/* ---------- API 封装 ---------- */
const TOKEN = localStorage.getItem('tk_token') || '';
async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Authorization': 'Bearer ' + TOKEN }, cache: 'no-store' };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  // 统一超时，避免个别请求挂住占满浏览器连接、导致页面看起来卡死
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 8000);
  opt.signal = ctl.signal;
  let res;
  try { res = await fetch(path, opt); }
  catch (e) { clearTimeout(tid); return { code: -1, msg: (e && e.name === 'AbortError') ? '请求超时' : '网络异常' }; }
  clearTimeout(tid);
  let j;
  try { j = await res.json(); } catch (e) { j = { code: res.status, msg: '服务异常' }; }
  return j;
}

/* ---------- 登录守卫 ---------- */
async function requireAuth() {
  if (!TOKEN) { location.href = '/qt'; return null; }
  const j = await api('/api/auth/me');
  if (j.code !== 0) { localStorage.removeItem('tk_token'); location.href = '/qt'; return null; }
  window.ME = j.data;
  return window.ME;
}

/* ---------- 侧边导航 ---------- */
const ICONS = {
  merchant: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-6h6v6"/></svg>',
  agent: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 14.5a5 5 0 0 0 7 0"/></svg>',
  token: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7c0 2.4-5 1.6-5 4 0 1 1 1.7 2.5 1.7s2.5-.7 2.5-1.7"/></svg>',
  support: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M4 13a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM20 13a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2 1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1z"/></svg>',
  about: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-1-8.9 6 6 0 0 0-11.6 1.6A3.5 3.5 0 0 0 6 19z"/></svg>',
  admin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.2-3.6A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h7M8.5 8.5h4"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  site: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.9 5.7 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.7-3.9-9S9.4 5.6 12 3z"/></svg>',
  cart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="17.5" cy="20" r="1.6"/><path d="M2.5 4h2.2l2.5 11.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L20.5 8H5.3"/></svg>',
};
function buildSidebar(active, siteEntry) {
  // 商家端不再提供任何管理后台入口：管理端有独立登录页，两侧入口完全隔离
  const site = siteEntry && Number(siteEntry.enabled) && siteEntry.url ? siteEntry : null;
  const items = [
    ['merchant.html', 'merchant', '商家信息'],
    ['agents.html', 'agent', '智能体管理'],
    ...(site ? [['__site__', 'site', site.name || '独立站创建']] : []),
    ['recharge.html', 'token', 'TOKEN 充值'],
    ['support.html', 'support', '客服中心'],
    ['about.html', 'about', '关于泰卦'],
  ];
  let nav = items.map(([file, ic, label]) => {
    if (file === '__site__') {
      // 外链条目：地址由管理后台配置，可在新标签打开
      const tgt = Number(site.new_tab) ? ' target="_blank" rel="noopener"' : '';
      return `<a class="side-item" href="${esc(site.url)}"${tgt} title="${esc(site.desc || '')}">${ICONS[ic]}<span>${esc(label)}</span></a>`;
    }
    return `<a class="side-item${active === file ? ' active' : ''}" href="/zt/${file.replace('.html', '')}">${ICONS[ic]}<span>${label}</span></a>`;
  }).join('');
  return `
  <aside class="sidebar">
    <div class="side-logo"><a href="/"><img src="../assets/logo.jpg" alt="泰卦智能 TAIKUA"></a></div>
    <nav class="side-nav">${nav}</nav>
    <div class="side-foot">
      <div class="side-user">${ME ? ME.phone + ' · 商家' : ''}</div>
      <a class="side-item" id="theme-toggle">${ICONS.moon}<span>深色模式</span></a>
      <a class="side-item" id="logout-btn">${ICONS.logout}<span>退出登录</span></a>
    </div>
  </aside>`;
}

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = localStorage.getItem('tk-theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
}
function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = localStorage.getItem('tk-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('tk-theme', cur);
    applyTheme();
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
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
  mask.querySelector('#modal').className = 'modal' + (wide ? ' wide' : '');
  mask.querySelector('#modal').innerHTML = html;
  mask.classList.add('show');
}
function closeModal() {
  const mask = document.getElementById('mask');
  if (mask) mask.classList.remove('show');
}

/* ---------- 工具 ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(s) { return (s || '').replace('T', ' ').slice(0, 16); }
function maskPhone(p) { return p ? p.slice(0, 3) + '****' + p.slice(7) : ''; }
function copyText(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('已复制'));
  else {
    const i = document.createElement('textarea'); i.value = t; document.body.appendChild(i);
    i.select(); document.execCommand('copy'); i.remove(); toast('已复制');
  }
}

/* 页面初始化（控制台页通用） */
async function initConsole(active) {
  applyTheme();
  const me = await requireAuth();
  if (!me) return null;
  let siteEntry = null;
  try {
    const sj = await api('/api/site-entries');
    if (sj.code === 0) siteEntry = sj.data.standalone;
  } catch (e) { siteEntry = null; }
  window.SITE_ENTRY = siteEntry;
  document.getElementById('sidebar-root').innerHTML = buildSidebar(active, siteEntry);
  initThemeToggle();
  initLogout();
  checkAnnouncements();   // 进入页面即提示未读公告，点「我知道了」后不再弹
  return me;
}

/* ---------- 平台公告弹窗（进入即提示 / 确认后不再弹） ---------- */
async function checkAnnouncements() {
  try {
    const j = await api('/api/announcements');
    if (j.code !== 0 || !j.data || !j.data.length) return;
    let ack = [];
    try { ack = JSON.parse(localStorage.getItem('ann_ack') || '[]'); } catch (e) { ack = []; }
    const fresh = j.data.filter(a => !ack.includes(a.id));
    if (!fresh.length) return;
    window._annFresh = fresh;
    openModal(`
      <h3>📢 平台公告</h3>
      <div style="max-height:56vh;overflow:auto;margin:16px 0 4px">
        ${fresh.map(a => `
          <div style="padding:13px 15px;margin-bottom:10px;border:1px solid ${a.level === '重要' ? 'rgba(192,57,43,.3)' : 'var(--border)'};
            background:${a.level === '重要' ? 'var(--accent-soft)' : 'var(--bg-soft)'};border-radius:12px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
              <span class="badge ${a.level === '重要' ? 'red' : ''}">${a.level === '重要' ? '重要' : '公告'}</span>
              <b style="font-size:13.5px">${esc(a.title)}</b>
            </div>
            <div class="small muted" style="white-space:pre-wrap;line-height:1.7">${esc(a.content)}</div>
            <div class="mono" style="font-size:11px;color:var(--muted-2);margin-top:6px">${fmtTime(a.published_at)}</div>
          </div>`).join('')}
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" onclick="ackAnnouncements()">我知道了</button>
      </div>
    `, true);
  } catch (e) { /* 公告失败不打扰主流程 */ }
}
function ackAnnouncements() {
  let ack = [];
  try { ack = JSON.parse(localStorage.getItem('ann_ack') || '[]'); } catch (e) { ack = []; }
  (window._annFresh || []).forEach(a => { if (!ack.includes(a.id)) ack.push(a.id); });
  localStorage.setItem('ann_ack', JSON.stringify(ack.slice(-100)));
  window._annFresh = null;
  closeModal();
}

/* ---------- 退出登录 ---------- */
function initLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!confirm('确定退出登录？')) return;
    try { await api('/api/auth/logout', 'POST'); } catch (e) { }
    localStorage.removeItem('tk_token');
    location.href = '/qt';
  });
}
