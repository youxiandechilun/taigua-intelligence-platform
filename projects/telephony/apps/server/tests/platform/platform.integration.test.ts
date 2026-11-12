import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';

interface MerchantFixture { mid: number; phone: string; password: string; company: string }
interface BrowserIdentity { cookie: string; parentToken: string; organizationId: string; userId: string }
const enabled = process.env.TAIGUA_INTEGRATION_TEST === '1';
let server: Server;
let baseUrl = '';
let merchants: MerchantFixture[] = [];
const identities: BrowserIdentity[] = [];
const createdAgents: string[] = [];
const chargeIds: string[] = [];
let database: typeof import('../../src/config/prisma.js').default;
let billing: typeof import('../../src/modules/platform/platform-billing.js');
const origin = 'http://127.0.0.1:18511';

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): string { assert.equal(typeof value, 'string'); return String(value); }
async function json(response: Response): Promise<Record<string, unknown>> { return record(await response.json()); }
async function publicPost(path: string, body: object, token?: string): Promise<Response> {
  return fetch(process.env.TAIGUA_PLATFORM_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body), redirect: 'manual',
  });
}
async function call(path: string, identity: BrowserIdentity, options: RequestInit = {}): Promise<Response> {
  return fetch(baseUrl + path, {
    ...options, redirect: 'manual', headers: {
      Cookie: identity.cookie, Origin: origin, 'X-Workspace-Id': identity.organizationId,
      'Content-Type': 'application/json', ...options.headers,
    },
  });
}
async function enter(merchant: MerchantFixture): Promise<BrowserIdentity> {
  const login = await publicPost('/api/auth/login', { phone: merchant.phone, password: merchant.password, scope: 'merchant' });
  assert.equal(login.status, 200);
  const parentToken = text(record((await json(login)).data).token);
  const ticket = await publicPost('/api/agents/enter', { agent_slug: 'ztgh' }, parentToken);
  assert.equal(ticket.status, 200);
  const url = new URL(text(record((await json(ticket)).data).url));
  const response = await fetch(baseUrl + '/api/v1/platform/sso?' + url.searchParams.toString(), { redirect: 'manual' });
  assert.equal(response.status, 303, '平台票据应建立本地会话');
  const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  assert.ok(cookie.includes('session_token='));
  const replay = await fetch(baseUrl + '/api/v1/platform/sso?' + url.searchParams.toString(), { redirect: 'manual' });
  assert.equal(replay.status, 401, '同一票据不可重复使用');
  const mapped = await database.taiguaMerchant.findUniqueOrThrow({ where: { merchantId_agentSlug: { merchantId: String(merchant.mid), agentSlug: 'ztgh' } } });
  return { cookie, parentToken, organizationId: mapped.organizationId, userId: mapped.userId };
}

before(async () => {
  if (!enabled) return;
  assert.ok(process.env.DATABASE_URL?.includes(':55438/'), '集成测试只允许独立本机 PostgreSQL 55438');
  assert.ok(process.env.TAIGUA_PLATFORM_URL?.startsWith('http://127.0.0.1:'));
  process.env.SERVER_URL = 'http://127.0.0.1:18510';
  process.env.BETTER_AUTH_URL = process.env.SERVER_URL;
  process.env.CONSOLE_URL = origin;
  process.env.BETTER_AUTH_SECRET ||= 'local-integration-secret-with-at-least-32-characters';
  process.env.SECRET_ENCRYPTION_KEY ||= 'a'.repeat(64);
  process.env.QUICKVOICE_BILLING_MODE = 'self_hosted';
  process.env.VOICE_BACKEND = 'aliyun';
  const fixture = record(JSON.parse(await readFile(process.env.TAIGUA_TEST_IDENTITIES_FILE!, 'utf8')));
  assert.ok(Array.isArray(fixture.accounts));
  merchants = fixture.accounts.map(value => {
    const account = record(value);
    assert.equal(typeof account.mid, 'number');
    return { mid: Number(account.mid), phone: text(account.phone), password: text(account.password), company: text(account.company) };
  });
  assert.ok(merchants.length >= 2);
  database = (await import('../../src/config/prisma.js')).default;
  billing = await import('../../src/modules/platform/platform-billing.js');
  const [{ default: platformRouter }, { default: agentRouter }, { default: companyRouter }, { default: errorHandler }] = await Promise.all([
    import('../../src/modules/platform/platform.route.js'), import('../../src/modules/agent/agent.route.js'),
    import('../../src/modules/workspace/company.route.js'), import('../../src/middleware/error.middleware.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/platform', platformRouter);
  app.use('/api/v1/agents', agentRouter);
  app.use('/api/v1/company', companyRouter);
  app.use(errorHandler);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = 'http://127.0.0.1:' + address.port;
  identities.push(await enter(merchants[0]!), await enter(merchants[1]!));
});

after(async () => {
  if (!enabled) return;
  for (const id of chargeIds) await billing.releaseCallPoints(id, '合成测试清理').catch(() => undefined);
  await database?.taiguaCallCharge.deleteMany({ where: { attemptId: { in: chargeIds } } });
  if (createdAgents.length) {
    await database.$executeRawUnsafe('DELETE FROM "AgentLearningRecording" WHERE "agentId"=ANY($1::text[])', createdAgents);
    await database.agent.deleteMany({ where: { agentId: { in: createdAgents } } });
  }
  for (const identity of identities) await publicPost('/api/auth/logout', {}, identity.parentToken);
  await database?.$disconnect();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('平台 SSO 创建两个独立工作区，商户管理员可创建和启用本商户数字员工', { skip: !enabled }, async () => {
  assert.notEqual(identities[0]!.organizationId, identities[1]!.organizationId);
  const actor = identities[0]!;
  const context = await call('/api/v1/company/context', actor);
  assert.equal(context.status, 200);
  assert.equal(record((await json(context)).data).canCreateAgents, true);
  const response = await call('/api/v1/agents', actor, { method: 'POST', body: JSON.stringify({ name: '集成测试数字员工' + randomUUID().slice(0, 8), isActive: true, templateId: 'customer-development' }) });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const agentId = text(record((await json(response)).data).agentId);
  createdAgents.push(agentId);
  const foreign = await call('/api/v1/agents/' + agentId + '/playbook', identities[1]!);
  assert.equal(foreign.status, 404, '另一商户不可读取员工话术');
  const paused = await call('/api/v1/agents/' + agentId, actor, { method: 'PATCH', body: JSON.stringify({ isActive: false }) });
  assert.equal(paused.status, 200);
});

test('录音素材真实上传、读取、租户隔离及 Origin 校验', { skip: !enabled }, async () => {
  const agentId = createdAgents[0];
  assert.ok(agentId);
  const actor = identities[0]!;
  const wave = Buffer.alloc(44 + 16000 * 2 * 2);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  const path = '/api/v1/agents/' + agentId + '/learning/recordings';
  const options = { method: 'POST', body: wave, headers: { 'Content-Type': 'audio/wav', 'X-Recording-Consent': 'yes', 'X-Recording-Name': encodeURIComponent('本机合成录音') } };
  const uploaded = await call(path, actor, options);
  assert.equal(uploaded.status, 200, JSON.stringify(await uploaded.clone().json()));
  const result = record((await json(uploaded)).data);
  assert.equal(result.status, 'UPLOADED');
  const recordingId = text(result.id);
  const audio = await call(path + '/' + recordingId + '/audio', actor);
  assert.equal(audio.status, 200);
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wave);
  const denied = await call(path + '/' + recordingId + '/audio', identities[1]!);
  assert.equal(denied.status, 404);
  const csrf = await call(path, actor, { ...options, headers: { ...options.headers, Origin: 'http://untrusted.invalid' } });
  assert.equal(csrf.status, 403);
  const invalid = await call(path, actor, { ...options, body: Buffer.from('not-a-wave') });
  assert.equal(invalid.status, 400);
});

test('通话先冻结，61秒结算2分钟，重放幂等，未接通释放', { skip: !enabled }, async () => {
  const actor = identities[0]!;
  const { platformBalance } = await import('../../src/modules/platform/platform-client.js');
  const before = await platformBalance(String(merchants[0]!.mid));
  const attemptId = randomUUID(); chargeIds.push(attemptId);
  const reservations = await Promise.all(Array.from({ length: 8 }, () => billing.reserveCallPoints(actor.organizationId, attemptId, 600)));
  assert.ok(reservations.every(item => item?.holdId === reservations[0]?.holdId));
  const reserved = await platformBalance(String(merchants[0]!.mid));
  assert.ok(reserved.frozen > before.frozen);
  await Promise.all(Array.from({ length: 5 }, () => billing.settleCallPoints(attemptId, 61)));
  const charge = await database.taiguaCallCharge.findUniqueOrThrow({ where: { attemptId } });
  assert.equal(charge.actualQuantity, 2);
  assert.equal(charge.status, 'SETTLED');
  const settled = await platformBalance(String(merchants[0]!.mid));
  assert.equal(settled.frozen, before.frozen);
  await billing.settleCallPoints(attemptId, 61);
  assert.deepEqual(await platformBalance(String(merchants[0]!.mid)), settled);
  const second = randomUUID(); chargeIds.push(second);
  await billing.reserveCallPoints(actor.organizationId, second);
  await billing.settleCallPoints(second, 0);
  assert.deepEqual(await platformBalance(String(merchants[0]!.mid)), settled);
});

test('主页退出后电销 Cookie 立即失效', { skip: !enabled }, async () => {
  const actor = identities[0]!;
  const logout = await publicPost('/api/auth/logout', {}, actor.parentToken);
  assert.equal(logout.status, 200);
  const response = await call('/api/v1/company/context', actor);
  assert.equal(response.status, 401);
});
