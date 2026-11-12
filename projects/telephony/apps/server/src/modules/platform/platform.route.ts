import { Router } from 'express';
import { auth } from '../../lib/auth.js';
import prisma from '../../config/prisma.js';
import { serverBaseUrl } from '../../config/origins.js';
import { PlatformApiError, platformEnabled, redeemPlatformTicket } from './platform-client.js';
import { encryptPlatformToken, ensurePlatformMerchant, localTokenHash } from './platform-identity.js';

const router = Router();

function cookieToken(header: string | undefined): string {
  const item = header?.split(';').map(part => part.trim()).find(part => part.startsWith('tk_token='));
  if (!item) return '';
  try { return decodeURIComponent(item.slice('tk_token='.length)); } catch { return ''; }
}

router.all('/sso', async (req, res, next) => {
  try {
    if (!platformEnabled()) throw new PlatformApiError('平台连接尚未配置。');
    const supplied = req.method === 'POST' ? req.body?.token : req.query.ticket;
    const token = typeof supplied === 'string' ? supplied : cookieToken(req.headers.cookie);
    if (!token || token.length > 4096) throw new PlatformApiError('请从平台主页进入。', 401, 'TICKET_INVALID');
    const identity = await redeemPlatformTicket(token);
    const account = await ensurePlatformMerchant(identity);
    const response = await auth.api.signInEmail({
      body: { email: account.email, password: account.password },
      headers: new Headers({ origin: new URL(serverBaseUrl).origin }),
      asResponse: true,
    });
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== 'object' || !('token' in result) || typeof result.token !== 'string') {
      throw new PlatformApiError('电销工作台会话未建立，请重新进入。');
    }
    const tokenHash = localTokenHash(result.token);
    await prisma.session.updateMany({ where: { token: result.token, userId: account.userId }, data: { activeOrganizationId: account.organizationId } });
    await prisma.taiguaSession.upsert({
      where: { sessionTokenHash: tokenHash },
      create: { sessionTokenHash: tokenHash, organizationId: account.organizationId, platformToken: encryptPlatformToken(identity.session_token), expiresAt: new Date(identity.expire_at * 1000) },
      update: { platformToken: encryptPlatformToken(identity.session_token), expiresAt: new Date(identity.expire_at * 1000) },
    });
    for (const cookie of response.headers.getSetCookie()) res.append('Set-Cookie', cookie);
    res.setHeader('Cache-Control', 'no-store');
    const consoleUrl = process.env.CONSOLE_URL || 'http://localhost:3000';
    res.redirect(303, new URL('/dashboard', consoleUrl).href);
  } catch (error) { next(error); }
});

export default router;
