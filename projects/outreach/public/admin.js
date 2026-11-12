'use strict';
/* =========================================================
   管理后台 — 顾客端以外的配置全部收在这里
   ========================================================= */

const TOKEN_KEY = 'wa_admin_token';

const S = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  view: 'overview',
  st: null,
  ov: null,
  sys: null,
  storage: null,
  saving: false,
};

const NAV = [
  { g: '总览', items: [{ k: 'overview', t: '系统概览' }] },
  { g: 'AI 能力', items: [{ k: 'llm', t: '大模型接口' }, { k: 'search', t: 'AI 在线搜索' }] },
  { g: '运行策略', items: [{ k: 'send', t: '发送策略' }, { k: 'follow', t: '留资与跟进' }] },
  { g: '系统', items: [{ k: 'data', t: '数据与运行' }] },
];

const META = {
  overview: { g: '总览', t: '系统概览', d: '一眼看清服务状态、账号规模、今日收发与各项配置是否就绪。' },
  llm: { g: 'AI 能力', t: '大模型接口', d: 'AI 找线索、写开发信、起草回复都依赖它。兼容 OpenAI 协议的任意服务都能接。' },
  search: { g: 'AI 能力', t: 'AI 在线搜索', d: '实时检索通道的密钥与数据源。顾客端只填关键词和国家，这里配的东西他们看不到。' },
  send: { g: '运行策略', t: '发送策略', d: '单号日上限、间隔、换号节奏。这些数值直接决定账号能活多久。' },
  follow: { g: '留资与跟进', t: '留资与跟进', d: '首跟间隔、超期提醒、A 类客户识别关键词。' },
  data: { g: '系统', t: '数据与运行', d: '数据文件、会话目录、运行环境与演示数据。' },
};

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (t, cls = '') => `<span class="badge ${cls}">${esc(t)}</span>`;
const notice = (txt, kind = '') => `<div class="notice ${kind}">
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
  <div>${txt}</div></div>`;
const head = (k, right = '') => {
  const m = META[k];
  return `<div class="page-head">
    <div class="eyebrow"><span class="bar"></span>${esc(m.g)}</div>
    <h1>${esc(m.t)}</h1>
    <p>${esc(m.d)}</p>
    ${right ? `<div style="margin-top:14px">${right}</div>` : ''}
  </div>`;
};
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const fmtUp = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
};

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (bad ? ' bad' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = 'toast'), 2600);
}

async function api(url, opt = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers || {});
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  const r = await fetch(url, Object.assign({}, opt, { headers }));
  const j = await r.json().catch(() => ({ ok: false, error: '返回解析失败' }));
  if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/* ---------------- 数据 ---------------- */
async function loadAll() {
  const [st, ov, storage] = await Promise.all([
    api('/api/settings').catch(() => null),
    api('/api/overview').catch(() => null),
    api('/api/admin/storage').catch(() => null),
  ]);
  S.st = st ? st.settings : S.st;
  S.ov = ov;
  S.storage = storage;
}

/* ---------------- 视图 ---------------- */
function viewOverview() {
  const ov = S.ov || {};
  const st = S.st || {};
  const l = st.llm || {}, ld = st.lead || {};
  const wa = ov.wa || {}, mail = ov.mail || {}, today = ov.today || { wa: {}, mail: {} };
  const kpi = (k, v, d = '') => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

  return `${head('overview')}
    <div class="adm-grid4" style="margin-bottom:18px">
      ${kpi('WhatsApp 账号', `${wa.online || 0}<span style="font-size:14px;color:var(--muted)"> / ${wa.total || 0}</span>`, '在线 / 总数')}
      ${kpi('邮箱账号', `${mail.ready || 0}<span style="font-size:14px;color:var(--muted)"> / ${mail.total || 0}</span>`, '可用 / 总数')}
      ${kpi('今日发送', (today.all && today.all.sent) || 0, `WA ${(today.wa && today.wa.sent) || 0} · 邮件 ${(today.mail && today.mail.sent) || 0}`)}
      ${kpi('今日回复', ((ov.replies && ov.replies.today) || 0), `累计线索 ${ov.leads || 0}`)}
    </div>

    <div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>配置就绪情况</h3><span class="r">READINESS</span></div>
      <div class="adm-list">
        <div class="adm-row">
          <span>大模型（AI 能力）</span>
          <span>${l.configured ? badge('已就绪', 'green') : badge('未配置', 'red')}<i class="adm-note">${esc(l.model || '')}${l.host ? ' · ' + esc(l.host) : ''}</i></span>
        </div>
        <div class="adm-row">
          <span>实时检索通道</span>
          <span>${ld.searchConfigured ? badge((ld.searchProvider === 'tavily' ? 'Tavily' : 'Serper') + ' 已配置', 'green') : badge('免费检索源', 'warn')}</span>
        </div>
        <div class="adm-row">
          <span>访问方式</span>
          <span>${badge('免登录直接进入', 'green')}</span>
        </div>
        <div class="adm-row">
          <span>运行模式</span>
          <span>${(S.storage && S.storage.mock) ? badge('演示模式', 'warn') : badge('正式运行', 'green')}<i class="adm-note">已运行 ${fmtUp((S.storage && S.storage.uptime) || 0)}</i></span>
        </div>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-primary" data-act="go" data-view="llm">去配置大模型</button>
        <button class="btn" data-act="go" data-view="search">去配置检索通道</button>
        ${S.storage && S.storage.mock ? '<button class="btn" data-act="demo-seed">填充演示数据</button>' : ''}
      </div>
    </div>

    <div class="card plain">
      <div class="card-h"><h3>顾客端会看到什么</h3><span class="r">CUSTOMER VIEW</span></div>
      ${notice('顾客打开的是业务控制台（看板、账号、AI 找线索、群发、留资、知识库），<b>没有「后端配置」入口，也拿不到任何密钥</b>。他们只会在页面上看到「AI 已启用 / 未启用」这种状态。', 'info')}
      <div class="adm-mono">
        顾客端 <span class="mono">/</span>　　管理后台 <span class="mono">/admin</span>
      </div>
    </div>`;
}

function viewLLM() {
  const l = (S.st && S.st.llm) || {};
  return `${head('llm', `<div class="toolbar">
      ${l.configured ? badge('当前已启用', 'green') : badge('当前未启用', 'warn')}
      <span class="small muted" style="margin-left:auto">密钥保存后不再回显，只显示前后几位</span>
    </div>`)}
    <div class="card plain">
      <div class="card-h"><h3>接口参数</h3><span class="r">OPENAI COMPATIBLE</span></div>
      ${notice('兼容 OpenAI 协议的服务都能用：OpenAI、DeepSeek、通义千问、智谱、月之暗面、Kimi、本地 vLLM / Ollama。Base URL 一般要带 <b>/v1</b>，程序会自动拼 <b>/chat/completions</b>。', 'info')}
      <div class="form-row">
        <div class="field"><label>接口地址 Base URL</label><input type="text" id="llm-url" value="${esc(l.baseUrl || '')}" placeholder="https://api.deepseek.com/v1" /></div>
        <div class="field"><label>模型名</label><input type="text" id="llm-model" value="${esc(l.model || '')}" placeholder="deepseek-chat / gpt-4o-mini / qwen-plus" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>密钥 API Key</label><input type="password" id="llm-key" placeholder="${l.hasKey ? '已保存（' + esc(l.keyMask) + '），留空不修改' : 'sk-...'}" /></div>
        <div class="field"><label>启用状态</label>
          <select id="llm-enabled"><option value="1" ${l.enabled ? 'selected' : ''}>启用</option><option value="0" ${l.enabled ? '' : 'selected'}>停用</option></select>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="save-llm">保存</button>
        <button class="btn" data-act="test-llm">测试连通</button>
        <span class="small muted" id="llm-msg" style="align-self:center"></span>
      </div>
    </div>`;
}

function viewSearch() {
  const ld = (S.st && S.st.lead) || {};
  return `${head('search', `<div class="toolbar">
      ${ld.searchConfigured ? badge((ld.searchProvider === 'tavily' ? 'Tavily' : 'Serper') + ' 已配置', 'green') : badge('使用免费检索源', 'warn')}
    </div>`)}
    <div class="card plain" style="margin-bottom:18px">
      <div class="card-h"><h3>实时检索通道</h3><span class="r">SEARCH API</span></div>
      ${notice('AI 在线搜索 = 大模型（上一页）+ 实时检索。检索负责找最新网页，大模型负责整理和打分。<b>不配密钥也能跑</b>，但免费源慢、容易被限流，批量找线索建议配 Serper 或 Tavily（按次计费，成本很低）。', 'info')}
      <div class="form-row">
        <div class="field"><label>通道</label>
          <select id="ld-provider">
            <option value="serper" ${ld.searchProvider === 'serper' ? 'selected' : ''}>Serper（Google 结果 / 推荐）</option>
            <option value="tavily" ${ld.searchProvider === 'tavily' ? 'selected' : ''}>Tavily（带正文摘要）</option>
          </select></div>
        <div class="field"><label>密钥 API Key</label><input type="password" id="ld-key" placeholder="${ld.hasSearchKey ? '已保存（' + esc(ld.searchKeyMask) + '），留空不修改' : '不填则用免费检索源'}" /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>结果默认条数</label><input type="text" id="ld-page" value="${ld.pageSize || 30}" /></div>
        <div class="field"><label>补充数据源接口（可选）</label><input type="text" id="ld-apiurl" value="${esc(ld.apiUrl || '')}" placeholder="海关数据 / Apollo 等，没有就留空" /></div>
      </div>
      <div class="field"><label>补充数据源密钥（可选）</label><input type="password" id="ld-apikey" placeholder="${ld.hasApiKey ? '已保存（' + esc(ld.apiKeyMask) + '），留空不修改' : '不接第三方数据源就留空'}" /></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="save-search">保存</button>
        <button class="btn" data-act="test-search">测试检索通道</button>
        <span class="small muted" id="ld-msg" style="align-self:center"></span>
      </div>
    </div>

    <div class="card plain">
      <div class="card-h"><h3>固定规则（不可改）</h3><span class="r">GUARDRAIL</span></div>
      <div class="adm-list">
        <div class="adm-row"><span>联系方式来源</span><span>只取网页上真实出现的邮箱 / 电话 / WhatsApp</span></div>
        <div class="adm-row"><span>AI 编造防护</span><span>提示词明确禁止推测或生成邮箱</span></div>
        <div class="adm-row"><span>结果过滤</span><span>无邮箱且无号码的条目不进结果</span></div>
        <div class="adm-row"><span>去重</span><span>邮箱 → 号码 → 域名，三级去重</span></div>
      </div>
    </div>`;
}

function viewSend() {
  const sd = (S.st && S.st.send) || {};
  return `${head('send')}
    <div class="card plain">
      <div class="card-h"><h3>频率限制</h3><span class="r">RATE LIMIT</span></div>
      ${notice('这几个数字比功能更能决定账号活多久。顾客端看不到这一页，但他们跑任务时会被这里的规则约束：达到日上限的号自动跳过，换成同任务里的其他号继续发。', 'info')}
      <div class="form-row-3">
        <div class="field"><label>WA 单号日上限</label><input type="text" id="sd-wa-day" value="${sd.waDailyLimit || 40}" /></div>
        <div class="field"><label>WA 间隔下限（秒）</label><input type="text" id="sd-wa-iv1" value="${sd.waIntervalMin || 25}" /></div>
        <div class="field"><label>WA 间隔上限（秒）</label><input type="text" id="sd-wa-iv2" value="${sd.waIntervalMax || 60}" /></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>每号连发几条换号</label><input type="text" id="sd-wa-round" value="${sd.waPerRound || 1}" /></div>
        <div class="field"><label>邮箱日上限</label><input type="text" id="sd-mail-day" value="${sd.mailDailyLimit || 200}" /></div>
        <div class="field"><label>失败自动换号</label>
          <select id="sd-retry"><option value="1" ${sd.retrySwitch ? 'selected' : ''}>开启</option><option value="0" ${sd.retrySwitch ? '' : 'selected'}>关闭</option></select></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>邮箱间隔下限（秒）</label><input type="text" id="sd-m-iv1" value="${sd.mailIntervalMin || 20}" /></div>
        <div class="field"><label>邮箱间隔上限（秒）</label><input type="text" id="sd-m-iv2" value="${sd.mailIntervalMax || 45}" /></div>
        <div class="field"><label>同号码去重天数</label><input type="text" id="sd-dedup" value="${sd.dedupDays || 30}" /></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" data-act="save-send">保存</button></div>
    </div>`;
}

function viewFollow() {
  const fl = (S.st && S.st.follow) || {};
  return `${head('follow')}
    <div class="card plain">
      <div class="card-h"><h3>跟进规则</h3><span class="r">FOLLOW UP</span></div>
      ${notice('客户回复后自动进留资中心。命中 A 类关键词的直接标为高意向，超过提醒天数没联系的会出现在顾客端的「跟进提醒」里。', 'info')}
      <div class="form-row-3">
        <div class="field"><label>首次跟进间隔（天）</label><input type="text" id="fl-first" value="${fl.firstFollowDays || 3}" /></div>
        <div class="field"><label>超期提醒（天）</label><input type="text" id="fl-alert" value="${fl.alertDays || 7}" /></div>
        <div class="field"><label>A 类关键词</label><input type="text" id="fl-kw" value="${esc(fl.gradeAKeywords || '')}" placeholder="price,quotation,MOQ,..." /></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" data-act="save-follow">保存</button></div>
    </div>`;
}

function viewData() {
  const s = S.storage || {};
  return `${head('data')}
    <div class="adm-grid4" style="margin-bottom:18px">
      <div class="kpi"><div class="k">数据文件</div><div class="v" style="font-size:18px">${fmtSize(s.dbSize || 0)}</div><div class="d">db.json</div></div>
      <div class="kpi"><div class="k">登录会话</div><div class="v">${s.sessions || 0}</div><div class="d">sessions/</div></div>
      <div class="kpi"><div class="k">运行时长</div><div class="v" style="font-size:18px">${fmtUp(s.uptime || 0)}</div><div class="d">node ${esc(s.node || '')}</div></div>
      <div class="kpi"><div class="k">模式</div><div class="v" style="font-size:18px">${s.mock ? '演示' : '正式'}</div><div class="d">${s.mock ? 'WA_MOCK=1' : 'WA_MOCK=0'}</div></div>
    </div>

    <div class="card plain">
      <div class="card-h"><h3>文件位置</h3><span class="r">STORAGE</span></div>
      <div class="adm-list">
        <div class="adm-row"><span>全部业务数据</span><span class="mono">${esc(s.dbFile || 'data/db.json')}</span></div>
        <div class="adm-row"><span>WhatsApp 登录态</span><span class="mono">${esc(s.sessionsDir || 'data/sessions/')}</span></div>
      </div>
      ${notice('备份只需要拷 <b>db.json</b> 一个文件；会话目录删掉就要重新扫码，别误删。', 'info')}
      ${s.mock ? `<div class="form-actions" style="margin-top:12px"><button class="btn" data-act="demo-seed">填充演示数据</button></div>` : ''}
    </div>`;
}

const VIEWS = { overview: viewOverview, llm: viewLLM, search: viewSearch, send: viewSend, follow: viewFollow, data: viewData };

/* ---------------- 渲染 ---------------- */
function buildNav() {
  $('#nav').innerHTML = NAV.map(
    (g) => `<div class="side-group open">
      <div class="g-head">
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
        ${esc(g.g)}
      </div>
      <div class="side-items">
        ${g.items.map((it) => `<div class="side-sub" data-k="${it.k}">${esc(it.t)}</div>`).join('')}
      </div>
    </div>`
  ).join('');
  $$('#nav .g-head').forEach((h) => (h.onclick = () => h.parentElement.classList.toggle('open')));
  $$('#nav .side-sub').forEach((s) => (s.onclick = () => {
    location.hash = '#/' + s.dataset.k;
    document.body.classList.remove('side-open');
  }));
}

function render() {
  const k = VIEWS[S.view] ? S.view : 'overview';
  const m = META[k];
  $('#crumb').innerHTML = `${esc(m.g)}<span class="sep">/</span><b>${esc(m.t)}</b>`;
  $('#view').innerHTML = VIEWS[k]();
  $$('#nav .side-sub').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
}

function go(v) {
  S.view = v;
  location.hash = '#/' + v;
  render();
  window.scrollTo({ top: 0 });
}

/* ---------------- 事件 ---------------- */
async function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'go') return go(el.dataset.view);

  try {
    if (act === 'save-llm') {
      const body = {
        llm: {
          baseUrl: ($('#llm-url') || {}).value || '',
          model: ($('#llm-model') || {}).value || '',
          key: ($('#llm-key') || {}).value || '',
          enabled: ($('#llm-enabled') || {}).value === '1',
        },
      };
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      await loadAll();
      render();
      return toast('大模型配置已保存');
    }
    if (act === 'test-llm') {
      const msg = $('#llm-msg');
      if (msg) msg.textContent = '测试中…';
      try {
        const j = await api('/api/settings/test-llm', { method: 'POST' });
        if (msg) msg.textContent = '连通正常：' + j.text;
        toast('大模型连通正常');
      } catch (err) {
        if (msg) msg.textContent = '失败：' + err.message;
        toast('测试失败', true);
      }
      return;
    }
    if (act === 'save-search') {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          lead: {
            searchProvider: ($('#ld-provider') || {}).value || 'serper',
            searchKey: ($('#ld-key') || {}).value || '',
            pageSize: Number(($('#ld-page') || {}).value) || 30,
            apiUrl: ($('#ld-apiurl') || {}).value || '',
            apiKey: ($('#ld-apikey') || {}).value || '',
          },
        }),
      });
      await loadAll();
      render();
      return toast('检索配置已保存');
    }
    if (act === 'test-search') {
      const msg = $('#ld-msg');
      if (msg) msg.textContent = '正在测试检索…';
      try {
        const j = await api('/api/ai/test-search', { method: 'POST' });
        if (msg) msg.textContent = `通道可用，返回 ${j.count} 条（${j.ms} ms）`;
        toast('检索通道正常');
      } catch (err) {
        if (msg) msg.textContent = '失败：' + err.message;
        toast('检索失败', true);
      }
      return;
    }
    if (act === 'save-send') {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          send: {
            waDailyLimit: Number(($('#sd-wa-day') || {}).value) || 40,
            waIntervalMin: Number(($('#sd-wa-iv1') || {}).value) || 25,
            waIntervalMax: Number(($('#sd-wa-iv2') || {}).value) || 60,
            waPerRound: Number(($('#sd-wa-round') || {}).value) || 1,
            mailDailyLimit: Number(($('#sd-mail-day') || {}).value) || 200,
            mailIntervalMin: Number(($('#sd-m-iv1') || {}).value) || 20,
            mailIntervalMax: Number(($('#sd-m-iv2') || {}).value) || 45,
            dedupDays: Number(($('#sd-dedup') || {}).value) || 30,
            retrySwitch: ($('#sd-retry') || {}).value === '1',
          },
        }),
      });
      await loadAll();
      return toast('发送策略已保存');
    }
    if (act === 'save-follow') {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          follow: {
            firstFollowDays: Number(($('#fl-first') || {}).value) || 3,
            alertDays: Number(($('#fl-alert') || {}).value) || 7,
            gradeAKeywords: ($('#fl-kw') || {}).value || '',
          },
        }),
      });
      await loadAll();
      return toast('跟进规则已保存');
    }
    if (act === 'demo-seed') {
      if (!confirm('填充演示数据？会写入示例账号、线索、客户与任务。')) return;
      const j = await api('/api/demo/seed', { method: 'POST' });
      await loadAll();
      render();
      return toast(`已填充：${JSON.stringify(j.stats || {})}`);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- 启动 ---------------- */
function onHash() {
  const k = (location.hash || '').replace(/^#\//, '') || 'overview';
  S.view = VIEWS[k] ? k : 'overview';
  render();
}

async function boot() {
  buildNav();
  const tb = $('#theme-btn');
  const saved = localStorage.getItem('wa_theme');
  if (saved) document.documentElement.dataset.theme = saved;
  tb.onclick = () => {
    const next = (document.documentElement.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('wa_theme', next);
  };
  $('#menu-btn').onclick = () => document.body.classList.toggle('side-open');
  $('#scrim').onclick = () => document.body.classList.remove('side-open');
  $('#link-console').onclick = () => (location.href = '/');
  $('#link-health').onclick = async () => {
    try {
      const j = await (await fetch('/healthz')).json();
      toast('服务正常 · 已运行 ' + Math.round(j.uptime) + ' 秒');
    } catch {
      toast('服务不可用', true);
    }
  };
  $('#logout-btn') && ($('#logout-btn').onclick = () => {
    localStorage.removeItem(TOKEN_KEY);
    S.token = '';
    location.reload();
  });
  document.addEventListener('click', onClick);
  window.addEventListener('hashchange', onHash);

  await loadAll();
  onHash();
  render();
}

boot();
