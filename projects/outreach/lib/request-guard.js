import store from './store.js';
import { configured, validate, refreshConfig, PlatformError } from './platform-client.js';
import { requestToken, sendError } from './auth-routes.js';

/** @param {import('express').Express} app */
export function installRequestGuard(app) {
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    try {
      const session = store.resolveSession(requestToken(req));
      if (!session) throw new PlatformError('未登录或登录已过期，请从平台主页进入', 401, 'AUTH_REQUIRED');
      const origin = req.headers.origin;
      if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const allowed = new Set([req.get('host')]);
        if (process.env.TAIGUA_PLATFORM_URL) allowed.add(new URL(process.env.TAIGUA_PLATFORM_URL).host);
        if (!allowed.has(new URL(origin).host)) throw new PlatformError('请求来源不受支持', 403, 'ORIGIN_DENIED');
      }
      if (configured && session.platformToken) {
        const identity = await validate(session.platformToken);
        if (String(identity.mid) !== session.mid) throw new PlatformError('登录身份不匹配', 401, 'IDENTITY_INVALID');
        await refreshConfig(session.mid);
      }
      const suppliedMid = req.body?.mid ?? req.query.mid;
      if (suppliedMid !== undefined && String(suppliedMid) !== session.mid) {
        throw new PlatformError('无权访问其他商户数据', 403, 'TENANT_DENIED');
      }
      const administrator = session.role === 'admin';
      if ((req.path.startsWith('/api/admin/') || req.path.startsWith('/api/settings')) && !administrator) {
        throw new PlatformError('需要管理员权限', 403, 'ADMIN_REQUIRED');
      }
      if (configured && req.path === '/api/settings' && req.method !== 'GET') {
        throw new PlatformError('请在平台主页后台修改服务配置', 403, 'CENTRAL_CONFIG');
      }
      res.locals.mid = session.mid;
      res.locals.session = session;
      store.runTenant(session.mid, () => next());
    } catch (error) {
      sendError(res, error);
    }
  });
}
