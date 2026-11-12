import { lockDataDirectory } from './data-lock.js';
import { currentMid, runTenant } from './tenant-context.js';
import { tenantView } from './tenant-view.js';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
'use strict';
/**
 * 统一数据层（v4：多租户）
 *
 * 单个 JSON 文件 + 原子写。所有业务数据落在这里，重启不丢。
 *
 * v4 变更（相对 v3）：
 *   1. 每个业务集合的记录都带 `mid`（商户 ID，来自平台 merchant.id），按租户隔离读写；
 *   2. 新增 tenants / sessions / usage 三个容器：
 *      - tenants   ：租户档案（商户名、所属智能体、配额、状态、来源）
 *      - sessions  ：本服务自己的登录态（只存 sha256，cookie 里放明文 sid）
 *      - usage     ：按天累计的用量（点数、动作数、线索数、发送数），用于日限额与对账
 *   3. 知识库与发送/抓取设置改为"每租户一份"：tenantKb[mid] / tenantSettings[mid]，
 *      未初始化时从全局默认 kb / settings 派生（老数据零丢失）。
 *
 * 兼容性：老的调用方式 `get()` / `find()` 仍然可用，返回的是"全局视图"，
 *        不加 mid 参数时默认落在 defaultTenant 上，因此现有代码不改也能跑。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.OUTREACH_DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

[DATA_DIR, SESSIONS_DIR, UPLOAD_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const VERSION = 5;

const LIMITS = { leads: 20000, sends: 30000, replies: 8000, campaigns: 300, customers: 20000, aiJobs: 300, usage: 20000, sessions: 5000 };

/** 需要按租户隔离的集合 */
const TENANT_COLLECTIONS = [
  'waAccounts',
  'mailAccounts',
  'leads',
  'campaigns',
  'sends',
  'replies',
  'customers',
  'searchPlans',
  'aiJobs',
  'wechatAccounts',
  'contactTasks',
  'leadPushes',
  'suppressions',
  'billableOperations',
];

/** 单机部署、未接平台时的兜底租户 */
const DEFAULT_MID = process.env.CONSOLE_DEFAULT_MID || 'local';

const DEFAULT_SETTINGS = () => ({
  llm: { enabled: false, baseUrl: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini' },
  lead: {
    mode: 'web', // web=网页抓取(免key) / api=第三方数据源 / llm=大模型生成
    apiUrl: '',
    apiKey: '',
    searchKey: '', // 网页抓取用的搜索 API（Serper/Tavily/Google CSE），留空则用内置公开源
    searchProvider: 'serper',
    pageSize: 30,
  },
  send: {
    waDailyLimit: 40,
    waIntervalMin: 25,
    waIntervalMax: 60,
    waPerRound: 1, // 每个号连续发几条后换下一个号
    mailDailyLimit: 200,
    mailIntervalMin: 20,
    mailIntervalMax: 45,
    retrySwitch: true,
    textVary: true,
  },
  follow: { firstFollowDays: 3, alertDays: 7, gradeAKeywords: 'price,quotation,quote,MOQ,sample,catalog,order,采购,报价,样品' },
  mail: {},
  whatsapp: {},
  crm: {},
});

const DEFAULT_KB = () => ({
  company: {
    name: '',
    founded: '',
    location: '',
    products: '',
    markets: '',
    certs: '',
    intro: '',
    selling: '',
    website: '',
  },
  products: [],
  faq: [],
});

const DEFAULT_DB = () => ({
  meta: { createdAt: Date.now(), version: VERSION },
  defaultTenant: DEFAULT_MID,
  auth: { password: '', salt: '' },
  tenants: [],
  tenantSettings: {},
  tenantKb: {},
  sessions: [],
  usage: [],
  settings: DEFAULT_SETTINGS(),
  waAccounts: [],
  mailAccounts: [],
  leads: [],
  campaigns: [],
  sends: [],
  replies: [],
  customers: [],
  searchPlans: [],
  aiJobs: [],
  kb: DEFAULT_KB(),
});

let db = null;
let writeTimer = null;
let dirty = false;

/* ------------------------------------------------------------------ */
/* 迁移：v3 → v4                                                        */
/* ------------------------------------------------------------------ */

function migrate(d) {
  const from = Number((d.meta || {}).version) || 3;
  // Reconcile ownership on every load, including partially migrated v4 files.

  const mid = d.defaultTenant || DEFAULT_MID;
  const report = { from, to: VERSION, tagged: 0, tenants: 0 };

  // 1) 老记录补 mid
  for (const name of TENANT_COLLECTIONS) {
    if (!Array.isArray(d[name])) d[name] = [];
    for (const row of d[name]) {
      if (!row.mid) {
        row.mid = mid;
        report.tagged += 1;
      }
    }
  }

  // 2) 新容器
  if (!Array.isArray(d.tenants)) d.tenants = [];
  if (!Array.isArray(d.sessions)) d.sessions = [];
  if (!Array.isArray(d.usage)) d.usage = [];
  if (!d.tenantSettings || typeof d.tenantSettings !== 'object') d.tenantSettings = {};
  if (!d.tenantKb || typeof d.tenantKb !== 'object') d.tenantKb = {};
  // Legacy global settings and knowledge belong to the original tenant only.
  if (!d.tenantSettings[mid]) d.tenantSettings[mid] = structuredClone(d.settings || DEFAULT_SETTINGS());
  if (!d.tenantKb[mid]) d.tenantKb[mid] = structuredClone(d.kb || DEFAULT_KB());

  // 3) 兜底租户档案
  if (!d.tenants.find((t) => t.mid === mid)) {
    d.tenants.push({
      mid,
      name: (d.kb && d.kb.company && d.kb.company.name) || '本机租户',
      slug: '',
      agentId: null,
      status: 'active',
      source: 'local',
      createdAt: Date.now(),
      lastLoginAt: 0,
      quota: { points: null, dailyActions: null },
    });
    report.tenants += 1;
  }

  d.meta = { ...(d.meta || {}), version: VERSION, migratedAt: Date.now() };
  if (report.tagged || from < VERSION) console.log('[store] 数据结构已更新，补齐归属 %d 条', report.tagged);
  return d;
}

/* ------------------------------------------------------------------ */
/* 载入 / 落盘                                                          */
/* ------------------------------------------------------------------ */

function load() {
  if (db) return db;
  lockDataDirectory(DATA_DIR);
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('拓客数据文件读取失败，请检查数据文件及备份');
    raw = {};
  }
  const base = DEFAULT_DB();
  const rs = raw.settings || {};
  const rk = raw.kb || {};
  db = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw.meta || {}) },
    settings: {
      llm: { ...base.settings.llm, ...(rs.llm || {}) },
      lead: { ...base.settings.lead, ...(rs.lead || {}) },
      send: { ...base.settings.send, ...(rs.send || {}) },
      follow: { ...base.settings.follow, ...(rs.follow || {}) },
      mail: { ...(rs.mail || {}) },
      whatsapp: { ...(rs.whatsapp || {}) },
      crm: { ...(rs.crm || {}) },
    },
    kb: {
      company: { ...base.kb.company, ...(rk.company || {}) },
      products: Array.isArray(rk.products) ? rk.products : [],
      faq: Array.isArray(rk.faq) ? rk.faq : [],
    },
  };
  migrate(db);
  trim();
  if (Number((raw.meta || {}).version) !== VERSION || JSON.stringify(raw) !== JSON.stringify(db)) flush();
  return db;
}

function trim() {
  for (const [k, max] of Object.entries(LIMITS)) {
    if (Array.isArray(db[k]) && db[k].length > max) db[k] = db[k].slice(-max);
  }
}

function flush() {
  if (!db) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
  dirty = false;
}

/** 延迟 150ms 合并写，避免高频发送时每次都落盘 */
function save() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      if (dirty) flush();
    } catch (e) {
      console.error('[store] 写入失败', e.message);
    }
  }, 150);
}

/** 立即落盘（关键操作，如创建任务/账号/登录态） */
function saveNow() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

function get() {
  const database = load();
  const mid = currentMid();
  if (!mid) return database;
  if (!database.tenantSettings[mid]) database.tenantSettings[mid] = DEFAULT_SETTINGS();
  if (!database.tenantKb[mid]) database.tenantKb[mid] = DEFAULT_KB();
  return tenantView(database, mid, TENANT_COLLECTIONS);
}
const getRoot = () => load();

function nextId(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
}

function find(list, id) {
  return (get()[list] || []).find((x) => x.id === id);
}

function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* 租户作用域                                                           */
/* ------------------------------------------------------------------ */

function normMid(mid) {
  const d = load();
  return String(mid || currentMid() || d.defaultTenant || DEFAULT_MID);
}

/** 取某个租户下的记录（不带 mid 参数时用默认租户） */
function list(name, mid) {
  const d = load();
  const arr = d[name];
  if (!Array.isArray(arr)) return [];
  if (!TENANT_COLLECTIONS.includes(name)) return arr;
  const m = normMid(mid || currentMid());
  return arr.filter((x) => (x.mid || d.defaultTenant) === m);
}

function count(name, mid) {
  return list(name, mid).length;
}

function findIn(name, mid, id) {
  return list(name, mid).find((x) => x.id === id);
}

/** 新增记录，自动打上 id 与 mid */
function add(name, mid, obj, idPrefix) {
  const d = load();
  if (!Array.isArray(d[name])) d[name] = [];
  const row = { ...obj, id: obj.id || nextId(idPrefix || ''), mid: normMid(mid) };
  if (!row.createdAt) row.createdAt = Date.now();
  d[name].push(row);
  save();
  return row;
}

/** 更新记录（只改指定字段），返回更新后的记录 */
function update(name, mid, id, patch) {
  const row = findIn(name, mid, id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: Date.now() });
  save();
  return row;
}

/** 删除记录 */
function remove(name, mid, id) {
  const d = load();
  const m = normMid(mid || currentMid());
  const idx = (d[name] || []).findIndex((x) => x.id === id && (x.mid || d.defaultTenant) === m);
  if (idx < 0) return false;
  d[name].splice(idx, 1);
  save();
  return true;
}

/* ---------------- 租户档案 ---------------- */

function listTenants() {
  return load().tenants.slice();
}

function getTenant(mid) {
  const d = load();
  const m = normMid(mid || currentMid());
  return d.tenants.find((t) => t.mid === m) || null;
}

/** 平台带过来的商户第一次进来时建档；已存在则只刷新可变字段 */
function ensureTenant(input) {
  const d = load();
  const mid = String((input && input.mid) || '').trim();
  if (!mid) return null;
  let t = d.tenants.find((x) => x.mid === mid);
  if (!t) {
    t = {
      mid,
      name: input.name || input.company || mid,
      slug: input.slug || '',
      agentId: input.agentId || null,
      status: 'active',
      source: input.source || 'platform',
      createdAt: Date.now(),
      lastLoginAt: 0,
      quota: { points: null, dailyActions: null, ...(input.quota || {}) },
    };
    d.tenants.push(t);
  } else {
    for (const k of ['name', 'slug', 'agentId', 'status']) {
      if (input[k] !== undefined && input[k] !== null && input[k] !== '') t[k] = input[k];
    }
    if (input.quota) t.quota = { ...(t.quota || {}), ...input.quota };
  }
  // 首次建档时把全局默认设置/知识库复制一份给这个租户
  if (!d.tenantSettings[mid]) d.tenantSettings[mid] = DEFAULT_SETTINGS();
  if (!d.tenantKb[mid]) d.tenantKb[mid] = DEFAULT_KB();
  save();
  return t;
}

function touchTenantLogin(mid, ip) {
  const t = getTenant(mid);
  if (!t) return;
  t.lastLoginAt = Date.now();
  if (ip) t.lastLoginIp = ip;
  save();
}

/* ---------------- 租户级设置 / 知识库 ---------------- */

function settingsFor(mid) {
  const d = load();
  const m = normMid(mid || currentMid());
  const own = d.tenantSettings[m];
  if (!own) return d.settings;
  return {
    llm: { ...d.settings.llm, ...(own.llm || {}) },
    lead: { ...d.settings.lead, ...(own.lead || {}) },
    send: { ...d.settings.send, ...(own.send || {}) },
    follow: { ...d.settings.follow, ...(own.follow || {}) },
    mail: { ...(own.mail || {}) },
    whatsapp: { ...(own.whatsapp || {}) },
    crm: { ...(own.crm || {}) },
  };
}

function saveSettings(mid, patch) {
  const d = load();
  const m = normMid(mid || currentMid());
  const cur = d.tenantSettings[m] || DEFAULT_SETTINGS();
  d.tenantSettings[m] = {
    llm: { ...cur.llm, ...(patch.llm || {}) },
    lead: { ...cur.lead, ...(patch.lead || {}) },
    send: { ...cur.send, ...(patch.send || {}) },
    follow: { ...cur.follow, ...(patch.follow || {}) },
    mail: patch.mail === undefined ? (cur.mail || {}) : patch.mail,
    whatsapp: patch.whatsapp === undefined ? (cur.whatsapp || {}) : patch.whatsapp,
    crm: patch.crm === undefined ? (cur.crm || {}) : patch.crm,
  };
  saveNow();
  return d.tenantSettings[m];
}

function kbFor(mid) {
  const d = load();
  const m = normMid(mid || currentMid());
  return d.tenantKb[m] || d.kb;
}

function saveKb(mid, kb) {
  const d = load();
  const m = normMid(mid || currentMid());
  d.tenantKb[m] = kb;
  saveNow();
  return kb;
}

/* ---------------- 用量（按天，供日限额与对账） ---------------- */

function usageGet(mid, day) {
  const d = load();
  const m = normMid(mid || currentMid());
  const k = day || todayKey();
  return (
    d.usage.find((u) => u.mid === m && u.day === k) || {
      mid: m,
      day: k,
      points: 0,
      actions: 0,
      leads: 0,
      sends: 0,
      replies: 0,
      fail: 0,
    }
  );
}

/** 原子累加某一项（单进程内天然串行，不需要事务） */
function usageBump(mid, field, n = 1, day) {
  const d = load();
  const m = normMid(mid || currentMid());
  const k = day || todayKey();
  let u = d.usage.find((x) => x.mid === m && x.day === k);
  if (!u) {
    u = { mid: m, day: k, points: 0, actions: 0, leads: 0, sends: 0, replies: 0, fail: 0 };
    d.usage.push(u);
  }
  if (typeof u[field] !== 'number') u[field] = 0;
  u[field] += Number(n) || 0;
  u.updatedAt = Date.now();
  save();
  return u;
}

function usageList(mid, limit = 30) {
  const d = load();
  const m = normMid(mid || currentMid());
  return d.usage
    .filter((u) => u.mid === m)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, limit);
}

/* ---------------- 登录态（本服务自己的会话，与平台 SSO 并存） ---------------- */

const SESSION_TTL = Number(process.env.CONSOLE_SESSION_TTL || 7 * 24 * 3600) * 1000;

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** 建会话：返回明文 sid（写进 cookie），库里只留 hash */
function createSession(mid, opt = {}) {
  const d = load();
  const sid = crypto.randomBytes(24).toString('hex');
  const row = {
    id: nextId('s'),
    sid_hash: sha256(sid),
    mid: normMid(mid),
    createdAt: Date.now(),
    expireAt: Date.now() + (Number(opt.ttlMs) || SESSION_TTL),
    lastSeenAt: Date.now(),
    ip: opt.ip || '',
    ua: String(opt.ua || '').slice(0, 200),
    revoked: 0,
    role: opt.role || 'user',
    platformToken: opt.platformToken || '',
  };
  d.sessions.push(row);
  saveNow();
  return { sid, session: row };
}

function resolveSession(sid) {
  if (!sid) return null;
  const d = load();
  const h = sha256(sid);
  const row = d.sessions.find((s) => s.sid_hash === h);
  if (!row) return null;
  if (row.revoked) return null;
  if (row.expireAt && row.expireAt < Date.now()) return null;
  row.lastSeenAt = Date.now();
  save();
  return row;
}

function revokeSession(sid) {
  const d = load();
  const h = sha256(sid);
  const row = d.sessions.find((s) => s.sid_hash === h);
  if (!row) return false;
  row.revoked = 1;
  row.revokedAt = Date.now();
  saveNow();
  return true;
}

function revokeAllSessions(mid) {
  const d = load();
  const m = normMid(mid || currentMid());
  let n = 0;
  for (const s of d.sessions) {
    if (s.mid === m && !s.revoked) {
      s.revoked = 1;
      s.revokedAt = Date.now();
      n += 1;
    }
  }
  saveNow();
  return n;
}

function purgeSessions() {
  const d = load();
  const now = Date.now();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => !s.revoked && (!s.expireAt || s.expireAt > now));
  if (d.sessions.length !== before) save();
  return before - d.sessions.length;
}

/* ---------------- 口令 ---------------- */

function hashPassword(pwd) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { salt, password: sha256(salt + pwd) };
}

function verifyPassword(pwd) {
  const a = load().auth;
  if (!a || !a.password) return String(pwd || '') === (process.env.CONSOLE_PASSWORD || '');
  return sha256(a.salt + String(pwd || '')) === a.password;
}

function authConfigured() {
  const a = load().auth;
  return Boolean((a && a.password) || process.env.CONSOLE_PASSWORD);
}

function adminConfigured() {
  const a = load().auth || {};
  return Boolean((a.admin && a.admin.password) || process.env.ADMIN_PASSWORD);
}

function hashAdminPassword(pwd) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { salt, password: sha256(salt + pwd) };
}

function verifyAdmin(pwd) {
  const a = load().auth || {};
  if (!a.admin || !a.admin.password) return Boolean(process.env.ADMIN_PASSWORD) && String(pwd || '') === process.env.ADMIN_PASSWORD;
  return sha256(a.admin.salt + String(pwd || '')) === a.admin.password;
}

/* ---------------- 统计聚合 ---------------- */

function statsOfDay(dayKey, mid) {
  const sends = list('sends', mid).filter((s) => s.day === dayKey);
  const wa = sends.filter((s) => s.channel === 'wa');
  const mail = sends.filter((s) => s.channel === 'mail');
  const ok = (arr) => arr.filter((s) => s.status === 'sent').length;
  const read = (arr) => arr.filter((s) => s.readAt).length;
  const replied = (arr) => arr.filter((s) => s.repliedAt).length;
  const stat = (arr) => ({
    sent: ok(arr),
    failed: arr.filter((s) => s.status === 'failed').length,
    read: read(arr),
    replied: replied(arr),
    total: arr.length,
  });
  return { wa: stat(wa), mail: stat(mail), all: stat(sends) };
}

export default {
  ROOT,
  DATA_DIR,
  DB_FILE,
  SESSIONS_DIR,
  UPLOAD_DIR,
  VERSION,
  DEFAULT_MID,
  TENANT_COLLECTIONS,
  LIMITS,
  // 全局
  get,
  getRoot,
  currentMid,
  runTenant,
  save,
  saveNow,
  nextId,
  find,
  todayKey,
  sha256,
  // 租户作用域
  list,
  count,
  findIn,
  add,
  update,
  remove,
  // 租户档案
  listTenants,
  getTenant,
  ensureTenant,
  touchTenantLogin,
  settingsFor,
  saveSettings,
  kbFor,
  saveKb,
  // 用量
  usageGet,
  usageBump,
  usageList,
  // 会话
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessions,
  purgeSessions,
  // 口令
  hashPassword,
  verifyPassword,
  authConfigured,
  adminConfigured,
  hashAdminPassword,
  verifyAdmin,
  statsOfDay,
};
