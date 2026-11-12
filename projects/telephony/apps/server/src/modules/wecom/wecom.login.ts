/*
 * 中文导读：企业微信：wecom.login.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash, randomBytes } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { redisConnection } from '../../config/redis.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { decryptSecretValue } from '../../lib/secrets.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { wecomClient, type WecomCredentials } from './wecom.client.js';
import { connection, type Scope } from './wecom.service.js';

const TTL = 300;
type LoginState = { organizationId: string; userId: string; sessionId: string; fingerprint: string };
const fingerprint = (corpId: string, c: WecomCredentials) => createHash('sha256')
  .update(JSON.stringify([corpId, c.agentId, c.secret])).digest('hex');
const stateKey = (state: string) => 'wecom:login:' + createHash('sha256').update(state).digest('hex');

async function bounded<T>(operation: () => Promise<T>): Promise<T> {
  if (redisConnection.status !== 'ready') throw new BadRequestError('扫码服务正在恢复，请稍后重试。');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BadRequestError('扫码服务响应超时，请重新发起扫码。')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

function returnUrl() {
  let url: URL;
  try { url = new URL(process.env.CONSOLE_URL || ''); } catch {
    throw new BadRequestError('系统访问域名尚未配置，请联系系统管理员。');
  }
  if (url.username || url.password || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new BadRequestError('扫码登录需要安全的系统访问域名。');
  }
  return url.origin + '/wecom?wecomLogin=return';
}

export async function startLogin(s: Scope, sessionId: string) {
  const { row, credentials: c } = await connection(s.organizationId);
  if (!sessionId || !/^\d{1,10}$/.test(c.agentId || '') || !c.secret || !row.notificationVerifiedAt) {
    throw new BadRequestError('请由公司管理员保存应用 ID 和 Secret，并检查应用连接后再扫码。');
  }
  const url = new URL('https://login.work.weixin.qq.com/wwlogin/sso/login');
  url.searchParams.set('login_type', 'CorpApp');
  url.searchParams.set('appid', row.corpId);
  url.searchParams.set('agentid', c.agentId!);
  url.searchParams.set('redirect_uri', returnUrl());
  url.searchParams.set('lang', 'zh');
  const state = randomBytes(32).toString('base64url');
  const saved: LoginState = { organizationId: s.organizationId, userId: s.userId, sessionId,
    fingerprint: fingerprint(row.corpId, c) };
  const result = await bounded(() => redisConnection.set(stateKey(state), JSON.stringify(saved), 'EX', TTL, 'NX'));
  if (result !== 'OK') throw new BadRequestError('扫码入口暂不可用，请稍后重试。');
  url.searchParams.set('state', state);
  return { url: url.toString() };
}

export async function finishLogin(s: Scope, sessionId: string, code: string, state: string) {
  const expired = () => new BadRequestError('扫码已过期或已经使用，请重新发起扫码。');
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(state) || Buffer.byteLength(code, 'utf8') > 512) throw expired();
  const key = stateKey(state);
  const raw = await bounded(() => redisConnection.get(key));
  if (!raw) throw expired();
  let saved: LoginState;
  try { saved = JSON.parse(raw); } catch { throw expired(); }
  if (saved.organizationId !== s.organizationId || saved.userId !== s.userId || saved.sessionId !== sessionId) {
    throw new ForbiddenError('扫码期间账号或工作区已切换，请在当前账号重新扫码。');
  }
  const { row, credentials: c } = await connection(s.organizationId);
  if (!row.notificationVerifiedAt || saved.fingerprint !== fingerprint(row.corpId, c)) throw expired();
  // Consume this session-bound nonce atomically before exchanging the one-use code.
  const consumed = await bounded(() => redisConnection.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    1, key, raw));
  if (consumed !== 1) throw expired();
  const client = wecomClient(s.organizationId, row.corpId, c);
  const info = await client.userInfo(code);
  const wecomUserId = typeof info.userid === 'string' ? info.userid.toLowerCase() : '';
  if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(wecomUserId) || wecomUserId === '@all') {
    throw new BadRequestError('请使用当前企业的内部员工账号扫码。');
  }
  if (!await client.applicationAllows(wecomUserId)) {
    throw new ForbiddenError('此员工不在应用可见范围内，请联系公司管理员授权。');
  }
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "organizationId" FROM "WecomConnection" WHERE "organizationId"=${s.organizationId} FOR UPDATE`;
      const current = await tx.wecomConnection.findUnique({ where: { organizationId: s.organizationId } });
      if (!current?.notificationVerifiedAt || fingerprint(current.corpId,
        JSON.parse(decryptSecretValue(current.credentials))) !== saved.fingerprint) throw expired();
      const member = await tx.member.findFirst({ where: { organizationId: s.organizationId, userId: s.userId,
        enabled: true, user: { banned: false, deletedAt: null } } });
      if (!member) throw new ForbiddenError('当前系统账号已停用或不属于此工作区。');
      const own = await tx.wecomMember.findUnique({ where: { organizationId_userId: {
        organizationId: s.organizationId, userId: s.userId } } });
      if (own) {
        if (own.wecomUserId.toLowerCase() !== wecomUserId) {
          throw new BadRequestError('当前账号已绑定其他企微身份，请联系管理员核对客户归属。');
        }
        return;
      }
      const other = await tx.wecomMember.findFirst({ where: { organizationId: s.organizationId,
        wecomUserId: { equals: wecomUserId, mode: 'insensitive' } } });
      if (other) throw new BadRequestError('此企微员工已绑定其他系统账号，请联系管理员处理。');
      await tx.wecomMember.create({ data: { organizationId: s.organizationId, userId: s.userId, wecomUserId } });
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') throw new BadRequestError('账号绑定已变化，请重新打开企业微信工作台。');
    throw e;
  }
  await recordAuditEvent({ organizationId: s.organizationId, userId: s.userId,
    action: 'wecom.member.selfBound', resourceType: 'wecom' });
  return { wecomUserId };
}
