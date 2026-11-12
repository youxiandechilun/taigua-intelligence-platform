import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma.js';
import { PlatformApiError, platformAgentSlug, type PlatformIdentity, validatePlatformSession } from './platform-client.js';

export const localTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function encryptionKey(): Buffer {
  const key = process.env.INTERNAL_API_KEY?.trim();
  if (!key) throw new PlatformApiError('平台连接尚未配置。');
  return createHash('sha256').update('taigua-session:' + key).digest();
}

export function encryptPlatformToken(token: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptPlatformToken(value: string): string {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < 29) throw new PlatformApiError('平台会话已失效，请重新进入。', 401, 'SESSION_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

function stableId(name: string): string {
  const bytes = createHash('sha256').update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function ensurePlatformMerchant(identity: PlatformIdentity) {
  if (identity.slug !== platformAgentSlug() || identity.expire_at * 1000 <= Date.now()) {
    throw new PlatformApiError('平台身份已失效，请从主页重新进入。', 401, 'SESSION_INVALID');
  }
  const userId = stableId('taigua:user:' + identity.mid);
  const organizationId = stableId(`taigua:organization:${identity.slug}:${identity.mid}`);
  const email = `tk-${identity.mid}@taikua.local`;
  const password = createHmac('sha256', encryptionKey()).update('sso:' + identity.mid).digest('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction(async database => {
    await database.user.upsert({
      where: { id: userId },
      create: { id: userId, name: identity.merchant_name, email, emailVerified: true, role: 'user' },
      update: { name: identity.merchant_name },
    });
    await database.organization.upsert({
      where: { id: organizationId },
      create: { id: organizationId, name: identity.merchant_name, slug: `tk-${identity.slug}-${identity.mid}`, createdAt: new Date() },
      update: { name: identity.merchant_name },
    });
    await database.member.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { id: stableId(`taigua:member:${organizationId}:${userId}`), organizationId, userId, role: 'owner', createdAt: new Date() },
      update: {},
    });
    await database.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: userId } },
      create: { id: stableId('taigua:credential:' + userId), providerId: 'credential', accountId: userId, userId, password: passwordHash },
      update: { password: passwordHash },
    });
    await database.billingAccount.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
    await database.taiguaMerchant.upsert({
      where: { organizationId },
      create: { organizationId, merchantId: identity.mid, agentSlug: identity.slug, userId },
      update: {},
    });
  });
  return { userId, organizationId, email, password };
}

export async function requirePlatformSession(localToken: string, organizationId: string, userId: string) {
  const merchant = await prisma.taiguaMerchant.findUnique({ where: { organizationId } });
  if (!merchant) return;
  if (merchant.userId !== userId) {
    throw new PlatformApiError('该账号未关联平台商户，请从主页进入。', 403, 'MERCHANT_MISMATCH');
  }
  const linked = await prisma.taiguaSession.findUnique({ where: { sessionTokenHash: localTokenHash(localToken) } });
  if (!linked || linked.organizationId !== organizationId || linked.expiresAt.getTime() <= Date.now()) {
    throw new PlatformApiError('平台会话已失效，请从主页重新进入。', 401, 'SESSION_INVALID');
  }
  let identity: PlatformIdentity;
  try {
    identity = await validatePlatformSession(decryptPlatformToken(linked.platformToken));
  } catch (error) {
    if (error instanceof PlatformApiError && [401, 403].includes(error.statusCode)) {
      await prisma.taiguaSession.deleteMany({ where: { sessionTokenHash: linked.sessionTokenHash } });
      await prisma.session.deleteMany({ where: { token: localToken } });
    }
    throw error;
  }
  if (identity.mid !== merchant.merchantId || identity.slug !== merchant.agentSlug) {
    throw new PlatformApiError('平台商户身份不匹配。', 403, 'MERCHANT_MISMATCH');
  }
}
