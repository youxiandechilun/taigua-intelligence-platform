import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { startApplication, request } from './http-fixture.js';

const state = {
  sessions: new Map(), tickets: new Set(), holds: new Map(), balance: new Map([['A', 100], ['B', 100]]),
  providerCalls: 0, deliveries: 0, crmCalls: 0, llmFail: false, settleFail: false, sendFail: false,
};
let provider;
let application;
let providerBase;
let tokenA;
let tokenB;
let accountA;
let leadA;
let customerA;

before(async () => {
  provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('Content-Type', 'application/json');
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    const ok = (data) => send(200, { ok: true, data });
    if (req.url === '/chat/completions') {
      state.providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return send(state.llmFail ? 503 : 200, state.llmFail ? { error: { message: '合成模型失败' } } : { choices: [{ message: { content: '本地模型模拟草稿' } }] });
    }
    if (req.url === '/messages') {
      state.deliveries += 1;
      return send(state.sendFail ? 503 : 200, state.sendFail ? { error: '模拟结果未确认' } : { messages: [{ id: 'local-message-' + state.deliveries }] });
    }
    if (req.url === '/leads') { state.crmCalls += 1; return send(200, { id: 'crm-local' }); }
    if (req.headers['x-internal-key'] !== 'test-internal') return send(401, { ok: false, msg: '内部鉴权失败' });
    if (req.url === '/api/internal/sso/redeem') {
      if (!['ticket-A', 'ticket-B'].includes(body.token) || state.tickets.has(body.token)) return send(401, { ok: false, msg: '票据已失效' });
      state.tickets.add(body.token);
      const mid = body.token.slice(-1);
      const sessionToken = 'session-' + mid;
      state.sessions.set(sessionToken, mid);
      return ok({ mid, merchant_name: '测试商户' + mid, agent_id: 13, slug: 'ztgt', balance: 100, expire_at: Math.floor(Date.now() / 1000) + 3600, external_user_id: mid, session_token: sessionToken });
    }
    if (req.url === '/api/internal/sso/validate') {
      const mid = state.sessions.get(body.token);
      return mid ? ok({ mid }) : send(401, { ok: false, msg: '会话已撤销' });
    }
    if (req.url.startsWith('/api/internal/config')) return ok({
      model: { enabled: true, base_url: providerBase, api_key: 'model-test', model: 'local-model' }, search: { provider: '', base_url: '', api_key: '' },
      whatsapp: { provider: 'http', base_url: providerBase, api_key: 'channel-test', phone_number_id: 'test-number', verify_token: 'webhook-test' },
      mail: { host: 'smtp.invalid', port: 465, secure: true, username: 'local@test.invalid', password: 'mail-test', from_address: 'local@test.invalid', imap_host: 'imap.invalid' },
      crm: { provider: 'http', base_url: providerBase, api_key: 'crm-test' },
    });
    if (req.url === '/api/internal/points/reserve') {
      if (state.balance.get(body.mid) < 1) return send(402, { ok: false, code: 'INSUFFICIENT_POINTS', msg: '点数不足' });
      const holdId = 'hold-' + (state.holds.size + 1);
      state.holds.set(holdId, { ...body, status: 'reserved' });
      state.balance.set(body.mid, state.balance.get(body.mid) - 1);
      return ok({ hold_id: holdId, held: 1 });
    }
    if (req.url === '/api/internal/points/settle') {
      if (state.settleFail) return send(503, { ok: false, msg: '合成结算故障' });
      const hold = state.holds.get(body.hold_id);
      hold.status = 'settled';
      return ok({ charged: 1 });
    }
    if (req.url === '/api/internal/points/release') {
      const hold = state.holds.get(body.hold_id);
      if (hold.status === 'reserved') state.balance.set(hold.mid, state.balance.get(hold.mid) + 1);
      hold.status = 'released';
      return ok({ released: 1 });
    }
    send(404, { ok: false, msg: '未找到' });
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  providerBase = 'http://127.0.0.1:' + provider.address().port;
  application = await startApplication({ TAIGUA_PLATFORM_URL: providerBase, INTERNAL_API_KEY: 'test-internal', WA_MOCK: '0', TAIGUA_AGENT_SLUG: 'ztgt' });
  tokenA = (await request(application.base, '/api/auth/sso', { token: 'ticket-A' })).body.token;
  tokenB = (await request(application.base, '/api/auth/sso', { token: 'ticket-B' })).body.token;
});

after(async () => {
  if (application) await application.close();
  if (provider) await new Promise((resolve) => provider.close(resolve));
});

test('未登录401、单次换票、Cookie和管理员边界', async () => {
  assert.equal((await request(application.base, '/api/domestic/overview')).status, 401);
  assert.equal((await request(application.base, '/api/auth/sso?token=ticket-A')).status, 401);
  assert.equal((await request(application.base, '/api/admin/password', { next: '12345678' }, tokenA)).status, 403);
  assert.equal((await request(application.base, '/api/domestic/overview', undefined, undefined, { Cookie: 'outreach_session=' + tokenA })).status, 200);
  assert.equal((await request(application.base, '/api/domestic/overview', undefined, undefined, { Cookie: 'outreach_session=%XX' })).status, 401);
  assert.equal((await request(application.base, '/api/domestic/leads', { co: '跨来源' }, tokenA, { Origin: 'https://untrusted.invalid' })).status, 403);
});

test('国内线索、联系审核、留资分配和客户跟进通过正常HTTP入口', async () => {
  assert.equal((await request(application.base, '/api/domestic/leads', { rows: [{ co: '合成企业A', phone: '13900000001', wechat: 'wx-test-A' }, { co: '合成企业A', phone: '13900000001' }] }, tokenA)).body.added, 1);
  leadA = (await request(application.base, '/api/domestic/leads', undefined, tokenA)).body.data.list[0];
  accountA = (await request(application.base, '/api/wechat/accounts', { label: '测试微信A', wechatId: 'test-a', owner: '负责人A' }, tokenA)).body.data;
  const task = (await request(application.base, '/api/contact-tasks', { leadId: leadA.id, accountId: accountA.id, text: '合成联系草稿' }, tokenA)).body.data;
  assert.equal(task.status, '待审核');
  assert.equal((await request(application.base, '/api/contact-tasks/' + task.id, { status: '已回复' }, tokenA, {}, 'PATCH')).status, 400);
  for (const status of ['待联系', '已联系', '已回复']) assert.equal((await request(application.base, '/api/contact-tasks/' + task.id, { status, note: '合成结果' }, tokenA, {}, 'PATCH')).status, 200);
  customerA = (await request(application.base, '/api/domestic/leads/' + leadA.id + '/qualify', { requirement: '测试客户确认采购需求', owner: '测试负责人' }, tokenA)).body.data;
  const pushHeaders = { 'Idempotency-Key': 'push-A' };
  const pushed = await request(application.base, '/api/domestic/leads/' + leadA.id + '/push', { owner: '接收人A' }, tokenA, pushHeaders);
  assert.equal(pushed.body.data.status, '已送达');
  assert.equal(pushed.body.data.channel, 'crm');
  await request(application.base, '/api/domestic/leads/' + leadA.id + '/push', { owner: '接收人A' }, tokenA, pushHeaders);
  assert.equal(state.crmCalls, 1);
  const followed = await request(application.base, '/api/domestic/customers/' + customerA.id + '/followups', { note: '已发送报价', stage: '报价中', nextFollow: 0 }, tokenA);
  assert.equal(followed.body.data.stage, '报价中');
});

test('两个商户并发写入和详情访问隔离', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, index) => request(application.base, '/api/domestic/leads', { co: '并发企业' + index, phone: '130' + String(index).padStart(8, '0') }, index % 2 ? tokenA : tokenB)));
  const resultB = (await request(application.base, '/api/domestic/leads', undefined, tokenB)).body.data;
  assert.equal(resultB.total, 10);
  assert.ok(resultB.list.every((row) => row.mid === 'B'));
  assert.equal((await request(application.base, '/api/domestic/leads/' + leadA.id + '/qualify', { requirement: '越权' }, tokenB)).status, 404);
  assert.equal((await request(application.base, '/api/contact-tasks', { leadId: leadA.id, accountId: accountA.id, text: '越权' }, tokenB)).status, 404);
  assert.equal((await request(application.base, '/api/domestic/leads?mid=A', undefined, tokenB)).status, 403);
  assert.equal((await request(application.base, '/api/customers', undefined, tokenB)).body.total, 0);
});

test('AI草稿20次并发重放只调用一次模型及冻结，参数冲突409', async () => {
  const count = state.providerCalls;
  const holds = state.holds.size;
  const headers = { 'Idempotency-Key': 'draft-concurrent' };
  const responses = await Promise.all(Array.from({ length: 20 }, () => request(application.base, '/api/domestic/draft', { leadId: leadA.id }, tokenA, headers)));
  assert.ok(responses.every((response) => response.status === 200 && response.body.data.text === '本地模型模拟草稿'));
  assert.equal(state.providerCalls - count, 1);
  assert.equal(state.holds.size - holds, 1);
  const otherLead = (await request(application.base, '/api/domestic/leads', undefined, tokenA)).body.data.list.find((row) => row.id !== leadA.id);
  assert.equal((await request(application.base, '/api/domestic/draft', { leadId: otherLead.id }, tokenA, headers)).status, 409);
});

test('模型失败释放冻结，余额不足不会执行模型', async () => {
  state.llmFail = true;
  const beforeBalance = state.balance.get('A');
  assert.equal((await request(application.base, '/api/domestic/draft', { leadId: leadA.id }, tokenA, { 'Idempotency-Key': 'draft-failed' })).status, 400);
  assert.equal(state.balance.get('A'), beforeBalance);
  state.llmFail = false;
  state.balance.set('A', 0);
  const calls = state.providerCalls;
  assert.equal((await request(application.base, '/api/domestic/draft', { leadId: leadA.id }, tokenA, { 'Idempotency-Key': 'draft-insufficient' })).status, 402);
  assert.equal(state.providerCalls, calls);
  state.balance.set('A', beforeBalance);
});

test('结算故障后的重试只重试结算，保持一次模型执行', async () => {
  state.settleFail = true;
  const headers = { 'Idempotency-Key': 'draft-settle-retry' };
  const calls = state.providerCalls;
  assert.equal((await request(application.base, '/api/domestic/draft', { leadId: leadA.id }, tokenA, headers)).status, 200);
  state.settleFail = false;
  assert.equal((await request(application.base, '/api/domestic/draft', { leadId: leadA.id }, tokenA, headers)).status, 200);
  assert.equal(state.providerCalls - calls, 1);
});

test('平台邮箱受控、WhatsApp发送幂等、签名回调归集且去重', async () => {
  const mailbox = (await request(application.base, '/api/mail', undefined, tokenA)).body.accounts[0];
  assert.equal(mailbox.source, 'platform');
  assert.equal(mailbox.pass, undefined);
  assert.equal((await request(application.base, '/api/mail/' + mailbox.id, { label: '越权修改' }, tokenA, {}, 'PUT')).status, 400);
  const account = (await request(application.base, '/api/wa', undefined, tokenA)).body.accounts[0];
  const headers = { 'Idempotency-Key': 'wa-same-message' };
  const calls = state.deliveries;
  const responses = await Promise.all(Array.from({ length: 5 }, () => request(application.base, '/api/wa/' + account.id + '/send', { to: '12025550101', text: '本地模拟消息' }, tokenA, headers)));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(state.deliveries - calls, 1);
  assert.equal((await request(application.base, '/api/wa/' + account.id + '/send', { to: '12025550101', text: '越权' }, tokenB)).status, 400);
  const incoming = { id: 'incoming-local-1', from: '12025550101', text: '需要报价和样品' };
  assert.equal((await request(application.base, '/webhooks/whatsapp/A', incoming)).status, 403);
  const received = await request(application.base, '/webhooks/whatsapp/A', incoming, undefined, { 'X-Webhook-Token': 'webhook-test' });
  assert.equal(received.body.added, 1);
  assert.equal((await request(application.base, '/webhooks/whatsapp/A', incoming, undefined, { 'X-Webhook-Token': 'webhook-test' })).body.added, 0);
  assert.equal((await request(application.base, '/api/replies', undefined, tokenB)).body.replies.length, 0);
});

test('结果未确认保留核对状态，确认失败后释放且不重复发送', async () => {
  state.sendFail = true;
  const account = (await request(application.base, '/api/wa', undefined, tokenA)).body.accounts[0];
  const headers = { 'Idempotency-Key': 'wa-uncertain' };
  const input = { to: '12025550102', text: '本地未确认消息' };
  const balance = state.balance.get('A');
  assert.equal((await request(application.base, '/api/wa/' + account.id + '/send', input, tokenA, headers)).status, 400);
  assert.equal((await request(application.base, '/api/wa/' + account.id + '/send', input, tokenA, headers)).status, 409);
  const operation = (await request(application.base, '/api/operations', undefined, tokenA)).body.data.find((row) => row.requestId === 'wa-uncertain');
  assert.equal(operation.status, 'review_required');
  assert.equal((await request(application.base, '/api/operations/' + operation.id + '/review', { outcome: 'failed', note: '本地服务已确认失败' }, tokenB)).status, 404);
  assert.equal((await request(application.base, '/api/operations/' + operation.id + '/review', { outcome: 'failed', note: '本地服务已确认失败' }, tokenA)).status, 200);
  assert.equal(state.balance.get('A'), balance);
  state.sendFail = false;
});

test('父会话撤销在下一次业务请求立即生效', async () => {
  state.sessions.delete('session-B');
  assert.equal((await request(application.base, '/api/domestic/overview', undefined, tokenB)).status, 401);
  const database = JSON.parse(fs.readFileSync(path.join(application.directory, 'db.json'), 'utf8'));
  assert.ok(database.leads.every((row) => row.mid));
  assert.ok(database.sessions.every((row) => !row.sid && row.sid_hash));
});
