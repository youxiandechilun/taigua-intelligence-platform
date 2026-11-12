#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
'use strict';
/**
 * 多租户数据体检 / 迁移工具
 *
 *   node tools/tenant-cli.js --check              只看结构，不写盘
 *   node tools/tenant-cli.js --migrate            执行 v3 → v4（自动备份）
 *   node tools/tenant-cli.js --list               列出所有租户与数据量
 *   node tools/tenant-cli.js --bind <mid> <name>  手工建一个租户（平台未接通时用）
 *   node tools/tenant-cli.js --assign <mid>       把没有归属的老数据划给指定租户
 *
 * 注意：store.js 在进程启动时会自动迁移。本工具主要是给运维"看"和"补"用的。
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const DB_FILE = store.DB_FILE;
import store from '../lib/store.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

function backup() {
  if (!fs.existsSync(DB_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dst = DB_FILE + '.bak-' + stamp;
  fs.copyFileSync(DB_FILE, dst);
  return dst;
}

function counts(db, mid) {
  const out = {};
  for (const name of store.TENANT_COLLECTIONS) {
    const arr = Array.isArray(db[name]) ? db[name] : [];
    out[name] = arr.filter((x) => (x.mid || db.defaultTenant) === mid).length;
  }
  return out;
}

function header(t) {
  console.log('\n' + '='.repeat(66));
  console.log(t);
  console.log('='.repeat(66));
}

if (has('--migrate')) {
  const bak = backup();
  if (bak) console.log('[备份] ' + bak);
  const db = store.get();
  store.saveNow();
  console.log('[完成] 版本 ' + db.meta.version + '，租户 ' + db.tenants.length + ' 个');
  process.exit(0);
}

if (has('--assign')) {
  const mid = val('--assign');
  if (!mid) {
    console.error('缺少 mid');
    process.exit(1);
  }
  const bak = backup();
  if (bak) console.log('[备份] ' + bak);
  const db = store.get();
  let n = 0;
  for (const name of store.TENANT_COLLECTIONS) {
    for (const row of db[name] || []) {
      if (!row.mid) {
        row.mid = mid;
        n += 1;
      }
    }
  }
  store.saveNow();
  console.log('[完成] 归属到 ' + mid + ' 的记录：' + n + ' 条');
  process.exit(0);
}

if (has('--bind')) {
  const i = argv.indexOf('--bind');
  const mid = argv[i + 1];
  const name = argv[i + 2] || mid;
  if (!mid) {
    console.error('用法：--bind <mid> <名称>');
    process.exit(1);
  }
  const t = store.ensureTenant({ mid, name, source: 'manual' });
  store.saveNow();
  console.log('[完成] 租户已建立：' + JSON.stringify(t));
  process.exit(0);
}

const db = store.get();

header('数据文件：' + DB_FILE);
console.log('版本：v' + db.meta.version + '  默认租户：' + db.defaultTenant);
console.log('体积：' + (fs.statSync(DB_FILE).size / 1024).toFixed(1) + ' KB');

header('租户清单');
if (!db.tenants.length) console.log('（无）');
for (const t of db.tenants) {
  const c = counts(db, t.mid);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  console.log(
    `- ${t.mid}  ${t.name}  [${t.status || 'active'}]  来源=${t.source || '-'}  记录=${total}`
  );
  console.log(
    '    ' +
      Object.entries(c)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => k + '=' + v)
        .join('  ')
  );
  console.log(
    '    设置=' + (db.tenantSettings[t.mid] ? '已初始化' : '未初始化') +
      '  知识库=' + (db.tenantKb[t.mid] ? '已初始化' : '未初始化')
  );
}

header('无归属记录（mid 缺失）');
let orphan = 0;
for (const name of store.TENANT_COLLECTIONS) {
  const n = (db[name] || []).filter((x) => !x.mid).length;
  if (n) {
    console.log('- ' + name + '：' + n);
    orphan += n;
  }
}
if (!orphan) console.log('（无，全部已归属）');

header('新容器');
console.log('sessions：' + (db.sessions || []).length + ' 条');
console.log('usage：' + (db.usage || []).length + ' 条');
if ((db.sessions || []).length) {
  const live = db.sessions.filter((s) => !s.revoked && (!s.expireAt || s.expireAt > Date.now()));
  console.log('  其中有效：' + live.length + ' 条（库里只存 sha256，看不到明文）');
}

header('结论');
console.log(orphan === 0 && db.meta.version === 4 ? '✅ 多租户结构已就绪' : '⚠️ 还有待处理项');
