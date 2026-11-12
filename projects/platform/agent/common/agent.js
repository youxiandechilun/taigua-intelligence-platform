/* ==========================================================
   泰卦智能 · 智能体框架页面 — 公共脚本
   页面只声明 window.AGENT_PAGE 配置，其余由本文件渲染。

   ★ 后端接入方式（重要）★
   1. 把下面的 USE_MOCK 改成 false，页面即改为请求真实接口；
   2. 每个视图函数顶部都注释了【接口路径】和【期望返回结构】，
      后端按结构返回 { code:0, msg:"ok", data:{...} } 即可，前端不用改；
   3. 演示数据由本地生成（刷新保持一致），仅用于展示效果。
   ========================================================== */
(function () {
  'use strict';

  const P = window.AGENT_PAGE || {};
  const SLUG = P.slug || 'agent';
  const MODULES = P.modules || [];

  /* ★★★ 后端就绪后改为 false ★★★ */
  const USE_MOCK = true;
  /* 可选：后端与页面不同源时，在这里填 https://api.xxx.com */
  const API_BASE = window.AGENT_API_BASE || '';

  const DEMO_TIP = '演示页面：该功能暂未接入后端';

  /* ---------- API 封装 ---------- */
  function apiPath(m, it, action) {
    return `${API_BASE}/api/${SLUG}/${m.key || 'm'}/${it.key || 'i'}${action ? '/' + action : ''}`;
  }
  async function api(path, method = 'GET', body) {
    const opt = { method, headers: {}, cache: 'no-store' };
    const token = localStorage.getItem('tk_token') || sessionStorage.getItem('agent_token');
    if (token) opt.headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opt); }
    catch (e) { return { code: -1, msg: '网络异常' }; }
    try { return await res.json(); } catch (e) { return { code: res.status, msg: '服务异常' }; }
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  const $ = sel => document.querySelector(sel);
  function fmt(n) { return Number(n).toLocaleString('zh-CN'); }

  /* ---------- 确定性演示数据 ---------- */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seedStr) {
    let seed = hash(seedStr);
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const NAMES = ['王磊', '李婷', '张伟', '陈晨', '刘洋', '赵静', '孙浩', '周雨', '吴敏', '郑凯', '林芳', '何斌', '高远', '罗雪', '宋阳', '唐妮'];
  const COMPANIES = ['杭州云启电商', '深圳腾跃科技', '广州锦鲤服饰', '上海临舟贸易', '成都星光教育', '北京北辰家居', '义乌海涛日用品', '厦门白鹭食品'];
  const CITIES = ['杭州', '上海', '广州', '深圳', '成都', '北京', '苏州', '武汉'];
  const PLATFORMS_CN = ['抖音', '小红书', '视频号', '微博', '快手', '哔哩哔哩'];
  const PLATFORMS_GL = ['TikTok', 'Instagram', 'Facebook', 'X', 'YouTube', 'WhatsApp'];
  const STAGES = ['新线索', '已触达', '已回复', '高意向', '已成交'];
  const COUNTRIES = ['美国', '英国', '德国', '马来西亚', '泰国', '阿联酋', '澳大利亚'];

  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function intBetween(r, a, b) { return Math.floor(a + r() * (b - a + 1)); }
  function dateStr(r, d) {
    const t = new Date(Date.now() - d * 86400000);
    const p = x => String(x).padStart(2, '0');
    return `${t.getMonth() + 1}-${p(t.getDate())} ${p(intBetween(r, 9, 21))}:${p(intBetween(r, 0, 59))}`;
  }

  /* ---------- 视图类型推断（页面配置里可用 view: 覆盖） ---------- */
  function inferView(m, it) {
    if (it.view) return it.view;
    const n = it.name || '', mn = m.name || '';
    if (/看板|数据管理|通话概览/.test(mn) || /看板|概览|报告$|检测$/.test(n)) return 'dashboard';
    if (mn === '设置中心') return /用量|费用/.test(n) ? 'dashboard' : 'form';
    if (/^(加|发)/.test(n)) {
      return /开发信/.test(n) ? 'form' : 'table';
    }
    if (/登录|账号$|我的企微|微信$|WhatsApp$|邮箱$/.test(n)) return 'accounts';
    if (/新建|开始外呼|框架生成/.test(n)) return 'wizard';
    if (/私信/.test(n)) return 'chat';
    if (/知识库|问答|公司介绍|产品介绍/.test(n)) return 'kb';
    if (/助手|员工$|声音$|素材|我的网站|线路选择|选择员工/.test(n)) return 'grid';
    if (/配置|设置|信息|品牌|通知|大模型|Robots|URL规则|TDK|ALT|Canonical|网站地图|导航管理|任务配置|发开发信|企微$/.test(n)) return 'form';
    return 'table';
  }

  /* ---------- 图标 ---------- */
  const ICON = {
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    info: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  /* ---------- 主题 ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const b = $('#theme-btn');
    if (b) b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
  }
  function initTheme() {
    applyTheme(localStorage.getItem('tk_agent_theme') || 'light');
    const b = $('#theme-btn');
    if (!b) return;
    b.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('tk_agent_theme', next);
      applyTheme(next);
    };
  }

  /* ---------- toast / modal ---------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('agent-toast');
    if (!el) { el = document.createElement('div'); el.id = 'agent-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function closeModal() {
    const m = document.querySelector('.mask.show');
    if (m) m.classList.remove('show');
  }
  function openModal(title, bodyHtml, confirmText) {
    let mask = document.querySelector('.agent-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'mask agent-mask';
      mask.innerHTML = '<div class="modal"><h3></h3><div class="modal-body"></div><div class="modal-foot"></div></div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
    }
    mask.querySelector('h3').textContent = title;
    mask.querySelector('.modal-body').innerHTML = bodyHtml;
    const foot = mask.querySelector('.modal-foot');
    foot.innerHTML = '<button class="btn" data-act="cancel">取消</button>' +
      (confirmText ? `<button class="btn btn-primary" data-act="ok">${esc(confirmText)}</button>` : '');
    foot.onclick = e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'cancel') closeModal();
      if (act === 'ok') { closeModal(); toast(DEMO_TIP); }
    };
    mask.classList.add('show');
  }

  /* ---------- 侧栏与 hash 路由 ---------- */
  function current() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const [a, b] = h.split('/').map(x => parseInt(x, 10));
    if (Number.isInteger(a) && MODULES[a] && Number.isInteger(b) && MODULES[a].items[b]) {
      return { m: MODULES[a], it: MODULES[a].items[b], mi: a, ii: b };
    }
    if (Number.isInteger(a) && MODULES[a]) return { m: MODULES[a], it: MODULES[a].items[0], mi: a, ii: 0 };
    return { m: MODULES[0], it: MODULES[0] && MODULES[0].items[0], mi: 0, ii: 0 };
  }

  function renderSide() {
    const nav = $('#side-nav');
    if (!nav) return;
    const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    nav.innerHTML = MODULES.map((m, mi) => {
      const subs = m.items.map((it, ii) => `
          <a class="side-sub" href="#/${mi}/${ii}" data-mi="${mi}" data-ii="${ii}">
            <span>${esc(it.name)}</span>
          </a>`).join('');
      /* flat: true 的模块不显示分组标题，子项直接作为一级菜单 */
      return m.flat
        ? `<div class="side-group flat">${subs}</div>`
        : `<div class="side-group" data-g="${mi}">
        <div class="g-head" title="点击展开 / 收起"><span>${esc(m.name)}</span><i class="g-line"></i>${CHEV}</div>
        ${subs}
      </div>`;
    }).join('');
    /* 折叠交互：点击分组标题开合；默认全部收起 */
    nav.addEventListener('click', e => {
      const h = e.target.closest('.g-head');
      if (!h) return;
      e.preventDefault();
      h.parentElement.classList.toggle('collapsed');
    });
  }
  /* 展开 hash 对应的分组，其余保持收起 */
  function expandGroup(mi) {
    document.querySelectorAll('#side-nav .side-group[data-g]').forEach(g => {
      g.classList.toggle('collapsed', +g.dataset.g !== mi);
    });
  }
  function markSide(mi, ii) {
    document.querySelectorAll('.side-sub[data-mi]').forEach(el => {
      el.classList.toggle('active', +el.dataset.mi === mi && +el.dataset.ii === ii);
    });
  }

  /* ================================================================
     区域版本：dom = 国内版 / glb = 海外版 / base = 独立站通用版
     ================================================================ */
  const ENV = (P.env === 'glb') ? 'glb' : (P.env === 'base' ? 'base' : 'dom');
  const ENV_LABEL = P.envName || { dom: '国内版', glb: '海外版', base: '通用版' }[ENV];
  const ENV_MARKET = P.market || { dom: '中国大陆 · CN', glb: '全球市场 · GLOBAL', base: '站点 · SEO · GEO' }[ENV];

  /* ================================================================
     视图渲染器
     每个函数注释了【接口路径】【期望返回 data 结构】；
     USE_MOCK=true 时使用同结构的本地演示数据。
     ================================================================ */
  function pageHead(m, it) {
    return `
      <div class="page-head">
        <div class="eyebrow"><i class="bar"></i>${esc(m.flat ? (P.name || m.name) : m.name)}<span class="env-chip ${ENV}">${esc(ENV_LABEL)}</span></div>
        <h1>${esc(it.name)}</h1>
        <p>${esc(it.desc || '')}</p>
      </div>`;
  }
  function demoNote() {
    return USE_MOCK ? `<div class="notice" style="margin-top:18px">${ICON.info}
      <div><b>演示说明</b>：本页数据为前端演示数据，后端按 README 中约定的接口返回后，将自动切换为真实数据。</div></div>` : '';
  }
  const stageBadge = s => {
    const cls = { '高意向': 'red', '已成交': 'green', '已回复': 'blue' }[s] || '';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };

  /* ================= dashboard =================
     【接口】GET {apiPath}          （USE_MOCK=false 时生效）
     【data 结构】
     { kpis:[{name,value,delta}], trend:[{date,value}],
       sources:[{name,value}],
       rows:[{name,region,source,metric,time,stage}] }            */
  function mockDashboard(m, it) {
    const r = rng('dash|' + SLUG + '|' + m.name + it.name);
    return {
      kpis: (P.kpis || ['今日新增', '累计处理', '成功率', '待处理']).map(k => ({
        name: k, value: intBetween(r, 120, 98000), delta: +(r() * 40 - 12).toFixed(1),
      })),
      trend: Array.from({ length: 14 }, (_, i) => ({
        date: (() => { const t = new Date(Date.now() - (13 - i) * 86400000); return `${t.getMonth() + 1}-${String(t.getDate()).padStart(2, '0')}`; })(),
        value: intBetween(r, 200, 9600),
      })),
      sources: (P.env === 'glb' ? PLATFORMS_GL : PLATFORMS_CN).slice(0, 5)
        .map(p => ({ name: p, value: intBetween(r, 800, 9800) })).sort((a, b) => b.value - a.value),
      rows: genRows(m, it, 6),
    };
  }
  function renderDashboard(m, it, data) {
    const W = 560, H = 190, PAD = 10;
    const maxV = Math.max(...data.trend.map(x => x.value)) * 1.15;
    const step = (W - PAD * 2) / 13;
    const poly = data.trend.map((x, i) => `${(PAD + i * step).toFixed(1)},${(H - 18 - x.value / maxV * 140).toFixed(1)}`).join(' ');
    const area = `M${PAD},${H - 18} L` + poly.split(' ').join(' L') + ` L${(PAD + 13 * step).toFixed(1)},${H - 18} Z`;
    const kpiHtml = data.kpis.map(k => `
      <div class="kpi"><div class="k">${esc(k.name)}</div>
        <div class="v">${fmt(k.value)}</div>
        <div class="d ${k.delta >= 0 ? 'up' : 'down'}">较昨日 ${k.delta >= 0 ? '+' : ''}${k.delta}%</div>
      </div>`).join('');
    const maxS = data.sources[0].value;
    const bars = data.sources.map(s => `
      <div class="bar-row"><span class="bar-name">${esc(s.name)}</span>
        <span class="bar-track"><i style="width:${Math.round(s.value / maxS * 100)}%"></i></span>
        <span class="bar-val mono">${fmt(s.value)}</span></div>`).join('');
    const cols = P.tableCols || ['名称', '来源', '数据', '时间'];
    return pageHead(m, it) + `
      <div class="grid grid-4" style="margin-bottom:16px">${kpiHtml}</div>
      <div class="grid grid-2" style="align-items:stretch">
        <div class="card plain">
          <div class="card-h"><h3>近 14 天趋势</h3><span class="r">${USE_MOCK ? '演示数据' : '实时'}</span></div>
          <svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="none">
            <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#c0392b" stop-opacity=".22"/>
              <stop offset="1" stop-color="#c0392b" stop-opacity="0"/></linearGradient></defs>
            <path d="${area}" fill="url(#tg)"/>
            <polyline points="${poly}" fill="none" stroke="#c0392b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${[0, 3, 6, 9, 13].map(i => `<text x="${(PAD + i * step).toFixed(1)}" y="${H - 2}" text-anchor="middle">${esc(data.trend[i].date)}</text>`).join('')}
          </svg>
        </div>
        <div class="card plain">
          <div class="card-h"><h3>渠道来源</h3><span class="r">${USE_MOCK ? '演示数据' : '实时'}</span></div>
          ${bars}
        </div>
      </div>
      <div class="card plain" style="margin-top:16px">
        <div class="card-h"><h3>最新明细</h3><span class="r">${data.rows.length} 条</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}<th>状态</th></tr></thead>
          <tbody>${data.rows.map(x => `<tr>
            <td><b class="cell-b">${esc(x.name)}</b></td><td>${esc(x.source)}</td>
            <td class="mono">${fmt(x.metric)}</td><td class="mono">${esc(x.time)}</td>
            <td>${stageBadge(x.stage)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>` + demoNote();
  }

  /* ================= table =================
     【接口】GET {apiPath}?q=&stage=&page=1
     【data 结构】{ total: Number, list:[{
       name, region, source, metric1, metric2, time, stage, active }] }   */
  function genRows(m, it, n) {
    const r = rng(SLUG + '|' + m.name + '|' + it.name);
    const plats = P.env === 'glb' ? PLATFORMS_GL : PLATFORMS_CN;
    return Array.from({ length: n }, (_, i) => ({
      name: r() > .5 ? pick(r, NAMES) : pick(r, COMPANIES),
      region: P.env === 'glb' ? pick(r, COUNTRIES) : pick(r, CITIES),
      source: pick(r, plats),
      metric1: intBetween(r, 20, 9800),
      metric2: intBetween(r, 100, 98000),
      stage: pick(r, STAGES),
      time: dateStr(r, i),
      active: r() > .3,
    }));
  }
  function mockTable(m, it) { return { total: 9, list: genRows(m, it, 9) }; }
  function renderTable(m, it, data) {
    const cols = P.tableCols || ['名称', '来源', '数据', '时间'];
    return pageHead(m, it) + `
      <div class="toolbar">
        <div class="search-box">${ICON.search}<input id="tb-q" placeholder="搜索名称 / 来源 / 地区" /></div>
        <select id="tb-stage"><option value="">全部状态</option>${STAGES.map(s => `<option>${s}</option>`).join('')}</select>
        <button class="btn btn-primary" id="tb-add">${ICON.plus} 新增</button>
      </div>
      <div class="tbl-wrap" style="margin-top:14px"><table id="tb-t">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}<th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${data.list.map(x => `<tr data-q="${esc((x.name + x.source + x.region).toLowerCase())}" data-stage="${esc(x.stage)}">
            <td><b class="cell-b">${esc(x.name)}</b><span class="cell-sub">${esc(x.region)}</span></td>
            <td>${esc(x.source)}</td>
            <td class="mono">${fmt(x.metric1)} / ${fmt(x.metric2)}</td>
            <td class="mono">${esc(x.time)}</td>
            <td>${stageBadge(x.stage)}</td>
            <td><button class="btn btn-sm row-view">详情</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="pager"><span class="muted small">共 ${data.total} 条</span>
        <span><button class="btn btn-sm" disabled>上一页</button>
        <button class="btn btn-sm btn-primary">1</button>
        <button class="btn btn-sm" disabled>下一页</button></span></div>` + demoNote();
  }
  function bindTable(m, it) {
    const q = $('#tb-q'), st = $('#tb-stage');
    const apply = () => {
      const kw = q.value.trim().toLowerCase(), s = st.value;
      document.querySelectorAll('#tb-t tbody tr').forEach(tr => {
        tr.style.display = (!kw || tr.dataset.q.includes(kw)) && (!s || tr.dataset.stage === s) ? '' : 'none';
      });
    };
    q.oninput = apply; st.onchange = apply;
    $('#tb-add').onclick = () => openModal('新增 · ' + it.name,
      `<div class="field"><label>名称 <em>*</em></label><input id="mv-name" placeholder="请输入名称" /></div>
       <div class="form-row"><div class="field"><label>来源</label><select>${(P.env === 'glb' ? PLATFORMS_GL : PLATFORMS_CN).map(p => `<option>${p}</option>`).join('')}</select></div>
       <div class="field"><label>负责人</label><select>${NAMES.slice(0, 6).map(n => `<option>${n}</option>`).join('')}</select></div></div>
       <div class="field"><label>备注</label><textarea placeholder="选填"></textarea></div>`, '提交');
    document.querySelectorAll('.row-view').forEach(b => b.onclick = () =>
      openModal('详情', '<p class="muted">演示环境：明细数据暂未接入后端。</p>', '知道了'));
  }

  /* ================= accounts =================
     【接口】GET {apiPath}
     【data 结构】{ list:[{ platform, name, account, fans,
       interactions, online, active }] }
     【操作接口】PUT {apiPath}/toggle  { account, active }          */
  function mockAccounts(m, it) {
    const r = rng('acc|' + SLUG + '|' + it.name);
    const plats = P.env === 'glb' ? PLATFORMS_GL : PLATFORMS_CN;
    const colors = ['#c0392b', '#e67e22', '#16a34a', '#3b82f6', '#8b5cf6', '#0ea5e9'];
    return { list: Array.from({ length: 6 }, (_, i) => ({
      platform: plats[i % plats.length], color: colors[i % colors.length],
      name: plats[i % plats.length] + ' · ' + pick(r, NAMES),
      account: plats[i % plats.length].toLowerCase() + '_' + intBetween(r, 1000, 9999),
      fans: intBetween(r, 800, 120000), interactions: intBetween(r, 10, 900),
      online: r() > .25, active: r() > .2,
    })) };
  }
  function renderAccounts(m, it, data) {
    const cards = data.list.map((x, i) => `
      <div class="acc-card ${x.online ? '' : 'off'}">
        <div class="acc-top">
          <span class="acc-ava" style="background:${x.color}">${esc(x.platform[0])}</span>
          <div class="acc-info"><b>${esc(x.name)}</b><span class="mono small">${esc(x.account)}</span></div>
          <label class="switch"><input type="checkbox" data-acc="${esc(x.account)}" ${x.active ? 'checked' : ''}/><i></i></label>
        </div>
        <div class="acc-stats">
          <div><span class="lbl">粉丝</span><span class="val mono">${fmt(x.fans)}</span></div>
          <div><span class="lbl">今日互动</span><span class="val mono">${fmt(x.interactions)}</span></div>
          <div><span class="lbl">状态</span><span class="val"><span class="dot ${x.online ? 'on' : 'off'}"></span>${x.online ? '在线' : '掉线'}</span></div>
        </div>
        <div class="acc-foot"><span class="badge ${x.online ? 'green' : ''}">${x.online ? '托管中' : '待重登'}</span>
          <button class="btn btn-sm acc-more" data-i="${i}">管理</button></div>
      </div>`).join('');
    return pageHead(m, it) + `
      <div class="toolbar">
        <div class="tabs"><button class="tab active">全部 ${data.list.length}</button><button class="tab">托管中</button><button class="tab">异常</button></div>
        <button class="btn btn-primary" id="acc-add">${ICON.plus} 添加账号</button>
      </div>
      <div class="grid grid-3" style="margin-top:14px">${cards}</div>` + demoNote();
  }
  function bindAccounts() {
    document.querySelectorAll('.acc-card .switch input').forEach(sw => {
      sw.onchange = () => toast(USE_MOCK ? DEMO_TIP : '已提交：PUT ' + apiPath(current().m, current().it, 'toggle'));
    });
    document.querySelectorAll('.acc-more').forEach(b => b.onclick = () =>
      openModal('账号管理', '<p class="muted">演示环境：账号详情暂未接入后端。</p>', '知道了'));
    const add = $('#acc-add');
    if (add) add.onclick = () => openModal('添加账号',
      `<div class="field"><label>选择平台</label><select>${(P.env === 'glb' ? PLATFORMS_GL : PLATFORMS_CN).map(p => `<option>${p}</option>`).join('')}</select></div>
       <div class="field"><label>登录方式</label><div class="pay-way"><label class="sel">扫码登录</label><label>账密登录</label></div></div>
       <div class="placeholder" style="padding:26px"><p style="margin:0">此处将展示平台登录二维码</p></div>`, null);
  }

  /* ================= form =================
     【接口】GET {apiPath}          → data: { values:{...字段名:值} }
     【保存】PUT {apiPath}          → body 为表单 JSON                   */
  function mockForm(m, it) {
    return { values: {
      name: it.name + '（默认）', scope: '全部账号', freq: '每天 9:00',
      owner: NAMES[0], note: '演示环境：此处为配置示例。',
      switches: [['自动执行', true], ['失败自动重试', true], ['异常告警通知', true], ['低峰期降速', false], ['数据同步', true]],
    } };
  }
  function renderForm(m, it, data) {
    const v = data.values;
    return pageHead(m, it) + `
      <div class="grid grid-2" style="align-items:start">
        <div class="card plain">
          <div class="card-h"><h3>基础配置</h3><span class="r">${esc(it.name)}</span></div>
          <div class="field"><label>名称 <em>*</em></label><input value="${esc(v.name)}" /></div>
          <div class="form-row">
            <div class="field"><label>适用范围</label><select>${['全部账号', '指定分组', '仅主账号'].map(o => `<option ${o === v.scope ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field"><label>执行频率</label><select>${['实时', '每小时', '每天 9:00', '自定义'].map(o => `<option ${o === v.freq ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>负责人</label><select>${NAMES.slice(0, 5).map(n => `<option ${n === v.owner ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>备注说明</label><textarea>${esc(v.note)}</textarea></div>
        </div>
        <div class="card plain">
          <div class="card-h"><h3>开关与策略</h3></div>
          ${v.switches.map(([n, on]) => `
            <div class="form-line"><div><b>${esc(n)}</b><span>演示配置项</span></div>
              <label class="switch"><input type="checkbox" ${on ? 'checked' : ''}/><i></i></label></div>`).join('')}
          <div class="divider"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn form-reset">重置</button>
            <button class="btn btn-primary form-save">保存配置</button>
          </div>
        </div>
      </div>` + demoNote();
  }
  function bindForm(m, it) {
    document.querySelectorAll('.form-line .switch input').forEach(sw => sw.onchange = () => toast(USE_MOCK ? DEMO_TIP : '已提交：PUT ' + apiPath(m, it)));
    $('.form-save').onclick = () => toast(USE_MOCK ? DEMO_TIP : '已提交：PUT ' + apiPath(m, it));
    $('.form-reset').onclick = () => toast('已还原为演示默认值');
  }

  /* ================= wizard =================
     【接口】GET {apiPath}
     【data 结构】{ staff:[{name,script}], lines:[{name,stock,ok}] }
     【开始执行】POST {apiPath}/start                               */
  function mockWizard(m, it) {
    const r = rng('wiz|' + SLUG + '|' + it.name);
    const isGl = P.env === 'glb';
    return {
      staff: NAMES.slice(0, 4).map(n => ({ name: n, script: pick(r, ['邀约话术 v3', '调研话术 v2', '接待话术 v1', '拓客话术 v2']) })),
      lines: (isGl ? ['国际线路 A · 美国', '国际线路 B · 欧洲', '国际线路 C · 东南亚'] : ['线路 A · 华东', '线路 B · 华南', '线路 C · 华北'])
        .map(l => ({ name: l, stock: intBetween(r, 10, 120), ok: true })),
    };
  }
  function renderWizard(m, it, data) {
    return pageHead(m, it) + `
      <div class="wizard" id="wiz">
        <div class="steps">${['基本信息', '选择员工', '线路选择', '确认开始'].map((s, i) =>
      `<div class="step ${i === 0 ? 'active' : ''}"><span class="no">${i + 1}</span>${s}</div>`).join('')}</div>
        <div class="wpanel" data-panel="0">
          <div class="card plain">
            <div class="form-row">
              <div class="field"><label>任务名称 <em>*</em></label><input value="${esc(it.name)}-示例任务" /></div>
              <div class="field"><label>执行时间</label><input type="time" value="09:30" /></div>
            </div>
            <div class="field"><label>目标名单</label><div class="pay-way"><label class="sel">导入号码包</label><label>从线索库筛选</label></div></div>
            <div class="field"><label>并发数</label><input value="30" /></div>
          </div>
        </div>
        <div class="wpanel" data-panel="1" hidden>
          <div class="grid grid-4">${data.staff.map((s, i) => `
            <div class="pick-card ${i === 0 ? 'sel' : ''}"><b>${esc(s.name)}</b><span>数字员工</span><em>${esc(s.script)}</em></div>`).join('')}</div>
        </div>
        <div class="wpanel" data-panel="2" hidden>
          <div class="grid grid-3">${data.lines.map(l => `
            <div class="pick-card"><b>${esc(l.name)}</b><span class="mono small">并发余量 ${l.stock}</span><span class="badge green">可用</span></div>`).join('')}</div>
        </div>
        <div class="wpanel" data-panel="3" hidden>
          <div class="card plain">
            <div class="sum-line"><span>任务名称</span><b>${esc(it.name)}-示例任务</b></div>
            <div class="sum-line"><span>数字员工</span><b id="sum-staff">${esc(data.staff[0].name)}</b></div>
            <div class="sum-line"><span>外呼线路</span><b id="sum-line">${esc(data.lines[0].name)}</b></div>
            <div class="sum-line"><span>名单数量</span><b class="mono">500</b></div>
            <div class="sum-line"><span>预计时长</span><b class="mono">约 2.5 小时</b></div>
          </div>
        </div>
        <div class="wfoot">
          <button class="btn" id="w-prev" disabled>上一步</button>
          <button class="btn btn-primary" id="w-next">下一步</button>
        </div>
      </div>` + demoNote();
  }
  function bindWizard(m, it) {
    let cur = 0; const total = 4;
    const steps = document.querySelectorAll('#wiz .step');
    const panels = document.querySelectorAll('#wiz .wpanel');
    const prev = $('#w-prev'), next = $('#w-next');
    function go(i) {
      cur = Math.max(0, Math.min(total - 1, i));
      steps.forEach((s, k) => s.classList.toggle('active', k === cur));
      panels.forEach((p, k) => p.hidden = k !== cur);
      prev.disabled = cur === 0;
      next.textContent = cur === total - 1 ? '开始执行' : '下一步';
    }
    prev.onclick = () => go(cur - 1);
    next.onclick = () => { if (cur === total - 1) { toast(USE_MOCK ? DEMO_TIP : '已提交：POST ' + apiPath(m, it, 'start')); return; } go(cur + 1); };
    document.querySelectorAll('#wiz .pick-card').forEach(c => c.onclick = () => {
      c.parentElement.querySelectorAll('.pick-card').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      const b = c.querySelector('b');
      if (!b) return;
      if (c.closest('[data-panel="1"]') && $('#sum-staff')) $('#sum-staff').textContent = b.textContent;
      if (c.closest('[data-panel="2"]') && $('#sum-line')) $('#sum-line').textContent = b.textContent;
    });
    go(0);
  }

  /* ================= chat =================
     【接口】GET {apiPath}
     【data 结构】{ conversations:[{name,last,time,unread,color}],
       messages:[{role:'me'|'bot', text, time}] }
     【发送】POST {apiPath}/send  { text }                          */
  function mockChat(m, it) {
    const r = rng('chat|' + SLUG + '|' + it.name);
    const colors = ['#c0392b', '#16a34a', '#3b82f6', '#8b5cf6', '#e67e22'];
    return {
      conversations: Array.from({ length: 5 }, (_, i) => ({
        name: pick(r, NAMES), color: colors[i],
        last: pick(r, ['在吗？想了解下产品', '好的，什么时候方便', '发个报价看看', '已收到资料，谢谢', '明天有空聊聊吗']),
        time: dateStr(r, i), unread: i < 2 ? intBetween(r, 1, 5) : 0,
      })),
      messages: [
        { role: 'me', text: '您好，看到您对我们产品感兴趣，方便聊聊吗？', time: dateStr(r, 0) },
        { role: 'bot', text: '你好，是的，想了解一下具体方案', time: dateStr(r, 0) },
        { role: 'me', text: '好的，我先发一份介绍资料给您', time: dateStr(r, 0) },
        { role: 'bot', text: '收到，大概什么价位？', time: dateStr(r, 0) },
        { role: 'me', text: '根据用量分档，我拉个对接同事给您详细报价', time: dateStr(r, 0) },
        { role: 'bot', text: '行，越快越好', time: dateStr(r, 0) },
      ],
    };
  }
  function renderChat(m, it, data) {
    return pageHead(m, it) + `
      <div class="grid grid-2" style="align-items:stretch">
        <div class="card plain" style="padding:0">
          <div class="card-h" style="padding:16px 18px 0"><h3>会话列表</h3><span class="r">${data.conversations.length} 个会话</span></div>
          <div class="conv-list">${data.conversations.map((c, i) => `
            <div class="conv ${i === 0 ? 'sel' : ''}">
              <span class="acc-ava" style="background:${c.color}">${esc(c.name[0])}</span>
              <div class="conv-mid"><b>${esc(c.name)}</b><span>${esc(c.last)}</span></div>
              <div class="conv-right"><span class="mono small">${esc(c.time)}</span>${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</div>
            </div>`).join('')}</div>
        </div>
        <div class="card plain" style="padding:0;display:flex;flex-direction:column">
          <div class="card-h" style="padding:16px 18px 0"><h3>对话窗口</h3><span class="r">${stageBadge('高意向')}</span></div>
          <div class="chat-box" id="chat-box">
            ${data.messages.map(x => `<div class="bubble ${x.role}">${esc(x.text)}<span class="t">${esc(x.time)}</span></div>`).join('')}
          </div>
          <div class="chat-input"><input id="chat-in" placeholder="输入内容，回车发送（演示）" /><button class="btn btn-primary" id="chat-send">发送</button></div>
        </div>
      </div>` + demoNote();
  }
  function bindChat(m, it) {
    const box = $('#chat-box'), input = $('#chat-in');
    const send = () => {
      const v = input.value.trim();
      if (!v) return;
      box.insertAdjacentHTML('beforeend', `<div class="bubble me">${esc(v)}<span class="t">刚刚</span></div>`);
      input.value = '';
      box.scrollTop = box.scrollHeight;
      if (!USE_MOCK) api(apiPath(m, it, 'send'), 'POST', { text: v });
    };
    $('#chat-send').onclick = send;
    input.onkeydown = e => { if (e.key === 'Enter') send(); };
    document.querySelectorAll('.conv').forEach(c => c.onclick = () => {
      document.querySelectorAll('.conv').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
    });
    box.scrollTop = box.scrollHeight;
  }

  /* ================= kb =================
     【接口】GET {apiPath}?q=
     【data 结构】{ list:[{ q, a, hits }] }                          */
  function mockKb(m, it) {
    const r = rng('kb|' + SLUG + '|' + it.name);
    const qs = ['你们的产品价格是多少？', '支持免费试用吗？', '交付周期要多久？', '和同类产品比有什么优势？', '售后是怎么服务的？', '能开发票吗？', '支持哪些付款方式？', '可以上门演示吗？'];
    return { list: qs.map((q, i) => ({
      q, hits: intBetween(r, 12, 900),
      a: `这是「${q}」的演示答案。接入知识库后，智能体会依据此处维护的内容自动应答，并持续根据命中率优化表达。`,
    })) };
  }
  function renderKb(m, it, data) {
    return pageHead(m, it) + `
      <div class="toolbar">
        <div class="search-box">${ICON.search}<input id="kb-q" placeholder="搜索问题关键词" /></div>
        <button class="btn btn-primary" id="kb-add">${ICON.plus} 新增问答</button>
      </div>
      <div style="margin-top:14px" id="kb-list">
        ${data.list.map(x => `
        <details class="kb-item"><summary>${esc(x.q)}<span class="badge">${x.hits} 次命中</span></summary>
          <div class="ans">${esc(x.a)}<div class="kb-ops"><button class="btn btn-sm kb-edit">编辑</button><button class="btn btn-sm kb-del">删除</button></div></div>
        </details>`).join('')}
      </div>` + demoNote();
  }
  function bindKb(m, it) {
    const q = $('#kb-q');
    q.oninput = () => {
      const kw = q.value.trim().toLowerCase();
      document.querySelectorAll('.kb-item').forEach(d => {
        d.style.display = !kw || d.textContent.toLowerCase().includes(kw) ? '' : 'none';
      });
    };
    $('#kb-add').onclick = () => openModal('新增问答',
      `<div class="field"><label>问题 <em>*</em></label><input placeholder="客户会怎么问" /></div>
       <div class="field"><label>标准答案</label><textarea placeholder="智能体将按此内容应答"></textarea></div>`, '保存');
    document.querySelectorAll('.kb-edit').forEach(b => b.onclick = () => openModal('编辑问答', '<p class="muted">演示环境：内容编辑暂未接入后端。</p>', '知道了'));
    document.querySelectorAll('.kb-del').forEach(b => b.onclick = () => openModal('删除确认', '<p>确定删除该问答吗？演示环境不会真正删除。</p>', '删除'));
  }

  /* ================= grid =================
     【接口】GET {apiPath}
     【data 结构】{ list:[{ title, sub, desc, progress, region,
       badge, ok }] }                                                */
  function mockGrid(m, it) {
    const r = rng('grid|' + SLUG + '|' + it.name);
    const labels = /助手/.test(it.name) ? ['直播间邀约', '回访调研', '人工接待', '客户跟进', '售后服务', '外贸拓客'] :
      /声音/.test(it.name) ? ['温柔女声', '沉稳男声', '活力女声', '标准男声', '知性女声', '粤语女声'] :
        /素材/.test(it.name) ? ['优秀案例', '异议处理', '开场白', '逼单技巧', '回访模板', '售后安抚'] :
          /网站/.test(it.name) ? ['主站 · en', '主站 · 中文', '促销页', '落地页 A', '落地页 B', '博客站'] : ['主力', '备用', '测试', '主力', '备用', '测试'];
    const colors = ['#c0392b', '#16a34a', '#3b82f6', '#8b5cf6', '#e67e22', '#0ea5e9'];
    return { list: labels.map((t, i) => ({
      title: t + (/声音/.test(it.name) ? '音色' : ''), color: colors[i],
      sub: /素材/.test(it.name) ? '录音时长 ' + intBetween(r, 2, 18) + ' 分钟' : '更新于 ' + dateStr(r, i),
      desc: `${it.name}演示条目：接入后端后展示真实配置与数据。`,
      progress: intBetween(r, 45, 99),
      region: P.env === 'glb' ? pick(r, COUNTRIES) : pick(r, CITIES),
      ok: r() > .4,
    })) };
  }
  function renderGrid(m, it, data) {
    const isVoice = /声音/.test(it.name);
    const cards = data.list.map(x => `
      <div class="g-card">
        <div class="g-top">
          <span class="g-ava" style="background:${x.color}">${esc(x.title[0])}</span>
          <div><b>${esc(x.title)}</b><span class="small muted">${esc(x.sub)}</span></div>
          <span class="badge ${x.ok ? 'green' : ''}">${x.ok ? '已启用' : '未启用'}</span>
        </div>
        <p class="g-desc">${esc(x.desc)}</p>
        <div class="g-prog"><span class="bar-track"><i style="width:${x.progress}%"></i></span><span class="mono small">${x.progress}%</span></div>
        <div class="g-foot"><span class="mono small">${esc(x.region)}</span>
          <span><button class="btn btn-sm g-play">${isVoice ? '试听' : '预览'}</button><button class="btn btn-sm g-cfg">配置</button></span></div>
      </div>`).join('');
    return pageHead(m, it) + `
      <div class="toolbar">
        <div class="tabs"><button class="tab active">全部 ${data.list.length}</button><button class="tab">已启用</button><button class="tab">未启用</button></div>
        <button class="btn btn-primary" id="g-add">${ICON.plus} 新建</button>
      </div>
      <div class="grid grid-3" style="margin-top:14px">${cards}</div>` + demoNote();
  }
  function bindGrid() {
    document.querySelectorAll('.g-cfg').forEach(b => b.onclick = () => openModal('配置', '<p class="muted">演示环境：详细配置暂未接入后端。</p>', '知道了'));
    document.querySelectorAll('.g-play').forEach(b => b.onclick = () => toast('演示页面：暂未接入对应服务'));
    const add = $('#g-add');
    if (add) add.onclick = () => openModal('新建', '<p class="muted">演示环境：新建流程暂未接入后端。</p>', '知道了');
  }

  const RENDERERS = { dashboard: renderDashboard, table: renderTable, accounts: renderAccounts, form: renderForm, wizard: renderWizard, chat: renderChat, kb: renderKb, grid: renderGrid };
  const MOCKERS = { dashboard: mockDashboard, table: mockTable, accounts: mockAccounts, form: mockForm, wizard: mockWizard, chat: mockChat, kb: mockKb, grid: mockGrid };
  const BINDERS = { table: bindTable, accounts: bindAccounts, form: bindForm, wizard: bindWizard, chat: bindChat, kb: bindKb, grid: bindGrid };

  async function renderMain() {
    const { m, it, mi, ii } = current();
    if (!m) return;
    const view = inferView(m, it);
    $('#crumb').innerHTML = `<span>${esc(P.name)}</span><span class="sep">/</span>
      ${m.flat ? '' : `<span>${esc(m.name)}</span><span class="sep">/</span>`}<b>${esc(it.name)}</b>`;
    const envEl = $('#env-tag');
    if (envEl) {
      envEl.textContent = ENV_LABEL + ' · ' + ENV_MARKET;
      envEl.className = 'tag-env ' + ENV;
    }
    markSide(mi, ii);
    expandGroup(mi);
    $('#view').innerHTML = '<div class="loading">加载中…</div>';

    let data;
    if (USE_MOCK) data = MOCKERS[view](m, it);
    else {
      const j = await api(apiPath(m, it));
      data = (j && j.code === 0 && j.data) ? j.data : MOCKERS[view](m, it);
      if (!j || j.code !== 0) toast('接口未就绪，已展示演示数据：' + (j && j.msg || ''));
    }
    $('#view').innerHTML = (RENDERERS[view] || renderTable)(m, it, data);
    if (BINDERS[view]) BINDERS[view](m, it);
    window.scrollTo(0, 0);
  }

  /* ---------- 窄屏抽屉 ---------- */
  function initDrawer() {
    const topbar = document.querySelector('.topbar');
    if (topbar && !document.getElementById('menu-btn')) {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.id = 'menu-btn';
      b.type = 'button';
      b.title = '菜单';
      b.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      topbar.insertBefore(b, topbar.firstChild);
    }
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    document.body.appendChild(scrim);
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.closest && t.closest('#menu-btn')) { document.body.classList.toggle('side-open'); return; }
      if (t.classList && t.classList.contains('scrim')) { document.body.classList.remove('side-open'); return; }
      if (t.closest && t.closest('.sidebar a')) document.body.classList.remove('side-open');
    });
  }

  function boot() {
    document.body.classList.add('env-' + ENV);
    initTheme();
    initDrawer();
    if (!MODULES.length) return;
    document.title = (P.title || P.name) + ' - 泰卦智能';
    renderSide();
    renderMain();
    window.addEventListener('hashchange', renderMain);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
