import { billable } from './billing.js';
'use strict';
/**
 * WhatsApp 会话管理（whatsapp-web.js）
 * 每个账号一张卡：扫码 → 在线 → 收发。掉线不丢会话，重启自动恢复。
 */
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import QRCode from 'qrcode';
import store from './store.js';

const MOCK = String(process.env.WA_MOCK || '0') === '1';
const HEADLESS = String(process.env.WA_HEADLESS || '1') !== '0';
const PROXY = process.env.WA_PROXY || '';
const bus = new EventEmitter();

import whatsApp from 'whatsapp-web.js';
const { Client, LocalAuth } = whatsApp;
function loadLib() {
  if (Client) return;
  try {
    return;
  } catch (e) {
    throw new Error('whatsapp-web.js 未安装：在项目目录执行 npm install');
  }
}

function resolveExecutable() {
  if (process.env.WA_EXECUTABLE_PATH) return process.env.WA_EXECUTABLE_PATH;
  const cands = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}

const runtime = new Map(); // id -> state

const MOCK_CHATS = [
  { id: '4915112345678@example.invalid', name: 'Markus Weber', number: '4915112345678', isGroup: false, unread: 2, ts: Date.now() - 8 * 60000, last: 'Please send the price list for hinges.' },
  { id: '966551234190@example.invalid', name: 'Omar Al-Rashid', number: '966551234190', isGroup: false, unread: 1, ts: Date.now() - 47 * 60000, last: 'What is your MOQ for window handles?' },
  { id: '528112347726@example.invalid', name: 'Luis Herrera', number: '528112347726', isGroup: false, unread: 0, ts: Date.now() - 5 * 3600000, last: 'Received, thanks.' },
  { id: '849033513351@example.invalid', name: 'Nguyen Van An', number: '849033513351', isGroup: false, unread: 3, ts: Date.now() - 26 * 3600000, last: 'Can you ship to Ho Chi Minh?' },
  { id: '485190479047@example.invalid', name: 'Katarzyna Nowak', number: '485190479047', isGroup: false, unread: 0, ts: Date.now() - 50 * 3600000, last: 'We are interested in window handles.' },
  { id: '628122882288@example.invalid', name: 'Budi Santoso', number: '628122882288', isGroup: false, unread: 0, ts: Date.now() - 72 * 3600000, last: '' },
  { id: '12025550188@example.invalid', name: 'Daniel Brooks', number: '12025550188', isGroup: false, unread: 0, ts: Date.now() - 96 * 3600000, last: '' },
  { id: '6598765432@example.invalid', name: 'Wei Tan', number: '6598765432', isGroup: false, unread: 0, ts: Date.now() - 120 * 3600000, last: '' },
];

function reg() {
  return store.get().waAccounts;
}

function pub(s) {
  if (!s) return null;
  return {
    id: s.id,
    label: s.label,
    status: s.status,
    qr: s.qr || null,
    qrUpdatedAt: s.qrUpdatedAt || null,
    me: s.me || null,
    error: s.error || null,
    lastEvent: s.lastEvent || null,
    startedAt: s.startedAt || null,
    sentToday: s.sentToday || 0,
    sentTotal: s.sentTotal || 0,
    limit: store.get().settings.send.waDailyLimit,
  };
}

function list() {
  return reg().map(
    (r) =>
      pub(get(r.id)) || {
        id: r.id,
        label: r.label,
        status: 'stopped',
        qr: null,
        me: null,
        error: null,
        sentToday: r.sentToday || 0,
        sentTotal: r.sentTotal || 0,
        limit: store.get().settings.send.waDailyLimit,
      }
  );
}

function get(id) {
  const account = reg().find((row) => row.id === id);
  if (!account) return undefined;
  if (account.source === 'platform') {
    const config = store.get().settings.whatsapp || {};
    return { ...account, status: config.api_key && config.base_url && config.phone_number_id ? 'online' : 'unconfigured' };
  }
  return runtime.get(id);
}

function onlineIds() {
  return list()
    .filter((s) => s.status === 'online')
    .map((s) => s.id);
}

function build(rec) {
  const st = {
    id: rec.id,
    label: rec.label,
    status: 'starting',
    qr: null,
    qrUpdatedAt: null,
    me: null,
    error: null,
    lastEvent: 'created',
    startedAt: Date.now(),
    sentToday: rec.sentDay === store.todayKey() ? rec.sentToday || 0 : 0,
    sentTotal: rec.sentTotal || 0,
    client: null,
    timer: null,
  };
  runtime.set(rec.id, st);
  bus.emit('change');

  if (MOCK) {
    st.lastEvent = 'mock';
    setTimeout(async () => {
      if (st.status !== 'starting') return;
      st.qr = await QRCode.toDataURL('MOCK-' + rec.id + '-' + Date.now(), { width: 320, margin: 1 });
      st.qrUpdatedAt = Date.now();
      st.status = 'qr';
      st.lastEvent = 'qr';
      bus.emit('change');
    }, 1200);
    st.timer = setInterval(async () => {
      if (st.status === 'qr') {
        st.qr = await QRCode.toDataURL('MOCK-' + rec.id + '-' + Date.now(), { width: 320, margin: 1 });
        st.qrUpdatedAt = Date.now();
        bus.emit('change');
      }
    }, 20000);
    return st;
  }

  loadLib();
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
  ];
  if (PROXY) args.push('--proxy-server=' + PROXY);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: rec.id, dataPath: store.SESSIONS_DIR }),
    puppeteer: { headless: HEADLESS, executablePath: resolveExecutable(), args },
  });
  st.client = client;

  const push = (patch) => {
    Object.assign(st, patch);
    bus.emit('change');
  };

  client.on('qr', async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      push({ status: 'qr', qr: dataUrl, qrUpdatedAt: Date.now(), lastEvent: 'qr', error: null });
      console.log(`[wa:${rec.id}] 二维码已生成，等待扫码`);
    } catch (e) {
      push({ status: 'error', error: '二维码生成失败：' + e.message });
    }
  });

  client.on('authenticated', () => push({ status: 'authenticated', qr: null, lastEvent: 'authenticated' }));

  client.on('auth_failure', (msg) => push({ status: 'error', qr: null, lastEvent: 'auth_failure', error: '认证失败：' + (msg || '未知') }));

  client.on('ready', () => {
    let me = null;
    try {
      me = { id: client.info.wid.user, name: client.info.pushname || '' };
    } catch {}
    push({ status: 'online', qr: null, me, error: null, lastEvent: 'ready' });
    console.log(`[wa:${rec.id}] 已上线 ${me ? '+' + me.id : ''}`);
  });

  client.on('disconnected', (reason) => {
    push({ status: 'offline', qr: null, lastEvent: 'disconnected', error: '连接断开：' + reason });
    st.client = null;
    console.log(`[wa:${rec.id}] 断开：${reason}`);
  });

  client.on('change_state', (s) => {
    if (['CONFLICT', 'UNLAUNCHED', 'UNPAIRED'].includes(s)) push({ status: 'offline', lastEvent: 'state:' + s });
  });

  // 收到客户消息 → 交给回复处理层（留资中心）
  client.on('message', async (msg) => {
    try {
      if (msg.fromMe) return;
      const chat = await msg.getChat().catch(() => null);
      if (chat && chat.isGroup) return;
      const contact = await msg.getContact().catch(() => null);
      const number = String(msg.from || '').split('@')[0];
      bus.emit('incoming', {
        channel: 'wa',
        accountId: rec.id,
        accountLabel: rec.label,
        from: number,
        name: (contact && (contact.pushname || contact.name)) || (chat && chat.name) || '',
        text: String(msg.body || ''),
        ts: (msg.timestamp || Math.floor(Date.now() / 1000)) * 1000,
        externalId: msg.id && msg.id._serialized ? msg.id._serialized : '',
      });
    } catch (e) {
      console.error('[wa] 消息处理失败', e.message);
    }
  });

  client.initialize().catch((e) => {
    const raw = String((e && e.message) || e);
    let hint = raw;
    if (/ERR_CONNECTION|TIMED_OUT|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET/.test(raw)) {
      hint = '无法访问 web.whatsapp.com（' + raw + '）。服务器需能直连 WhatsApp：国内机器请设置 WA_PROXY 走代理，或部署到海外服务器。';
    } else if (/Could not find Chrome|Could not find browser|Failed to launch/i.test(raw)) {
      hint = '找不到浏览器。① 安装系统 chromium 并设 WA_EXECUTABLE_PATH=/usr/bin/chromium；② 或执行 ./node_modules/.bin/puppeteer browsers install chrome 并设 PUPPETEER_CACHE_DIR=' + path.join(store.ROOT, '.cache') + '。原文：' + raw;
    }
    push({ status: 'error', error: '启动失败：' + hint, lastEvent: 'init_error' });
    console.error(`[wa:${rec.id}] 启动失败`, raw);
  });

  return st;
}

async function create(label) {
  const d = store.get();
  const rec = { id: store.nextId('wa'), label: String(label || '').trim() || 'WhatsApp ' + (d.waAccounts.length + 1), createdAt: Date.now(), sentDay: '', sentToday: 0, sentTotal: 0 };
  d.waAccounts.push(rec);
  store.saveNow();
  build(rec);
  return pub(runtime.get(rec.id));
}

async function start(id) {
  const rec = reg().find((r) => r.id === id);
  if (!rec) throw new Error('账号不存在');
  if (rec.source === 'platform') return pub(get(id));
  const cur = runtime.get(id);
  if (cur && ['starting', 'qr', 'authenticated', 'online'].includes(cur.status)) return pub(cur);
  if (cur) {
    if (cur.timer) clearInterval(cur.timer);
    if (cur.client && cur.client.destroy) await cur.client.destroy().catch(() => {});
    runtime.delete(id);
  }
  build(rec);
  return pub(runtime.get(id));
}

async function stop(id, remove) {
  if (!reg().some((row) => row.id === id)) throw new Error('账号不存在');
  if (reg().find((row) => row.id === id)?.source === 'platform') throw new Error('请在平台主页后台管理平台WhatsApp通道');
  const s = runtime.get(id);
  if (s) {
    if (s.timer) clearInterval(s.timer);
    try {
      if (s.client && s.client.destroy) {
        if (remove && s.client.logout) await s.client.logout().catch(() => {});
        await s.client.destroy().catch(() => {});
      }
    } catch {}
    runtime.delete(id);
  }
  if (remove) {
    try {
      fs.rmSync(path.join(store.SESSIONS_DIR, 'session-' + id), { recursive: true, force: true });
    } catch {}
    const d = store.get();
    d.waAccounts = d.waAccounts.filter((r) => r.id !== id);
    store.saveNow();
  }
  bus.emit('change');
}

function markSent(id) {
  const d = store.get();
  const rec = d.waAccounts.find((r) => r.id === id);
  const st = runtime.get(id);
  const day = store.todayKey();
  if (rec) {
    if (rec.sentDay !== day) {
      rec.sentDay = day;
      rec.sentToday = 0;
    }
    rec.sentToday = (rec.sentToday || 0) + 1;
    rec.sentTotal = (rec.sentTotal || 0) + 1;
  }
  if (st) {
    if (st.sentDay !== day) {
      st.sentDay = day;
      st.sentToday = 0;
    }
    st.sentToday = (st.sentToday || 0) + 1;
    st.sentTotal = (st.sentTotal || 0) + 1;
  }
  store.save();
}

function sentToday(id) {
  const rec = reg().find((r) => r.id === id);
  if (!rec) return 0;
  return rec.sentDay === store.todayKey() ? rec.sentToday || 0 : 0;
}

async function performSend(id, to, text) {
  const account = reg().find((row) => row.id === id);
  if (!account) throw new Error('账号不存在');
  const s = get(id);
  if (!s) throw new Error('账号未启动');
  const num = String(to || '').replace(/[^\d]/g, '');
  if (!num) throw new Error('号码为空');
  if (MOCK) {
    if (s.status !== 'online') throw new Error('账号未上线（演示模式请先点「模拟上线」）');
    await new Promise((r) => setTimeout(r, 80));
    markSent(id);
    return { id: 'mock-' + Date.now(), to: num };
  }
  if (account.source === 'platform') {
    const config = store.get().settings.whatsapp;
    const base = config.base_url.replace(/\/$/, '');
    const endpoint = config.provider === 'meta' ? base + '/' + encodeURIComponent(config.phone_number_id) + '/messages' : base + '/messages';
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.api_key },
      body: JSON.stringify({ messaging_product: 'whatsapp', phone_number_id: config.phone_number_id, to: num, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error('WhatsApp接口未确认发送结果，请核对通道记录');
    const messageId = result.messages?.[0]?.id || result.id;
    if (!messageId) throw new Error('WhatsApp接口缺少发送凭证，请核对通道记录');
    markSent(id);
    return { id: String(messageId), to: num };
  }
  if (!s.client || s.status !== 'online') throw new Error('账号未上线');
  const r = await s.client.sendMessage(num + '@c.us', text);
  markSent(id);
  return { id: r.id ? r.id.id : null, to: num };
}

async function send(id, to, text, requestId) {
  if (!reg().some((row) => row.id === id)) throw new Error('账号不存在');
  const state = get(id);
  if (!state || state.status !== 'online') throw new Error('账号未上线');
  if (!String(to || '').replace(/[^\d]/g, '')) throw new Error('号码为空');
  if (!String(text || '').trim()) throw new Error('消息内容为空');
  return billable('wa_send', requestId || store.nextId('direct-wa-'), { id, to, text }, () => performSend(id, to, text));
}

async function chats(id) {
  if (!reg().some((row) => row.id === id)) throw new Error('账号不存在');
  const s = runtime.get(id);
  if (!s) throw new Error('账号未启动，请先启动并扫码');
  if (MOCK) return MOCK_CHATS.map((c) => ({ ...c }));
  if (s.status !== 'online') throw new Error('账号未上线，扫码成功后才能读取');
  const list0 = await s.client.getChats();
  return list0
    .map((c) => ({
      id: c.id && c.id._serialized ? c.id._serialized : '',
      name: c.name || (c.id && c.id.user) || '',
      number: c.id ? c.id.user || '' : '',
      isGroup: Boolean(c.isGroup),
      unread: c.unreadCount || 0,
      ts: (c.timestamp || 0) * 1000,
      last: c.lastMessage && c.lastMessage.body ? String(c.lastMessage.body).slice(0, 80) : '',
    }))
    .filter((c) => !c.isGroup && c.id)
    .sort((a, b) => b.ts - a.ts);
}

/** 演示模式：把账号标为在线 */
async function mockOnline(id) {
  if (!reg().some((row) => row.id === id)) throw new Error('账号不存在');
  if (!MOCK) throw new Error('仅演示模式可用');
  const s = runtime.get(id);
  if (!s) throw new Error('账号未启动');
  s.status = 'online';
  s.qr = null;
  s.lastEvent = 'mock_online';
  s.me = { id: '8613' + String(Math.floor(Math.random() * 9000000) + 1000000), name: s.label };
  s.client = s.client || { mock: true };
  bus.emit('change');
  return pub(s);
}

export default { bus, MOCK, list, get, pub, create, start, stop, send, chats, mockOnline, onlineIds, sentToday, markSent, MOCK_CHATS };
