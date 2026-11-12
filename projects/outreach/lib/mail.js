import { billable } from './billing.js';
'use strict';
/**
 * 邮箱通道：多邮箱账号登录（SMTP 发信 / IMAP 收信）
 * - 发信带 1×1 追踪像素 → 统计「已读」
 * - IMAP 轮询回收客户回复 → 自动归到对应客户 → 进留资中心
 */
import EventEmitter from 'events';
import store from './store.js';

const bus = new EventEmitter();
const MOCK = String(process.env.WA_MOCK || '0') === '1';

import nodemailer from 'nodemailer';
import * as imapflow from 'imapflow';
function libs() {
  if (nodemailer) return;
  try {
    return;
  } catch {
    throw new Error('邮件依赖未安装：在项目目录执行 npm install nodemailer imapflow');
  }
}

/* ---------------- 账号 CRUD ---------------- */

function list() {
  const d = store.get();
  return d.mailAccounts.map((a) => {
    const day = store.todayKey();
    return {
      id: a.id,
      label: a.label,
      email: a.email,
      fromName: a.fromName || '',
      status: a.status || 'idle',
      lastCheck: a.lastCheck || null,
      lastError: a.lastError || null,
      host: a.imap && a.imap.host ? a.imap.host : '',
      smtpHost: a.smtp && a.smtp.host ? a.smtp.host : '',
      dailyLimit: a.dailyLimit || store.get().settings.send.mailDailyLimit,
      sentToday: a.sentDay === day ? a.sentToday || 0 : 0,
      sentTotal: a.sentTotal || 0,
      repliedTotal: a.repliedTotal || 0,
      source: a.source || 'merchant',
    };
  });
}

function get(id) {
  return store.get().mailAccounts.find((a) => a.id === id);
}

function inferHosts(email) {
  const domain = String(email || '').split('@')[1] || '';
  const d = domain.toLowerCase();
  const preset = {
    'qq.com': { imap: 'imap.qq.com', smtp: 'smtp.qq.com' },
    'foxmail.com': { imap: 'imap.qq.com', smtp: 'smtp.qq.com' },
    '163.com': { imap: 'imap.163.com', smtp: 'smtp.163.com' },
    '126.com': { imap: 'imap.126.com', smtp: 'smtp.126.com' },
    'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
    'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
    'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
    'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
    'aliyun.com': { imap: 'imap.aliyun.com', smtp: 'smtp.aliyun.com' },
    'exmail.qq.com': { imap: 'imap.exmail.qq.com', smtp: 'smtp.exmail.qq.com' },
  };
  for (const k of Object.keys(preset)) {
    if (d === k || d.endsWith('.' + k)) return preset[k];
  }
  return { imap: 'imap.' + domain, smtp: 'smtp.' + domain };
}

function makeTransporter(a) {
  libs();
  return nodemailer.createTransport({
    host: a.smtp.host,
    port: Number(a.smtp.port) || 465,
    secure: a.smtp.secure !== false,
    auth: { user: a.smtp.user || a.email, pass: a.smtp.pass || a.pass },
    pool: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

async function testConn(raw) {
  libs();
  const email = String(raw.email || '').trim();
  const pass = String(raw.pass || '').trim();
  if (!email || !pass) throw new Error('邮箱地址和授权码都要填');
  const hosts = inferHosts(email);
  const acc = {
    email,
    pass,
    imap: { host: raw.imapHost || hosts.imap, port: Number(raw.imapPort) || 993, secure: true, user: email, pass },
    smtp: { host: raw.smtpHost || hosts.smtp, port: Number(raw.smtpPort) || 465, secure: true, user: email, pass },
  };

  const t = makeTransporter(acc);
  let smtpOk = false;
  let smtpErr = '';
  try {
    await t.verify();
    smtpOk = true;
  } catch (e) {
    smtpErr = e.message;
  }
  t.close && t.close();

  let imapOk = false;
  let imapErr = '';
  try {
    const c = new imapflow.ImapFlow({ host: acc.imap.host, port: acc.imap.port, secure: true, auth: { user: email, pass }, logger: false });
    await c.connect();
    await c.logout();
    imapOk = true;
  } catch (e) {
    imapErr = e.message;
  }

  return {
    ok: smtpOk && imapOk,
    smtpOk,
    imapOk,
    error: !smtpOk ? 'SMTP 登录失败：' + smtpErr : !imapOk ? 'IMAP 登录失败：' + imapErr : '',
    hosts: { imap: acc.imap.host, smtp: acc.smtp.host },
  };
}

async function create(raw) {
  const email = String(raw.email || '').trim();
  const pass = String(raw.pass || '').trim();
  if (!email.includes('@')) throw new Error('邮箱地址不正确');
  if (!pass) throw new Error('请填写邮箱授权码（不是登录密码）');
  const hosts = inferHosts(email);
  const acc = {
    id: store.nextId('m'),
    label: String(raw.label || '').trim() || email,
    email,
    fromName: String(raw.fromName || '').trim(),
    pass,
    imap: { host: raw.imapHost || hosts.imap, port: Number(raw.imapPort) || 993, secure: true, user: email, pass },
    smtp: { host: raw.smtpHost || hosts.smtp, port: Number(raw.smtpPort) || 465, secure: true, user: email, pass },
    dailyLimit: Number(raw.dailyLimit) || store.get().settings.send.mailDailyLimit,
    status: 'ready',
    createdAt: Date.now(),
    sentDay: '',
    sentToday: 0,
    sentTotal: 0,
    repliedTotal: 0,
    lastCheck: 0,
  };
  store.get().mailAccounts.push(acc);
  store.saveNow();
  return list().find((a) => a.id === acc.id);
}

function update(id, raw) {
  const a = get(id);
  if (!a) throw new Error('邮箱不存在');
  if (a.source === 'platform') throw new Error('请在平台主页后台修改邮箱配置');
  ['label', 'fromName', 'dailyLimit'].forEach((k) => {
    if (raw[k] !== undefined) a[k] = k === 'dailyLimit' ? Number(raw[k]) : raw[k];
  });
  if (raw.pass) {
    a.pass = raw.pass;
    a.imap.pass = raw.pass;
    a.smtp.pass = raw.pass;
  }
  if (raw.imapHost) a.imap.host = raw.imapHost;
  if (raw.smtpHost) a.smtp.host = raw.smtpHost;
  store.saveNow();
  return list().find((x) => x.id === id);
}

function remove(id) {
  const d = store.get();
  if (get(id)?.source === 'platform') throw new Error('请在平台主页后台管理平台邮箱');
  d.mailAccounts = d.mailAccounts.filter((a) => a.id !== id);
  store.saveNow();
}

function markSent(id) {
  const a = get(id);
  if (!a) return;
  const day = store.todayKey();
  if (a.sentDay !== day) {
    a.sentDay = day;
    a.sentToday = 0;
  }
  a.sentToday = (a.sentToday || 0) + 1;
  a.sentTotal = (a.sentTotal || 0) + 1;
  store.save();
}

function sentToday(id) {
  const a = get(id);
  if (!a) return 0;
  return a.sentDay === store.todayKey() ? a.sentToday || 0 : 0;
}

/* ---------------- 发信（带已读追踪） ---------------- */

function pixel(baseUrl, sendId) {
  if (!baseUrl) return '';
  return `<img src="${baseUrl.replace(/\/$/, '')}/t/${sendId}.gif" width="1" height="1" style="display:none" alt="" />`;
}

async function performSend(accountId, opt) {
  const a = get(accountId);
  if (!a) throw new Error('邮箱账号不存在');
  const to = String(opt.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('收件邮箱格式不对');
  const sid = opt.sendId || store.nextId('s');
  const html = `<div style="font:14px/1.7 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">${String(opt.html || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 12px">${l}</p>`)
    .join('')}</div>${pixel(opt.baseUrl, sid)}`;

  if (MOCK) {
    await new Promise((r) => setTimeout(r, 100));
    markSent(accountId);
    return { messageId: 'mock-' + sid, sid };
  }

  const t = makeTransporter(a);
  try {
    const info = await t.sendMail({
      from: a.fromName ? `"${a.fromName}" <${a.email}>` : a.email,
      to,
      subject: String(opt.subject || '(no subject)'),
      text: String(opt.text || ''),
      html,
      headers: opt.headers || {},
    });
    markSent(accountId);
    return { messageId: info.messageId, sid };
  } finally {
    t.close && t.close();
  }
}

/* ---------------- 原始邮件解析（够用即可，不引第三方解析器） ---------------- */

async function send(accountId, opt) {
  if (!get(accountId)) throw new Error('邮箱不存在');
  if (get(accountId).status === 'unconfigured') throw new Error('平台邮箱尚未配置');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(opt.to || '').trim())) throw new Error('收件邮箱格式不对');
  if (!String(opt.text || '').trim()) throw new Error('邮件内容为空');
  return billable('mail_send', opt.requestId || store.nextId('direct-mail-'), {
    accountId, to: opt.to, subject: opt.subject, text: opt.text,
  }, () => performSend(accountId, opt));
}

function decodeQP(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(s) {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRaw(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const headEnd = text.indexOf('\n\n');
  const head = headEnd > 0 ? text.slice(0, headEnd) : text;
  const bodyRaw = headEnd > 0 ? text.slice(headEnd + 2) : '';

  const hdr = (name) => {
    const m = head.match(new RegExp('^' + name + ':\\s*([\\s\\S]*?)(?=\\n[^\\s]|$)', 'im'));
    return m ? m[1].replace(/\n\s+/g, ' ').trim() : '';
  };

  const fromEmail = (hdr('From').match(/<([^>]+)>/) || hdr('From').match(/([^\s<>]+@[^\s<>]+)/) || [])[1] || '';
  const fromNameRaw = hdr('From').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  let fromName = fromNameRaw;
  const mEnc = fromNameRaw.match(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/);
  if (mEnc) {
    try {
      const buf = mEnc[2].toUpperCase() === 'B' ? Buffer.from(mEnc[3], 'base64') : Buffer.from(decodeQP(mEnc[3].replace(/_/g, ' ')), 'binary');
      fromName = buf.toString('utf8');
    } catch {}
  }
  const subjectRaw = hdr('Subject');
  let subject = subjectRaw;
  const sEnc = subjectRaw.match(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/);
  if (sEnc) {
    try {
      const buf = sEnc[2].toUpperCase() === 'B' ? Buffer.from(sEnc[3], 'base64') : Buffer.from(decodeQP(sEnc[3].replace(/_/g, ' ')), 'binary');
      subject = buf.toString('utf8');
    } catch {}
  }

  let body = bodyRaw;
  const cte = hdr('Content-Transfer-Encoding').toLowerCase();
  if (cte === 'base64') {
    try {
      body = Buffer.from(bodyRaw.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch {}
  } else if (cte === 'quoted-printable') {
    body = decodeQP(bodyRaw);
  }
  // multipart：优先取 text/plain 段
  if (/multipart\//i.test(hdr('Content-Type'))) {
    const parts = bodyRaw.split(/--[-\w]+/);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    const htmlPart = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (plain) {
      const i = plain.indexOf('\n\n');
      let b = i > 0 ? plain.slice(i + 2) : plain;
      if (/quoted-printable/i.test(plain.slice(0, i))) b = decodeQP(b);
      if (/base64/i.test(plain.slice(0, i))) {
        try {
          b = Buffer.from(b.replace(/\s/g, ''), 'base64').toString('utf8');
        } catch {}
      }
      body = b;
    } else if (htmlPart) {
      const i = htmlPart.indexOf('\n\n');
      body = stripHtml(i > 0 ? htmlPart.slice(i + 2) : htmlPart);
    }
  }
  body = stripHtml(body).slice(0, 2000);

  return {
    fromEmail: fromEmail.toLowerCase(),
    fromName: fromName || fromEmail,
    subject,
    text: body,
    messageId: hdr('Message-ID'),
    inReplyTo: hdr('In-Reply-To') || hdr('References'),
    date: hdr('Date'),
  };
}

/* ---------------- IMAP 拉取新邮件 ---------------- */

const MOCK_REPLIES = [
  { from: 'markus.weber@example.invalid', name: 'Markus Weber', subject: 'Re: Stainless steel hinge — price list', text: 'Hi, thanks for your message. Please send your price list and MOQ for SS-201. We import about 20,000 pcs per year.' },
  { from: 'omar@example.invalid', name: 'Omar Al-Rashid', subject: 'Re: Window handles', text: 'What is your best price for 5,000 pcs AH-330 delivered to Dammam? Also do you have CE certificate?' },
  { from: 'l.herrera@example.invalid', name: 'Luis Herrera', subject: 'Re: Door closer', text: 'Not interested at the moment, maybe next quarter. Thanks.' },
];

async function fetchReplies(accountId) {
  const a = get(accountId);
  if (!a) throw new Error('邮箱不存在');

  if (MOCK) {
    const pick = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];
    return [{ ...pick, messageId: 'mock-' + Date.now(), inReplyTo: '', ts: Date.now() }];
  }

  libs();
  const client = new imapflow.ImapFlow({
    host: a.imap.host,
    port: Number(a.imap.port) || 993,
    secure: true,
    auth: { user: a.imap.user || a.email, pass: a.imap.pass || a.pass },
    logger: false,
  });
  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const sinceDays = 30;
      const since = new Date(Date.now() - sinceDays * 86400000);
      for await (const msg of client.fetch({ since, seen: false }, { uid: true, envelope: true, source: true })) {
        const raw = msg.source ? msg.source.toString('utf8') : '';
        const p = parseRaw(raw);
        if (!p.fromEmail) continue;
        out.push({ ...p, ts: (msg.envelope && msg.envelope.date ? new Date(msg.envelope.date).getTime() : Date.now()) });
        try {
          await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
        } catch {}
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  a.lastCheck = Date.now();
  store.save();
  return out;
}

/** 后台轮询：默认 3 分钟一轮，只拉未读，不阻塞 */
let pollTimer = null;
let polling = false;

async function pollOnce(onReply) {
  if (polling) return;
  polling = true;
  try {
    for (const a of store.getRoot().mailAccounts) {
      await store.runTenant(a.mid, async () => {
      try {
        const list0 = await fetchReplies(a.id);
        for (const r of list0) onReply({ channel: 'mail', accountId: a.id, accountLabel: a.label, ...r });
        a.status = 'ready';
        a.lastError = null;
      } catch (e) {
        a.status = 'error';
        a.lastError = e.message;
      }
      store.save();
      });
    }
  } finally {
    polling = false;
  }
}

function startPolling(onReply, seconds = 180) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => pollOnce(onReply).catch(() => {}), Math.max(60, seconds) * 1000);
  setTimeout(() => pollOnce(onReply).catch(() => {}), 8000);
}

export default { bus, MOCK, list, get, create, update, remove, send, testConn, fetchReplies, startPolling, pollOnce, sentToday, markSent, inferHosts, parseRaw };
