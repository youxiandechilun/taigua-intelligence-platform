'use strict';
/**
 * 回复归集：客户回消息 → 自动匹配到发送记录 → 进留资中心 → 建/更新客户 → 自动分级
 */
import store from './store.js';

function normContact(v, channel) {
  const s = String(v || '').trim().toLowerCase();
  if (channel === 'mail') return s.replace(/^.*<|>.*$/g, '');
  return s.replace(/[^\d]/g, '').replace(/^0+/, '');
}

function findSend(channel, contact) {
  const key = normContact(contact, channel);
  if (!key) return null;
  const since = Date.now() - 60 * 86400000;
  const arr = store.get().sends.filter((s) => s.channel === channel && s.ts >= since && s.status === 'sent');
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const k = normContact(arr[i].to, channel);
    if (!k) continue;
    if (k === key || (channel === 'wa' && (k.endsWith(key) || key.endsWith(k)))) return arr[i];
  }
  return null;
}

function gradeOf(text) {
  const kw = (store.get().settings.follow.gradeAKeywords || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  const words = kw.split(/[,，\s]+/).filter(Boolean);
  const hit = words.some((w) => t.includes(w));
  return hit ? 'A' : 'B';
}

function upsertCustomer(info) {
  const d = store.get();
  const key = normContact(info.contact, info.channel);
  let c = d.customers.find((x) => normContact(x.contact, x.channel) === key && x.channel === info.channel);
  const followDays = Number(store.get().settings.follow.firstFollowDays) || 3;
  if (!c) {
    c = {
      id: store.nextId('cu'),
      name: info.name || info.contact,
      co: info.co || '',
      country: info.country || '',
      channel: info.channel,
      contact: info.contact,
      grade: gradeOf(info.text),
      stage: '已回复',
      owner: '',
      note: '',
      lastContact: info.ts || Date.now(),
      nextFollow: (info.ts || Date.now()) + followDays * 86400000,
      repliedCount: 0,
      thread: [],
      createdAt: Date.now(),
    };
    d.customers.push(c);
  } else {
    c.lastContact = Math.max(c.lastContact || 0, info.ts || Date.now());
    c.nextFollow = (info.ts || Date.now()) + followDays * 86400000;
    c.stage = c.stage === '已成交' ? c.stage : '已回复';
    const g = gradeOf(info.text);
    if (g === 'A') c.grade = 'A';
    else if (!c.grade) c.grade = 'B';
    if (info.name && (!c.name || c.name === c.contact)) c.name = info.name;
    if (info.co && !c.co) c.co = info.co;
  }
  c.repliedCount = (c.repliedCount || 0) + 1;
  c.thread = (c.thread || []).concat([{ ts: info.ts || Date.now(), dir: 'in', text: String(info.text || '').slice(0, 1000) }]).slice(-30);
  return c;
}

/** 处理一条进来的消息（WhatsApp 或邮件） */
function handleIncoming(p) {
  const d = store.get();
  const channel = p.channel === 'mail' ? 'mail' : 'wa';
  const extId = p.externalId || p.messageId || '';
  if (extId && d.replies.some((r) => r.externalId === extId)) return null;

  const contact = channel === 'mail' ? p.fromEmail || p.from : p.from;
  if (!contact) return null;

  const send = findSend(channel, contact);
  if (send) {
    if (!send.repliedAt) send.repliedAt = p.ts || Date.now();
    if (!send.readAt) send.readAt = p.ts || Date.now();
  }

  const customer = upsertCustomer({
    channel,
    contact,
    name: p.name || (send && send.name) || '',
    co: (send && send.co) || '',
    country: (send && send.country) || '',
    text: p.text,
    ts: p.ts,
  });

  const reply = {
    id: store.nextId('r'),
    channel,
    accountId: p.accountId || '',
    accountLabel: p.accountLabel || '',
    from: contact,
    name: p.name || customer.name || '',
    subject: p.subject || '',
    text: String(p.text || '').slice(0, 2000),
    ts: p.ts || Date.now(),
    campaignId: send ? send.campaignId : '',
    campaignName: send ? send.campaignName : '',
    customerId: customer.id,
    grade: customer.grade,
    externalId: extId,
    handled: false,
    note: '',
  };
  d.replies.push(reply);
  if (d.replies.length > store.LIMITS.replies) d.replies = d.replies.slice(-store.LIMITS.replies);

  if (channel === 'mail') {
    const acc = d.mailAccounts.find((a) => a.id === p.accountId);
    if (acc) acc.repliedTotal = (acc.repliedTotal || 0) + 1;
  }
  store.save();
  return reply;
}

function list(filter = {}) {
  const d = store.get();
  let arr = d.replies.slice().reverse();
  if (filter.channel) arr = arr.filter((r) => r.channel === filter.channel);
  if (filter.handled === true) arr = arr.filter((r) => r.handled);
  if (filter.handled === false) arr = arr.filter((r) => !r.handled);
  if (filter.grade) arr = arr.filter((r) => r.grade === filter.grade);
  if (filter.q) {
    const q = String(filter.q).toLowerCase();
    arr = arr.filter((r) => (r.name + r.from + r.text + r.subject).toLowerCase().includes(q));
  }
  return arr.slice(0, Number(filter.limit) || 200);
}

function unreadCount() {
  return store.get().replies.filter((r) => !r.handled).length;
}

function markHandled(id, handled = true, note = '') {
  const r = store.get().replies.find((x) => x.id === id);
  if (!r) throw new Error('记录不存在');
  r.handled = handled;
  if (note) r.note = note;
  store.save();
  return r;
}

/** 跟进提醒：超过 N 天未联系，或到达下次跟进时间 */
function followUps() {
  const d = store.get();
  const alertDays = Number(d.settings.follow.alertDays) || 7;
  const now = Date.now();
  return d.customers
    .filter((c) => c.stage !== '已成交' && c.stage !== '已放弃')
    .map((c) => {
      const idle = Math.floor((now - (c.lastContact || c.createdAt)) / 86400000);
      const due = c.nextFollow && c.nextFollow <= now;
      return { ...c, idleDays: idle, due, overdue: idle >= alertDays };
    })
    .filter((c) => c.due || c.overdue)
    .sort((a, b) => b.idleDays - a.idleDays);
}

export default { handleIncoming, list, unreadCount, markHandled, followUps, findSend };
