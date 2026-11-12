'use strict';
/**
 * 演示数据（仅 WA_MOCK=1 时可用）
 * 给客户演示时不依赖真实账号与网络，一键把系统填成"正在跑"的样子。
 */
import store from './store.js';
import wa from './wa.js';
import leads from './leads.js';
import replies from './replies.js';

const DAY = 86400000;

async function seed() {
  const d = store.get();

  /* 账号 */
  if (d.waAccounts.length < 3) {
    for (const label of ['业务号 A（主）', '业务号 B（备用）', '业务号 C（备用）']) {
      if (d.waAccounts.some((a) => a.label === label)) continue;
      await wa.create(label);
    }
  }
  for (const a of store.get().waAccounts.slice(0, 3)) {
    if (!a.sentDay) {
      a.sentDay = store.todayKey();
      a.sentToday = 12 + Math.floor(Math.random() * 20);
      a.sentTotal = 260 + Math.floor(Math.random() * 400);
    }
    await wa.mockOnline(a.id).catch(() => {});
  }
  if (d.mailAccounts.length < 2) {
    for (const [email, label] of [['sales@example.invalid', '业务邮箱 · 主'], ['lisa@example.invalid', '业务邮箱 · Lisa']]) {
      if (d.mailAccounts.some((a) => a.email === email)) continue;
      const id = store.nextId('m');
      d.mailAccounts.push({
        id,
        label,
        email,
        fromName: label,
        pass: 'demo',
        imap: { host: 'imap.exmail.qq.com', port: 993, secure: true, user: email, pass: 'demo' },
        smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true, user: email, pass: 'demo' },
        dailyLimit: 200,
        status: 'ready',
        createdAt: Date.now(),
        sentDay: store.todayKey(),
        sentToday: 30 + Math.floor(Math.random() * 60),
        sentTotal: 420,
        repliedTotal: 18,
        lastCheck: Date.now() - 4 * 60000,
      });
    }
    store.saveNow();
  }

  /* 线索 */
  if (d.leads.length < 10) leads.saveLeads(leads.MOCK_RESULTS);

  /* 发送记录（让看板有量） */
  if (d.sends.length < 40) {
    const chan = ['wa', 'mail'];
    for (let i = 0; i < 60; i += 1) {
      const channel = chan[i % 2];
      const ts = Date.now() - Math.floor(Math.random() * 6) * 3600000 - i * 60000;
      const to = channel === 'wa' ? '86' + (13800000000 + i * 7001) : `buyer${i}@example-import.com`;
      d.sends.push({
        id: store.nextId('sd'),
        campaignId: '',
        campaignName: '历史发送',
        channel,
        accountId: '',
        to,
        name: '',
        co: '',
        country: '',
        status: Math.random() > 0.08 ? 'sent' : 'failed',
        day: store.todayKey(ts),
        ts,
        readAt: channel === 'mail' && Math.random() > 0.45 ? ts + 3600000 : 0,
        repliedAt: Math.random() > 0.82 ? ts + 7200000 : 0,
        error: '',
        externalId: '',
        trackId: '',
        subject: '',
      });
    }
  }

  /* 客户（含分级与停滞天数） */
  if (d.customers.length < 6) {
    const list = [
      { name: 'Markus Weber', co: 'Nordlicht Handels GmbH', country: '德国', contact: 'markus.weber@example.invalid', channel: 'mail', grade: 'A', stage: '已报价', idle: 1 },
      { name: 'Omar Al-Rashid', co: 'Al-Rashid Building Materials', country: '沙特阿拉伯', contact: '966551234190', channel: 'wa', grade: 'A', stage: '已回复', idle: 2 },
      { name: 'Luis Herrera', co: 'Refacciones del Norte SA', country: '墨西哥', contact: 'l.h@example.invalid', channel: 'mail', grade: 'B', stage: '已回复', idle: 6 },
      { name: 'Katarzyna Nowak', co: 'BrightLine Lighting', country: '波兰', contact: '485190479047', channel: 'wa', grade: 'B', stage: '待跟进', idle: 9 },
      { name: 'Daniel Brooks', co: 'Hudson Supply Co.', country: '美国', contact: '12025550188', channel: 'wa', grade: 'A', stage: '已发样', idle: 12 },
      { name: 'Wei Tan', co: 'Pacific Trading Pte', country: '新加坡', contact: 'weitan@example.invalid', channel: 'mail', grade: 'C', stage: '待跟进', idle: 15 },
    ];
    for (const x of list) {
      const id = store.nextId('cu');
      d.customers.push({
        id,
        name: x.name,
        co: x.co,
        country: x.country,
        channel: x.channel,
        contact: x.contact,
        grade: x.grade,
        stage: x.stage,
        owner: 'Mei',
        note: '',
        lastContact: Date.now() - x.idle * DAY,
        nextFollow: Date.now() - x.idle * DAY + 3 * DAY,
        repliedCount: 2,
        thread: [{ ts: Date.now() - x.idle * DAY, dir: 'in', text: 'Please send your best price and lead time.' }],
        createdAt: Date.now() - (x.idle + 5) * DAY,
      });
    }
  }

  /* 回复（留资中心） */
  if (d.replies.length < 4) {
    const items = [
      { channel: 'wa', from: '4915112345678', name: 'Markus Weber', text: 'Hi, please send your price list and MOQ for SS-201. We import about 20,000 pcs per year.', ts: Date.now() - 22 * 60000 },
      { channel: 'mail', fromEmail: 'omar@example.invalid', name: 'Omar Al-Rashid', subject: 'Re: Window handles — quotation', text: 'What is your best price for 5,000 pcs AH-330 delivered to Dammam? Also do you have CE certificate?', ts: Date.now() - 3 * 3600000 },
      { channel: 'mail', fromEmail: 'l.herrera@example.invalid', name: 'Luis Herrera', subject: 'Re: Door closer', text: 'Not interested at the moment, maybe next quarter. Thanks.', ts: Date.now() - 26 * 3600000 },
      { channel: 'wa', from: '485190479047', name: 'Katarzyna Nowak', text: 'We are interested in window handles, please send catalog.', ts: Date.now() - 50 * 3600000 },
    ];
    for (const it of items) {
      replies.handleIncoming({
        channel: it.channel,
        accountId: '',
        accountLabel: it.channel === 'wa' ? '业务号 A' : '业务邮箱 · 主',
        from: it.from,
        fromEmail: it.fromEmail,
        name: it.name,
        subject: it.subject || '',
        text: it.text,
        ts: it.ts,
        externalId: 'demo-' + it.name.replace(/\s/g, ''),
      });
    }
  }

  /* 任务记录 */
  if (d.campaigns.length < 3) {
    const now = Date.now();
    const mk = (name, channel, total, sent, status, offset) => ({
      id: store.nextId('c'),
      name,
      channel,
      subject: channel === 'mail' ? 'Hinge & window handle supplier — price list' : '',
      text: 'Hi {{name}}, this is {{sender}} from {{company}}...',
      accountIds: [],
      targets: [],
      intervalMin: 0,
      intervalMax: 0,
      status,
      cursor: total,
      turn: 0,
      stats: { sent, failed: Math.round(total * 0.04), skipped: 0, total },
      log: [],
      createdAt: now - offset,
      startedAt: now - offset,
      finishedAt: status === 'done' ? now - offset + 3600000 : null,
      baseUrl: '',
    });
    d.campaigns.push(mk('德国五金批发商 · 第 1 批', 'wa', 60, 57, 'done', 3 * DAY));
    d.campaigns.push(mk('美国建材进口商 · 第 2 批', 'mail', 120, 118, 'done', 2 * DAY));
    d.campaigns.push(mk('沙特门窗经销商 · 第 3 批', 'wa', 80, 34, 'running', 2 * 3600000));
  }

  /* 知识库 */
  if (!d.kb.company.name) {
    d.kb.company = {
      name: 'Ningbo Taikua Hardware Co., Ltd.',
      website: 'https://www.taikua-hardware.com',
      founded: '2011',
      location: 'Ningbo, Zhejiang, China',
      products: 'stainless steel hinges, aluminum window handles, concealed door closers',
      markets: 'Germany, Poland, Saudi Arabia, UAE, Mexico, Vietnam',
      certs: 'ISO 9001, CE, RoHS, EN 1154',
      intro:
        'Ningbo Taikua Hardware Co., Ltd. is a manufacturer of architectural hardware based in Ningbo, China, established in 2011. We supply importers and distributors across Europe, the Middle East and Latin America, with ISO 9001, CE and RoHS certification.',
      selling: '13 years OEM experience, MOQ 500 pcs, 25-day lead time, free samples for serious buyers.',
    };
  }
  if (!d.kb.products.length) {
    d.kb.products = [
      { id: store.nextId('p'), name: 'Stainless Steel Hinge', model: 'SS-201', moq: '500 pcs', price: 'USD 0.85 ~ 1.20', market: '德国 · 波兰', desc: '304 stainless steel, satin finish, 120-hour salt spray test.' },
      { id: store.nextId('p'), name: 'Aluminum Window Handle', model: 'AH-330', moq: '1,000 pcs', price: 'USD 1.40 ~ 1.75', market: '沙特 · 阿联酋', desc: 'Powder-coated aluminum, 5-year warranty, OEM logo available.' },
      { id: store.nextId('p'), name: 'Concealed Door Closer', model: 'DC-88', moq: '300 pcs', price: 'USD 4.20 ~ 5.60', market: '墨西哥 · 巴西', desc: 'Concealed mounting, adjustable closing speed, EN 1154 tested.' },
    ];
  }
  if (!d.kb.faq.length) {
    d.kb.faq = [
      { id: store.nextId('f'), q: 'What is your MOQ?', a: '500 pcs for standard items; 1,000 pcs for custom logo or color.', tag: '价格' },
      { id: store.nextId('f'), q: 'What is the lead time?', a: '25 days after deposit for 20ft container; 18 days for samples orders.', tag: '交期' },
      { id: store.nextId('f'), q: 'Do you have CE certificate?', a: 'Yes. CE, ISO 9001 and RoHS are available; test reports can be sent on request.', tag: '认证' },
      { id: store.nextId('f'), q: 'Can you provide free samples?', a: 'Free samples up to 2 pcs; freight collected. Sample cost refunded on first order.', tag: '样品' },
    ];
  }

  store.saveNow();
  return { ok: true };
}

export default { seed };
