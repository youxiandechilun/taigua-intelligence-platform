'use strict';
/**
 * 大模型调用（OpenAI 兼容协议：OpenAI / DeepSeek / 通义 / 智谱 / 本地 vLLM 都能用）
 * 密钥只在后端，前端拿不到。
 */
import store from './store.js';

function cfg() {
  const c = store.get().settings.llm || {};
  return {
    enabled: Boolean(c.enabled && c.key && c.baseUrl),
    baseUrl: String(c.baseUrl || '').replace(/\/+$/, ''),
    key: c.key || '',
    model: c.model || 'gpt-4o-mini',
  };
}

function status() {
  const c = cfg();
  let host = '';
  try {
    host = c.baseUrl ? new URL(c.baseUrl).host : '';
  } catch {}
  return { configured: c.enabled, model: c.model, host, keyMask: c.key ? c.key.slice(0, 4) + '****' + c.key.slice(-2) : '' };
}

async function chat(messages, opt = {}) {
  const c = cfg();
  if (!c.enabled) throw new Error('后端未配置大模型。请在「系统 → 后端配置」里填写接口地址、密钥与模型名。');
  const body = {
    model: c.model,
    messages,
    temperature: opt.temperature == null ? 0.4 : opt.temperature,
  };
  if (opt.json) body.response_format = { type: 'json_object' };
  if (opt.maxTokens) body.max_tokens = opt.maxTokens;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeout || 60000);
  let r;
  try {
    r = await fetch(c.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('大模型接口连接失败：' + (e.name === 'AbortError' ? '请求超时' : e.message));
  }
  clearTimeout(timer);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || data.message || 'HTTP ' + r.status);
  const text = data.choices?.[0]?.message?.content || '';
  return { text, usage: data.usage || null, model: data.model || c.model };
}

async function test() {
  const r = await chat([{ role: 'user', content: '回复两个字：可用' }], { maxTokens: 20, timeout: 25000 });
  return r.text.trim().slice(0, 40);
}

/** 用知识库写一封开发信/邮件 */
async function draft(kind, ctx = {}) {
  const kb = store.get().kb;
  const c = kb.company || {};
  const prods = (kb.products || [])
    .slice(0, 8)
    .map((p) => `- ${p.name} ${p.model ? '(' + p.model + ')' : ''}: ${p.desc || ''} MOQ ${p.moq || '-'} 价格 ${p.price || '-'}`)
    .join('\n');
  const faqs = (kb.faq || []).slice(0, 10).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n');

  const sys = `你是外贸业务员，代表以下公司撰写开发信。要求：简短、具体、不像群发广告、不夸大、不使用emoji。
公司：${c.name || '（未填写）'}
成立：${c.founded || '-'}｜所在地：${c.location || '-'}｜主营：${c.products || '-'}｜市场：${c.markets || '-'}｜认证：${c.certs || '-'}
简介：${c.intro || '-'}
卖点：${c.selling || '-'}
产品：
${prods || '-'}
常见问答：
${faqs || '-'}`;

  const map = {
    wa: `写一条 WhatsApp 开发信首触消息（不超过 90 词，可直接发送，称呼用 {{name}}，落款用 {{sender}}）。目标客户：${ctx.co || ''}（${ctx.country || ''}），关注点：${ctx.tag || '采购'}。结尾只问一个容易回答的问题。`,
    mailSubject: `给 ${ctx.co || '目标客户'}（${ctx.country || ''}）写一封英文开发信标题，不超过 9 个词，不要全大写，不要感叹号。只输出标题本身。`,
    mailBody: `写一封英文开发信正文（150 词以内），面向 ${ctx.co || '目标客户'}（${ctx.country || ''}），关注 ${ctx.tag || '采购'}。结构：一句为什么找他们、两句我们能提供什么（带 1 个具体参数）、一句提问。称呼 {{name}}，落款 {{sender}}。只输出正文。`,
    reply: `客户回复内容如下，写一段得体的英文回复（80 词以内，可直接发送），基于公司资料回答，不确定的信息不要编造，需要报价时说明会给具体方案。客户原话：${ctx.text || ''}`,
  };
  const r = await chat(
    [
      { role: 'system', content: sys },
      { role: 'user', content: map[kind] || map.wa },
    ],
    { temperature: 0.6, maxTokens: 500 }
  );
  return r.text.trim();
}

/** 让模型从搜索结果里整理出结构化线索 */
async function extractLeads(keyword, country, rawText, limit) {
  const prompt = `下面是关于「${keyword}」在「${country}」的网页检索摘要。请提取真实存在的潜在客户（进口商/批发商/经销商），输出 JSON：
{"results":[{"co":"公司名","person":"联系人(没有就空)","country":"${country}","email":"邮箱(没有就空)","phone":"电话(没有就空)","website":"网址","source":"来源","tag":"业务类型"}]}
只保留有邮箱或电话的条目，最多 ${limit} 条，不要编造。
检索摘要：
${rawText.slice(0, 6000)}`;
  const r = await chat(
    [
      { role: 'system', content: '你是外贸线索整理助手，只输出合法 JSON，不输出解释。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.2, json: true, maxTokens: 2000 }
  );
  try {
    const j = JSON.parse(r.text);
    return Array.isArray(j.results) ? j.results : [];
  } catch {
    const m = r.text.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return [];
  }
}

/** AI 在线搜索 · 第 1 步：让模型自己规划检索词 */
async function planQueries(keyword, country, audience, count = 4) {
  const prompt = `我要为外贸开发找潜在客户。产品/行业关键词：「${keyword}」，目标国家：「${country}」，目标客户类型：${audience}。

请生成 ${count} 条用于搜索引擎的英文检索式，要求：
1. 覆盖不同切入角度（行业词 + 身份词、行业协会/展会、批发市场/黄页、公司官网 contact 页）
2. 每条不超过 12 个词，可带 site: 或引号
3. 不要包含 "email" 之外的隐私词，不要涉及抓取社交平台成员

只输出 JSON：{"queries":["...","..."],"guess":"一句话说明这类客户一般叫什么（英文行业称呼）"}`;
  const r = await chat(
    [
      { role: 'system', content: '你是资深外贸业务员，精通各国采购商检索。只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.5, json: true, maxTokens: 400 }
  );
  try {
    const j = JSON.parse(r.text);
    return { queries: (j.queries || []).filter(Boolean).slice(0, 6), guess: j.guess || '' };
  } catch {
    return { queries: [], guess: '' };
  }
}

/** AI 在线搜索 · 第 2 步：把检索摘要 + 抓到的联系方式整理成结构化线索并打分 */
async function aiLeads({ keyword, country, audience, limit, digest, known }) {
  const prompt = `下面是关于「${keyword}」在「${country}」的实时检索结果，以及从部分公司官网抓到的联系方式。

任务：整理出真实存在的潜在客户（${audience}），并按匹配度排序。

规则（非常重要）：
1. 只能使用下面材料里出现过的事实，邮箱/电话/网址必须是原文出现的，**绝对不要编造或猜测**。
2. 如果某家公司只有官网、没有邮箱电话，email/phone 留空，不要填 hello@公司域名 这类编造值。
3. match 为 0-100 的整数，表示它跟你产品的相关度（看业务描述是否吻合采购需求）。
4. reason 用中文一句话说明为什么值得联系（不超过 30 字）。
5. 最多 ${limit} 条，跳过 B2C 零售、招聘、新闻门户、百科、社交平台自身页面。

输出 JSON：{"summary":"一两句话概述这批线索的画像和联系建议","results":[{"co":"公司名","person":"联系人(没有就空)","title":"职位(没有就空)","country":"${country}","email":"","phone":"","website":"","source":"来自哪个站点/来源","tag":"业务类型","match":80,"reason":"..."}]}

【官网抓到的联系方式】
${known || '（无）'}

【检索结果】
${digest.slice(0, 9000)}`;
  const r = await chat(
    [
      { role: 'system', content: '你是外贸线索分析助手，只输出合法 JSON，不编造联系方式。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.2, json: true, maxTokens: 3000 }
  );
  const parse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      const m = t.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {}
      }
      return null;
    }
  };
  const j = parse(r.text) || {};
  return { results: Array.isArray(j.results) ? j.results : [], summary: j.summary || '' };
}

export default { cfg, status, chat, test, draft, extractLeads, planQueries, aiLeads };
