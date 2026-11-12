'use strict';
/**
 * 找线索：关键词 + 国家 → 客户名单（公司 / 联系人 / 邮箱 / WhatsApp 号）
 *
 * 三条路子，后端配置里切换：
 *   web  = 公开网页检索 + 抓取官网（无需密钥，默认）
 *   api  = 第三方数据源（海关数据 / Apollo / Hunter 等），地址与密钥在后端配置
 *   llm  = 大模型根据检索摘要整理成结构化线索（质量取决于模型）
 */
import store from './store.js';
import llm from './llm.js';

const MOCK = String(process.env.WA_MOCK || '0') === '1';

const MOCK_RESULTS = [
  { co: 'Nordlicht Handels GmbH', person: 'Markus Weber', country: '德国', email: 'markus.weber@example.invalid', phone: '+12025550119', website: 'nordlicht.de', source: 'Google Maps', tag: '五金批发' },
  { co: 'Al-Rashid Building Materials', person: 'Omar Al-Rashid', country: '沙特阿拉伯', email: 'omar@example.invalid', phone: '+12025550118', website: 'alrashid-materials.sa', source: '海关数据', tag: '建材经销' },
  { co: 'Refacciones del Norte SA', person: 'Luis Herrera', country: '墨西哥', email: 'l.herrera@example.invalid', phone: '+12025550118', website: 'refaccionesnorte.mx', source: 'LinkedIn', tag: '汽配进口' },
  { co: 'Minh Long Furniture JSC', person: 'Nguyen Van An', country: '越南', email: 'sales@example.invalid', phone: '+12025550117', website: 'minhlongfurniture.vn', source: 'Google Maps', tag: '家具渠道' },
  { co: 'BrightLine Lighting Sp. z o.o.', person: 'Katarzyna Nowak', country: '波兰', email: 'k.nowak@example.invalid', phone: '+12025550117', website: 'brightline.pl', source: 'LinkedIn', tag: '照明分销' },
  { co: 'PT Sinar Jaya Abadi', person: 'Budi Santoso', country: '印度尼西亚', email: 'purchasing@example.invalid', phone: '+12025550117', website: 'sinarjaya.co.id', source: 'Facebook', tag: '建材批发' },
  { co: 'Hudson Supply Co.', person: 'Daniel Brooks', country: '美国', email: 'dbrooks@example.invalid', phone: '+12025550117', website: 'hudsonsupply.com', source: 'Google Maps', tag: '五金分销' },
  { co: 'Pacific Trading Pte Ltd', person: 'Wei Tan', country: '新加坡', email: 'weitan@example.invalid', phone: '+12025550115', website: 'pacifictrading.sg', source: 'LinkedIn', tag: '建材进口' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchText(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/text|html|json/i.test(ct)) return '';
    const buf = await r.arrayBuffer();
    return Buffer.from(buf).toString('utf8').slice(0, 400000);
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- 搜索入口 ---------------- */

async function searchWeb(query, limit) {
  const cfg = store.get().settings.lead || {};
  const key = cfg.searchKey;

  // 1) Serper（Google 结果，性价比高）
  if (key && (cfg.searchProvider || 'serper') === 'serper') {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: Math.min(100, limit * 3), gl: 'us' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Serper HTTP ' + r.status);
    return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet || '' }));
  }

  // 2) Tavily
  if (key && cfg.searchProvider === 'tavily') {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: Math.min(50, limit * 2), search_depth: 'basic' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'Tavily HTTP ' + r.status);
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content || '' }));
  }

  // 3) 无密钥：DuckDuckGo HTML 版
  const html = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit * 3) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) {
      try {
        url = decodeURIComponent(u[1]);
      } catch {}
    }
    out.push({ url, title: m[2].replace(/<[^>]+>/g, '').trim(), snippet: m[3].replace(/<[^>]+>/g, '').trim() });
  }
  // 兜底：DDG 改版时用通用链接抽取
  if (!out.length) {
    const re2 = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{2,120}?)<\/a>/g;
    while ((m = re2.exec(html)) && out.length < limit * 2) {
      const url = m[1];
      if (/duckduckgo|\.css|\.js|\.png|\.jpg/.test(url)) continue;
      out.push({ url, title: m[2].replace(/<[^>]+>/g, '').trim(), snippet: '' });
    }
  }
  return out;
}

const BAD_MAIL = /(example|sentry|wixpress|domain\.com|email\.com|\.png|\.jpg|\.gif|\.webp|no-?reply|noreply|wordpress|godaddy|cloudflare)/i;

function extractContacts(html, baseUrl) {
  const emails = new Set();
  const phones = new Set();
  const mailto = html.match(/mailto:([^"'?\s>]+)/gi) || [];
  mailto.forEach((x) => emails.add(x.replace(/mailto:/i, '').trim().toLowerCase()));
  (html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).forEach((e) => emails.add(e.toLowerCase()));
  (html.match(/tel:([^"'>\s]+)/gi) || []).forEach((x) => {
    const v = x.replace(/tel:/i, '').replace(/[^\d+]/g, '');
    if (v.replace(/\D/g, '').length >= 7) phones.add(v);
  });
  const wa = html.match(/wa\.me\/(\d{7,15})/gi) || [];
  wa.forEach((x) => phones.add('+' + x.replace(/\D/g, '')));

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  let host = '';
  try {
    host = new URL(baseUrl).host.replace(/^www\./, '');
  } catch {}

  return {
    emails: [...emails].filter((e) => !BAD_MAIL.test(e) && e.length < 60).slice(0, 3),
    phones: [...phones].slice(0, 2),
    title,
    host,
  };
}

async function crawlSites(hits, limit) {
  const out = [];
  const seenHost = new Set();
  for (const h of hits) {
    if (out.length >= limit) break;
    let host = '';
    try {
      host = new URL(h.url).host.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seenHost.has(host)) continue;
    if (/facebook|linkedin|youtube|twitter|instagram|wikipedia|amazon|alibaba|indiamart|pinterest|reddit/.test(host)) continue;
    seenHost.add(host);

    let html = await fetchText(h.url);
    let info = extractContacts(html, h.url);
    if (!info.emails.length) {
      const contactUrl = new URL('/contact', h.url).toString();
      const h2 = await fetchText(contactUrl, 8000);
      if (h2) {
        const info2 = extractContacts(h2, h.url);
        info.emails = info2.emails;
        info.phones = info.phones.length ? info.phones : info2.phones;
      }
    }
    if (!info.emails.length && !info.phones.length) continue;

    out.push({
      co: info.title || h.title || host,
      person: '',
      country: '',
      email: info.emails[0] || '',
      phone: info.phones[0] || '',
      website: host,
      source: '网页检索',
      tag: '官网抓取',
      snippet: h.snippet || '',
    });
  }
  return out;
}

async function searchByApi(keyword, country, limit) {
  const c = store.get().settings.lead || {};
  if (!c.apiUrl || !c.apiKey) throw new Error('第三方数据源未配置（后端设置里填地址与密钥）');
  const r = await fetch(c.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey, 'X-API-KEY': c.apiKey },
    body: JSON.stringify({ keyword, country, limit }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || 'HTTP ' + r.status);
  const arr = Array.isArray(j.results) ? j.results : Array.isArray(j.data) ? j.data : [];
  return arr.map((x) => ({
    co: x.co || x.company || x.name || '',
    person: x.person || x.contact || '',
    country: x.country || country,
    email: x.email || '',
    phone: x.phone || x.whatsapp || '',
    website: x.website || '',
    source: x.source || '数据源',
    tag: x.tag || x.industry || '',
  }));
}

function score(r) {
  let s = 0;
  if (r.email) s += 3;
  if (r.phone) s += 3;
  if (r.website) s += 1;
  if (r.co) s += 1;
  return s;
}

async function search({ keyword, country, limit = 30, mode }) {
  const kw = String(keyword || '').trim();
  const ct = String(country || '').trim();
  if (!kw) throw new Error('关键词不能为空');
  const n = Math.min(200, Math.max(1, Number(limit) || 30));

  if (MOCK) {
    const f = MOCK_RESULTS.filter((r) => !ct || ct === '全部' || r.country === ct);
    return { results: (f.length ? f : MOCK_RESULTS).slice(0, n), mode: 'mock', note: '演示数据' };
  }

  const conf = store.get().settings.lead || {};
  const useMode = mode || conf.mode || 'web';

  if (useMode === 'api') return { results: (await searchByApi(kw, ct, n)).slice(0, n), mode: 'api' };

  if (useMode === 'llm') {
    const hits = await searchWeb(`${kw} ${ct} importer distributor contact email`, Math.min(20, n));
    const raw = hits.map((h) => `【${h.title}】${h.url}\n${h.snippet}`).join('\n');
    const results = await llm.extractLeads(kw, ct, raw || kw, n);
    return { results: results.slice(0, n), mode: 'llm' };
  }

  // web：检索 + 抓官网
  const queries = [
    `${kw} ${ct} importer distributor company contact`,
    `${kw} ${ct} wholesale supplier "email" contact us`,
  ];
  const hits = [];
  let lastErr = '';
  for (const q of queries) {
    try {
      const r = await searchWeb(q, Math.ceil(n / 2));
      hits.push(...r);
    } catch (e) {
      lastErr = e.message;
    }
    if (hits.length >= n * 2) break;
  }
  if (!hits.length) {
    if (llm.cfg().enabled) {
      const results = await llm.extractLeads(kw, ct, `${kw} ${ct}`, n);
      return { results, mode: 'llm', note: '检索源不可用，已改用大模型整理' };
    }
    throw new Error('检索源无法访问' + (lastErr ? '（' + lastErr + '）' : '') + '。可在后端配置搜索 API（Serper / Tavily）后重试。');
  }

  const crawled = await crawlSites(hits, Math.max(12, n));
  crawled.forEach((r) => {
    r.country = r.country || ct;
  });

  // 抓不到联系方式时，用大模型把摘要整理一遍补齐
  let merged = crawled;
  if (crawled.length < Math.min(6, n) && llm.cfg().enabled) {
    try {
      const raw = hits.map((h) => `【${h.title}】${h.url}\n${h.snippet}`).join('\n');
      const extra = await llm.extractLeads(kw, ct, raw, n);
      const seen = new Set(crawled.map((x) => (x.email || x.website || x.co).toLowerCase()));
      for (const e of extra) {
        const k = (e.email || e.website || e.co || '').toLowerCase();
        if (k && !seen.has(k)) {
          seen.add(k);
          merged.push({
            co: e.co || '',
            person: e.person || '',
            country: e.country || ct,
            email: e.email || '',
            phone: e.phone || '',
            website: e.website || '',
            source: '大模型整理',
            tag: e.tag || '',
          });
        }
      }
    } catch {}
  }

  merged = merged.filter((r) => r.email || r.phone).sort((a, b) => score(b) - score(a));
  return { results: merged.slice(0, n), mode: 'web' };
}

/** 保存线索到库（去重：优先邮箱，其次电话，其次公司名） */
function saveLeads(list) {
  const d = store.get();
  const keyOf = (r) => (r.email || r.phone || r.co || '').toString().toLowerCase();
  const exist = new Set(d.leads.map(keyOf));
  let added = 0;
  for (const r of list) {
    const k = keyOf(r);
    if (!k || exist.has(k)) continue;
    exist.add(k);
    d.leads.push({
      id: store.nextId('l'),
      co: r.co || '',
      person: r.person || '',
      country: r.country || '',
      email: r.email || '',
      phone: r.phone || '',
      website: r.website || '',
      source: r.source || '',
      tag: r.tag || '',
      status: 'new',
      createdAt: Date.now(),
    });
    added += 1;
  }
  store.save();
  return added;
}

export default { search, saveLeads, MOCK_RESULTS, searchWeb, fetchText, extractContacts, crawlSites, score };
