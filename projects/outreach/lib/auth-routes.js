import store from './store.js';
import { configured, redeem, refreshConfig, agentSlug, PlatformError } from './platform-client.js';

export const sessionCookie = 'outreach_session';

/** @param {import('express').Request} req @returns {string} */
export function requestToken(req) {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7);
  const cookies = String(req.headers.cookie || '').split(';').map((item) => item.trim());
  const cookie = cookies.find((item) => item.startsWith(sessionCookie + '='));
  if (!cookie) return String(req.query.t || '');
  try {
    return decodeURIComponent(cookie.slice(sessionCookie.length + 1));
  } catch {
    return '';
  }
}

/** @param {import('express').Response} res @param {Error} error */
export function sendError(res, error) {
  const status = error instanceof PlatformError ? error.status : 400;
  res.status(status).json({ ok: false, code: error.code || 'INVALID_REQUEST', error: error.message, msg: error.message });
}

/** @param {import('express').Express} app */
export function installAuthRoutes(app) {
  app.get('/api/auth/status', (req, res) => {
    const session = store.resolveSession(requestToken(req));
    res.json({ ok: true, configured: configured || store.authConfigured(), authed: Boolean(session), platform: configured, platformUrl: process.env.TAIGUA_PLATFORM_URL || '' });
  });
  app.get('/api/admin/status', (req, res) => {
    const session = store.resolveSession(requestToken(req));
    res.json({ ok: true, configured: store.adminConfigured(), authed: session?.role === 'admin' });
  });
  app.post('/api/auth/login', (req, res) => {
    if (configured) return res.status(403).json({ ok: false, error: '请从平台主页进入' });
    if (!store.authConfigured()) return res.status(503).json({ ok: false, error: '请配置本机访问口令' });
    if (!store.verifyPassword(String(req.body.password || ''))) return res.status(401).json({ ok: false, error: '口令不正确' });
    const session = store.createSession(store.DEFAULT_MID);
    res.json({ ok: true, token: session.sid });
  });
  app.post('/api/admin/login', (req, res) => {
    if (!store.adminConfigured()) return res.status(503).json({ ok: false, error: '请配置管理员口令' });
    if (!store.verifyAdmin(String(req.body.password || ''))) return res.status(401).json({ ok: false, error: '管理员口令不正确' });
    const session = store.createSession(store.DEFAULT_MID, { role: 'admin' });
    res.json({ ok: true, token: session.sid });
  });

  const sso = async (req, res) => {
    try {
      const cookie = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('tk_token='));
      const token = String(req.body?.token || req.query.ticket || req.query.token || (cookie ? decodeURIComponent(cookie.slice(9)) : ''));
      if (!token) throw new PlatformError('缺少平台登录凭证', 401, 'TICKET_INVALID');
      const identity = await redeem(token);
      if (!identity || !identity.mid || !identity.session_token) throw new PlatformError('平台身份格式异常');
      store.ensureTenant({ mid: identity.mid, name: identity.merchant_name, agentId: identity.agent_id, slug: identity.slug });
      await refreshConfig(String(identity.mid), true);
      const local = store.createSession(String(identity.mid), {
        platformToken: identity.session_token,
        ttlMs: Math.max(1000, identity.expire_at * 1000 - Date.now()),
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      res.cookie(sessionCookie, local.sid, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'lax',
        maxAge: local.session.expireAt - Date.now(),
        path: '/',
      });
      if (req.method === 'GET') return res.redirect(agentSlug === 'ztgt' ? '/domestic' : '/console');
      res.json({ ok: true, token: local.sid, merchant: { mid: identity.mid, name: identity.merchant_name } });
    } catch (error) {
      sendError(res, error);
    }
  };
  app.get('/auth/sso', sso);
  app.get('/api/auth/sso', sso);
  app.post('/api/auth/sso', sso);
  app.post('/api/auth/logout', (req, res) => {
    store.revokeSession(requestToken(req));
    res.clearCookie(sessionCookie, { path: '/' });
    res.json({ ok: true });
  });
}
