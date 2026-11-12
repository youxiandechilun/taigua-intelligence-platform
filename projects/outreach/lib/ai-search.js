import { billable, prepareAction } from './billing.js';
'use strict';
/**
 * AI 在线搜索（任务中心 · 找线索）
 *
 * 输入：产品关键词 + 目标国家（+ 客户类型）
 * 过程（五步，全部在服务器上跑，前端只看进度）：
 *   1. plan    AI 规划检索式（没配大模型就用内置模板）
 *   2. search  实时联网检索（Serper / Tavily / 免费检索源）
 *   3. crawl   打开官网提取真实邮箱 / 电话 / WhatsApp
 *   4. extract AI 结构化 + 匹配度打分 + 给出联系理由
 *   5. done    去重入库
 *
 * 设计原则：邮箱电话只认网页上真实出现的，AI 只做整理和判断，不允许编造。
 */
import store from './store.js';
import llm from './llm.js';
import leads from './leads.js';
import campaign from './campaign.js';
import mail from './mail.js';
import wa from './wa.js';

const MOCK = String(process.env.WA_MOCK || '0') === '1';
const JOBS = new Map();
const KEEP_JOBS = 40;

const AUDIENCES = {
  all: '进口商 / 批发商 / 经销商',
  importer: '进口商',
  distributor: '批发商 / 经销商',
  brand: '品牌方采购',
  contractor: '工程商 / 项目采购',
};

const STEPS = [
  { key: 'plan', label: 'AI 规划检索策略' },
  { key: 'search', label: '实时联网检索' },
  { key: 'crawl', label: '打开官网核对联系方式' },
  { key: 'extract', label: 'AI 整理并打分' },
  { key: 'save', label: '去重入库' },
];

const SEND_STEP = { key: 'send', label: '去重后定时发信' };

/* 勾选自动发信但没填正文时的兜底模板（支持 {{name}} {{co}} {{company}} {{product}} {{sender}} {{website}} 变量） */
const DEFAULT_MAIL_TEXT = [
  'Dear {{name}},',
  '',
  "I'm {{sender}} from {{company}}. We specialize in {{product}} with stable quality and competitive prices, and we have been supplying to {{country}} for years.",
  '',
  'Would you be open to a quick chat this week? Free samples are available.',
  '',
  'Best regards,',
  '{{sender}}',
  '{{company}}',
  '{{website}}',
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 任务对象 ---------------- */

function pickLimit(v) {
  return Math.min(100, Math.max(5, Number(v) || 30));
}

function create(input) {
  const job = {
    mid: store.currentMid(),
    id: 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    finishedAt: 0,
    status: 'running',
    input: {
      keyword: String(input.keyword || '').trim(),
      country: String(input.country || '').trim(),
      limit: pickLimit(input.limit),
      audience: AUDIENCES[input.audience] ? input.audience : 'all',
      save: input.save !== false,
      autoSend: input.autoSend === true || input.autoSend === 1 || input.autoSend === '1',
      sendChannel: input.sendChannel === 'wa' ? 'wa' : 'mail',
      mailSubject: String(input.mailSubject || '').trim(),
      mailText: String(input.mailText || '').trim(),
      batchSize: Math.max(1, Number(input.batchSize) || 10),
      batchHours: Math.max(1 / 60, Number(input.batchHours) || 3),
    },
    steps: (input.autoSend === true || input.autoSend === 1 || input.autoSend === '1'
      ? STEPS.concat([SEND_STEP])
      : STEPS
    ).map((s) => ({ ...s, status: 'pending', detail: '', ms: 0 })),
    notes: [],
    summary: '',
    results: [],
    trace: [],
    stats: { found: 0, withContact: 0, saved: 0, toSend: 0 },
    campaignId: '',
    error: '',
  };
  JOBS.set(job.id, job);
  if (JOBS.size > KEEP_JOBS) {
    const oldest = [...JOBS.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) JOBS.delete(oldest.id);
  }
  return job;
}

function mark(job, key, status, detail) {
  const s = job.steps.find((x) => x.key === key);
  if (!s) return;
  if (status === 'running') s.t0 = Date.now();
  s.status = status;
  if (detail !== undefined) s.detail = detail;
  if (status === 'done' || status === 'error') s.ms = s.t0 ? Date.now() - s.t0 : 0;
  persist(job);
}

/* 执行轨迹：像智能体一样把「思考 → 工具 → 结果 → AI 回复」全过程记下来 */
const TRACE_MAX = 240;
const TRACE_TEXT_MAX = 1600;

function tlog(job, kind, title, text) {
  if (!Array.isArray(job.trace)) job.trace = [];
  job.trace.push({
    t: Date.now(),
    kind: kind || 'note',
    title: String(title || '').slice(0, 200),
    text: String(text == null ? '' : text).slice(0, TRACE_TEXT_MAX),
  });
  if (job.trace.length > TRACE_MAX) job.trace = job.trace.slice(-TRACE_MAX);
}

/* 任务进度落盘：进程重启后「任务进度」页仍能看到历史与当前状态 */
const KEEP_DB_JOBS = 30;

function persist(job) {
  try {
    const db = store.get();
    if (!Array.isArray(db.aiJobs)) db.aiJobs = [];
    const lite = {
      id: job.id,
      mid: job.mid,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      status: job.status,
      input: job.input,
      steps: job.steps.map((s) => ({ key: s.key, label: s.label, status: s.status, detail: s.detail, ms: s.ms })),
      notes: job.notes.slice(-6),
      summary: job.summary,
      trace: (job.trace || []).slice(-120),
      stats: job.stats,
      campaignId: job.campaignId,
      error: job.error,
    };
    const i = db.aiJobs.findIndex((x) => x.id === job.id);
    if (i >= 0) db.aiJobs[i] = lite;
    else db.aiJobs.unshift(lite);
    db.aiJobs = db.aiJobs.slice(0, KEEP_DB_JOBS);
    store.save();
  } catch (e) {
    /* 落盘失败不影响搜索本身 */
  }
}

/* ---------------- 检索式 ---------------- */

function templateQueries(kw, ct, audience) {
  const who = audience === 'importer' ? 'importer' : audience === 'brand' ? 'brand buyer' : 'importer distributor wholesaler';
  return [
    `${kw} ${who} ${ct} contact email`,
    `${kw} ${ct} wholesale company "contact us"`,
    `${kw} ${ct} supplier catalog distributor`,
    `${ct} ${kw} ${who} association members`,
  ];
}

/* ---------------- 主流程 ---------------- */

async function run(job) {
  const { keyword, country, limit, audience, save } = job.input;
  const conf = store.get().settings.lead || {};
  const aiOn = llm.cfg().enabled;

  try {
    tlog(
      job,
      'step',
      '收到任务，开始执行',
      `关键词：${keyword}\n目标国家：${country}\n客户类型：${AUDIENCES[audience]}\n最多 ${limit} 条\n结果处理：${job.input.save ? '自动存入线索池' : '只看不存'}\n搜完发信：${
        job.input.autoSend
          ? `是（${job.input.sendChannel === 'wa' ? 'WhatsApp' : '邮箱'}，每 ${job.input.batchHours >= 1 ? job.input.batchHours + ' 小时' : Math.round(job.input.batchHours * 60) + ' 分钟'}发 ${job.input.batchSize} 个）`
          : '否（之后手动群发）'
      }\n大模型：${aiOn ? '已配置（' + llm.cfg().model + '）' : '未配置，走内置规则'}`
    );

    /* 1. 规划 */
    mark(job, 'plan', 'running');
    let queries = [];
    if (aiOn) {
      try {
        tlog(job, 'ai', '向 AI 提问：帮我规划检索式', `角色：外贸获客检索规划\n产品/行业词：${keyword}\n目标国家：${country}\n目标客户：${AUDIENCES[audience]}\n要求：输出 4 组英文检索式，尽量能搜到带邮箱/电话的公司页`);
        const p = await llm.planQueries(keyword, country, AUDIENCES[audience], 4);
        queries = p.queries;
        if (p.guess) job.notes.push('AI 判断目标客户：' + p.guess);
        tlog(job, 'ai-reply', 'AI 回复：检索策略', `${p.guess ? '目标客户判断：' + p.guess + '\n\n' : ''}生成 ${queries.length} 组检索式：\n${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
      } catch (e) {
        job.notes.push('AI 规划失败，改用内置检索式：' + e.message);
        tlog(job, 'error', 'AI 规划失败，已降级', e.message + '\n改用内置检索式继续执行。');
      }
    } else {
      job.notes.push('未配置大模型，本次使用内置检索式 + 关键词过滤（配置后结果更准）。');
      tlog(job, 'note', '未配置大模型', '本次使用内置检索式模板；到「系统 → 后端配置 → 大模型」填好接口后，这里会显示 AI 的真实规划过程。');
    }
    if (!queries.length) queries = templateQueries(keyword, country, audience);
    mark(job, 'plan', 'done', queries.length + ' 组检索式');
    if (!aiOn) tlog(job, 'plan', '使用内置检索式', queries.map((q, i) => `${i + 1}. ${q}`).join('\n'));

    /* 2. 检索 */
    mark(job, 'search', 'running');
    const hits = [];
    const seenUrl = new Set();
    let lastErr = '';
    for (const q of queries) {
      if (hits.length >= limit * 4) break;
      try {
        const r = await leads.searchWeb(q, Math.ceil(limit / 2) + 6);
        for (const h of r) {
          if (!h.url || seenUrl.has(h.url)) continue;
          seenUrl.add(h.url);
          hits.push({ ...h, query: q });
        }
        tlog(job, 'tool', `联网检索：${q}`, `返回 ${r.length} 条结果，累计去重后 ${hits.length} 条。${r[0] ? '\n示例：' + (r[0].title || '') + '\n' + r[0].url : ''}`);
      } catch (e) {
        lastErr = e.message;
        tlog(job, 'error', `检索失败：${q}`, e.message);
      }
    }
    if (!hits.length) {
      throw new Error(
        '实时检索没有任何结果' +
          (lastErr ? '（' + lastErr + '）' : '') +
          '。请确认服务器能访问外网，或在「系统 → 后端配置」里填 Serper / Tavily 密钥（免费源在部分网络下会被限流）。'
      );
    }
    mark(job, 'search', 'done', hits.length + ' 条网页结果');

    /* 3. 抓官网 */
    mark(job, 'crawl', 'running');
    let crawled = [];
    try {
      crawled = await leads.crawlSites(hits, Math.max(15, limit));
    } catch (e) {
      job.notes.push('官网核对部分失败：' + e.message);
    }
    crawled.forEach((r) => {
      r.country = r.country || country;
      r.match = r.email && r.phone ? 78 : 70;
      r.reason = '官网直接公开的联系方式';
    });
    mark(job, 'crawl', 'done', crawled.length ? crawled.length + ' 家拿到联系方式' : '未抓到公开联系方式，交给 AI 整理');
    tlog(
      job,
      'tool',
      '打开官网核对联系方式',
      `抓取 ${Math.min(hits.length, Math.max(15, limit))} 个网站，其中 ${crawled.length} 家拿到公开邮箱 / 电话。` +
        (crawled.length ? '\n\n' + crawled.slice(0, 8).map((c) => `${c.co || c.website} → ${c.email || '无邮箱'} / ${c.phone || '无电话'}`).join('\n') : '')
    );

    /* 4. AI 结构化 */
    mark(job, 'extract', 'running');
    let results = [];
    if (aiOn) {
      const digest = hits
        .slice(0, 40)
        .map((h, i) => `${i + 1}. 【${h.title || ''}】${h.url}\n${(h.snippet || '').slice(0, 260)}`)
        .join('\n');
      const known = crawled
        .slice(0, 30)
        .map((c) => `${c.co} | ${c.website} | ${c.email || '无邮箱'} | ${c.phone || '无电话'}`)
        .join('\n');
      try {
        const ai = await llm.aiLeads({
          keyword,
          country,
          audience: AUDIENCES[audience],
          limit,
          digest,
          known,
        });
        results = ai.results || [];
        job.summary = ai.summary || '';
        tlog(
          job,
          'ai-reply',
          'AI 回复：整理结果与打分',
          `输入给 AI：${Math.min(hits.length, 40)} 条网页摘要 + ${crawled.length} 家官网核对结果\nAI 返回 ${results.length} 家客户。\n\n` +
            results
              .slice(0, 12)
              .map((r, i) => `${i + 1}. ${r.co || r.website || '—'}｜匹配 ${r.match || 0}｜${r.email || r.phone || '无联系方式'}\n   理由：${r.reason || '—'}`)
              .join('\n') +
            (results.length > 12 ? `\n… 其余 ${results.length - 12} 家略` : '') +
            (ai.summary ? `\n\nAI 总结：${ai.summary}` : '')
        );
      } catch (e) {
        job.notes.push('AI 整理失败，改用官网抓取结果：' + e.message);
        tlog(job, 'error', 'AI 整理失败，已降级', e.message + '\n改用官网抓到的联系方式继续入库。');
      }
    } else {
      tlog(job, 'note', '未调用大模型整理', '直接用官网抓到的联系方式作为结果；配置大模型后会多一步「匹配度打分 + 联系理由」。');
    }

    // 以 AI 结果为主，官网抓到的补充进来（AI 漏掉的）
    const keyOf = (r) =>
      (r.email || r.phone || (r.website || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || r.co || '')
        .toString()
        .toLowerCase();
    const seen = new Set();
    const merged = [];
    for (const r of results) {
      const k = keyOf(r);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push({
        co: r.co || r.website || '',
        person: r.person || '',
        title: r.title || '',
        country: r.country || country,
        email: r.email || '',
        phone: r.phone || '',
        website: r.website || '',
        source: r.source || 'AI 搜索',
        tag: r.tag || '',
        match: Math.min(100, Math.max(0, Number(r.match) || 60)),
        reason: r.reason || '',
      });
    }
    for (const c of crawled) {
      const k = keyOf(c);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push({
        co: c.co,
        person: '',
        title: '',
        country: c.country || country,
        email: c.email,
        phone: c.phone,
        website: c.website,
        source: '官网检索',
        tag: '官网抓取',
        match: c.match,
        reason: c.reason,
      });
    }

    const withContact = merged.filter((r) => r.email || r.phone);
    withContact.sort((a, b) => b.match - a.match);
    job.results = withContact.slice(0, limit);
    job.stats.found = merged.length;
    job.stats.withContact = withContact.length;
    mark(job, 'extract', 'done', `${withContact.length} 条可用线索`);

    if (!job.summary && job.results.length) {
      const n = job.results.length;
      const top = job.results.slice(0, 3).map((r) => r.co).filter(Boolean).join('、');
      job.summary = `在${country}找到 ${n} 家与「${keyword}」相关的潜在客户${top ? '，优先联系 ' + top : ''}。建议先发 WhatsApp 短消息，48 小时未回再补一封邮件。`;
    }

    /* 5. 入库 */
    mark(job, 'save', 'running');
    if (save && job.results.length) {
      job.stats.saved = leads.saveLeads(job.results);
    }
    mark(job, 'save', 'done', save ? `新增 ${job.stats.saved} 条到线索池` : '未入库（只看结果）');
    tlog(
      job,
      'result',
      '去重入库',
      `可用线索 ${job.stats.withContact} 条（原始 ${job.stats.found} 条，AI 结果与官网抓取已按邮箱/域名合并）\n` +
        (save ? `新写入线索池 ${job.stats.saved} 条，其余为已有重复。` : '按设置未入库，只在结果列表展示。')
    );

    /* 6. 去重后自动定时发信（邮箱 / WhatsApp） */
    if (job.input.autoSend) {
      mark(job, 'send', 'running');
      try {
        const ch = job.input.sendChannel;
        const isWa = ch === 'wa';
        const all = job.results
          .filter((r) => (isWa ? r.phone : r.email))
          .map((r) => (isWa
            ? { to: String(r.phone).replace(/^\+/, '').trim(), name: r.person, co: r.co, country: r.country }
            : { email: r.email, name: r.person, co: r.co, country: r.country }));
        const fresh = all.filter((r) => !campaign.alreadySent(ch, isWa ? r.to : r.email));
        const dup = all.length - fresh.length;
        if (dup) job.notes.push(`发信去重：${dup} 个${isWa ? '号码' : '邮箱'} 30 天内已发过，本次跳过`);
        const accountIds = isWa ? wa.onlineIds() : mail.list().map((a) => a.id);
        const accHint = isWa ? 'WhatsApp 账号（需在「账号管理」扫码在线）' : '发件邮箱（在「邮箱账号」里接入）';
        if (!fresh.length) {
          mark(job, 'send', 'error', isWa ? '没有带电话号码的线索' : '没有可发的新邮箱');
          job.notes.push(`自动发信未执行：本次没有${isWa ? '电话号码' : '邮箱'}可用的新线索。`);
          tlog(job, 'note', '自动发信跳过', `本次没有新的${isWa ? '电话号码' : '邮箱'}（30 天内发过的自动跳过），未创建发信任务。`);
        } else if (!accountIds.length) {
          mark(job, 'send', 'error', `没有可用的${accHint}`);
          job.notes.push(`自动发信未执行：请先接入${accHint}。`);
          tlog(job, 'error', '自动发信跳过', `没有可用的${accHint}，请先在「账号管理」里接入。`);
        } else {
          const camp = campaign.create({
            channel: ch,
            name: `AI 自动发信 · ${job.input.keyword}`,
            subject: isWa ? '' : (job.input.mailSubject || 'Cooperation proposal'),
            text: job.input.mailText || DEFAULT_MAIL_TEXT,
            targets: fresh,
            accountIds,
            batchSize: job.input.batchSize,
            batchHours: job.input.batchHours,
            baseUrl: process.env.WA_BASE_URL || '',
          });
          job.campaignId = camp.id;
          job.stats.toSend = fresh.length;
          const b = camp.batch;
          mark(
            job,
            'send',
            'done',
            (b
              ? `共 ${fresh.length} 个${isWa ? '号码' : '邮箱'}，每 ${b.hours} 小时发 ${b.size} 个`
              : `立即发送 ${fresh.length} 个`) + `（任务 ${camp.id}）`
          );
          tlog(
            job,
            'result',
            '已创建定时发信任务',
            `通道：${isWa ? 'WhatsApp' : '邮箱'}\n可发${isWa ? '号码' : '邮箱'}：${fresh.length} 个（30 天内已发过的 ${all.length - fresh.length} 个自动跳过）\n` +
              (b ? `发送节奏：每 ${b.hours} 小时发 ${b.size} 个，共 ${Math.ceil(fresh.length / b.size)} 批` : `发送节奏：立即一次性发完`) +
              `\n发信任务号：${camp.id}（在「开发信任务」里可看每批发送进度）`
          );
        }
      } catch (e) {
        mark(job, 'send', 'error', e.message);
        job.notes.push('自动发信失败：' + e.message);
        tlog(job, 'error', '自动发信失败', e.message);
      }
    }

    job.status = 'done';
    tlog(job, 'result', '任务完成', `用时 ${((Date.now() - job.createdAt) / 1000).toFixed(1)} 秒；共 ${job.results.length} 条可用线索，入库 ${job.stats.saved} 条。`);
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    const cur = job.steps.find((s) => s.status === 'running');
    if (cur) mark(job, cur.key, 'error', e.message);
    tlog(job, 'error', '任务失败', e.message);
  } finally {
    job.finishedAt = Date.now();
    persist(job);
  }
}

/* ---------------- 演示模式 ---------------- */

async function runMock(job) {
  const { country, limit, keyword } = job.input;
  tlog(job, 'step', '收到任务，开始执行（演示模式）', `关键词：${keyword}\n目标国家：${country}\n最多 ${limit} 条\n演示模式下不联网，直接生成样例数据。`);
  tlog(job, 'ai', '向 AI 提问：帮我规划检索式', `产品/行业词：${keyword}\n目标国家：${country}\n要求：输出 4 组英文检索式`);
  for (const s of job.steps) {
    mark(job, s.key, 'running');
    await sleep(650 + Math.random() * 450);
  }
  const hit = leads.MOCK_RESULTS.filter((r) => !country || country === '全部' || r.country === country);
  const base = hit.length >= 4 ? hit : leads.MOCK_RESULTS;
  const list = base.slice(0, Math.min(limit, base.length)).map((r, i) => ({
    ...r,
    title: i % 3 === 0 ? 'Purchasing Manager' : i % 3 === 1 ? 'Owner' : 'Import Manager',
    match: Math.max(52, 94 - i * 5),
    reason: '业务范围与产品线吻合，官网有公开采购邮箱',
    source: 'AI 搜索 · ' + r.source,
  }));
  job.results = list;
  job.stats = { found: list.length + 2, withContact: list.length, saved: job.input.save ? leads.saveLeads(list) : 0, toSend: 0 };
  const top = list.slice(0, 3).map((r) => r.co).filter(Boolean).join('、');
  job.summary = `在${country || '目标市场'}找到 ${list.length} 家与「${keyword}」相关的潜在客户${top ? '，优先联系 ' + top : ''}。建议先发 WhatsApp 短消息，48 小时未回再补一封邮件。`;
  job.steps.forEach((s) => {
    s.status = 'done';
    s.ms = 700;
    s.detail = { plan: '4 组检索式', search: '38 条网页结果', crawl: `${list.length} 家拿到联系方式`, extract: `${list.length} 条可用线索`, save: job.input.save ? `新增 ${job.stats.saved} 条` : '未入库', send: '演示模式：不实际创建发信任务' }[s.key] || '';
  });
  tlog(job, 'ai-reply', 'AI 回复：检索策略', `生成 4 组检索式：\n1. ${keyword} importer ${country} contact email\n2. ${keyword} ${country} wholesale distributor\n3. ${keyword} supplier catalog ${country}\n4. ${keyword} ${country} "contact us"`);
  tlog(job, 'tool', '联网检索（演示）', `返回 ${list.length + 6} 条网页结果，去重后保留 ${list.length + 2} 条。`);
  tlog(job, 'tool', '打开官网核对联系方式（演示）', `${list.length} 家拿到公开邮箱 / 电话。`);
  tlog(job, 'ai-reply', 'AI 回复：整理结果与打分', `返回 ${list.length} 家客户：\n` + list.slice(0, 10).map((r, i) => `${i + 1}. ${r.co}｜匹配 ${r.match}｜${r.email || r.phone}`).join('\n'));
  tlog(job, 'result', '去重入库', job.input.save ? `新写入线索池 ${job.stats.saved} 条。` : '按设置未入库。');
  tlog(job, 'result', '任务完成（演示）', `共 ${list.length} 条可用线索。`);
  job.status = 'done';
  job.finishedAt = Date.now();
  persist(job);
}

/* ---------------- 对外接口 ---------------- */

async function start(input) {
  if (!String(input.keyword || '').trim()) throw new Error('请填写关键词（产品 / 行业）');
  const requestId = input.requestId || store.nextId('search-');
  const billingInput = { keyword: input.keyword, country: input.country, limit: input.limit, audience: input.audience };
  const reservation = await prepareAction('lead_search', requestId, billingInput);
  if (reservation.jobId) return reservation.jobId;
  const job = create(input);
  reservation.jobId = job.id;
  store.saveNow();
  persist(job);
  billable('lead_search', requestId, billingInput, async () => {
    if (MOCK) await runMock(job);
    else await run(job);
    if (job.status !== 'done') throw new Error(job.error || '搜索任务未完成');
    return { jobId: job.id };
  }).catch((error) => {
    job.status = 'error';
    job.error = error.message;
    job.finishedAt = Date.now();
    persist(job);
  });
  return job.id;
}

function get(id) {
  const candidate = JOBS.get(id);
  const j = candidate?.mid === store.currentMid() ? candidate : null;
  if (!j) {
    /* 进程重启后从落盘记录里取（只保留执行轨迹，结果明细已入库到线索池） */
    const db = store.get();
    const p = (db.aiJobs || []).find((x) => x.id === id);
    if (!p) return null;
    return {
      id: p.id,
      createdAt: p.createdAt,
      finishedAt: p.finishedAt,
      status: p.status,
      input: p.input,
      steps: p.steps || [],
      notes: p.notes || [],
      summary: p.summary || '',
      trace: p.trace || [],
      results: [],
      stats: p.stats || {},
      campaignId: p.campaignId || '',
      error: p.error || '',
      fromDisk: true,
    };
  }
  return {
    id: j.id,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    status: j.status,
    input: j.input,
    steps: j.steps.map((s) => ({ key: s.key, label: s.label, status: s.status, detail: s.detail, ms: s.ms })),
    notes: j.notes,
    summary: j.summary,
    trace: j.trace || [],
    results: j.results,
    stats: j.stats,
    campaignId: j.campaignId || '',
    error: j.error,
  };
}

function latest() {
  const arr = [...JOBS.values()].filter((job) => job.mid === store.currentMid()).sort((a, b) => b.createdAt - a.createdAt);
  return arr.length ? get(arr[0].id) : null;
}

/* 任务列表（内存 + 落盘历史合并，最多返回 30 条） */
function list(limit = 30) {
  const mem = [...JOBS.values()].filter((job) => job.mid === store.currentMid()).map((j) => {
    const o = get(j.id);
    return {
      id: o.id,
      createdAt: o.createdAt,
      finishedAt: o.finishedAt,
      status: o.status,
      keyword: o.input.keyword,
      country: o.input.country,
      limit: o.input.limit,
      autoSend: o.input.autoSend,
      sendChannel: o.input.sendChannel,
      steps: o.steps,
      stats: o.stats,
      campaignId: o.campaignId || '',
      error: o.error,
      inMemory: true,
    };
  });
  const db = store.get();
  const disk = (db.aiJobs || [])
    .filter((j) => !JOBS.has(j.id))
    .map((j) => ({
      id: j.id,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      status: j.status,
      keyword: (j.input && j.input.keyword) || '',
      country: (j.input && j.input.country) || '',
      limit: (j.input && j.input.limit) || 0,
      autoSend: Boolean(j.input && j.input.autoSend),
      sendChannel: (j.input && j.input.sendChannel) || 'mail',
      steps: j.steps || [],
      stats: j.stats || {},
      campaignId: j.campaignId || '',
      error: j.error || '',
      inMemory: false,
    }));
  return [...mem, ...disk].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function health() {
  const c = store.get().settings.lead || {};
  const l = llm.cfg();
  return {
    ai: l.enabled,
    aiModel: l.model,
    searchProvider: c.searchKey ? c.searchProvider || 'serper' : 'builtin',
    searchConfigured: Boolean(c.searchKey),
    ready: true,
  };
}

export default { start, get, latest, list, health, AUDIENCES };
