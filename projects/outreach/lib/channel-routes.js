import crypto from 'node:crypto';
import store from './store.js';
import replies from './replies.js';
import { sendError } from './auth-routes.js';
import { PlatformError } from './platform-client.js';

/** @param {string} supplied @param {string} expected */
function sameSecret(supplied, expected) {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** @param {import('express').Express} app */
export function installChannelRoutes(app) {
  app.get('/webhooks/whatsapp/:mid', (req, res) => {
    const config = store.settingsFor(req.params.mid).whatsapp || {};
    if (!config.verify_token || !sameSecret(String(req.query['hub.verify_token'] || ''), config.verify_token)) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  });
  app.post('/webhooks/whatsapp/:mid', (req, res) => {
    try {
      const mid = req.params.mid;
      const config = store.settingsFor(mid).whatsapp || {};
      let verified = false;
      if (config.provider === 'meta' && config.app_secret) {
        const signature = 'sha256=' + crypto.createHmac('sha256', config.app_secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
        verified = sameSecret(req.get('X-Hub-Signature-256') || '', signature);
      } else if (config.provider === 'http' && config.verify_token) {
        verified = sameSecret(req.get('X-Webhook-Token') || '', config.verify_token);
      }
      if (!verified) throw new PlatformError('回调校验失败', 403, 'WEBHOOK_DENIED');
      const account = store.list('waAccounts', mid).find((row) => row.source === 'platform');
      if (!account) throw new PlatformError('平台WhatsApp账号未配置', 404, 'NOT_FOUND');
      const messages = config.provider === 'meta'
        ? (req.body.entry || []).flatMap((entry) => (entry.changes || []).flatMap((change) => {
          if (String(change.value?.metadata?.phone_number_id || '') !== config.phone_number_id) return [];
          return change.value?.messages || [];
        }))
        : [req.body];
      let added = 0;
      store.runTenant(mid, () => {
        for (const message of messages) {
          const content = typeof message.text === 'string' ? message.text : message.text?.body;
          if (!message.id || !message.from || !content) continue;
          const reply = replies.handleIncoming({ channel: 'wa', accountId: account.id, from: String(message.from), externalId: String(message.id), text: String(content).slice(0, 4000), ts: Date.now() });
          if (reply) added += 1;
        }
        store.saveNow();
      });
      res.json({ ok: true, added });
    } catch (error) { sendError(res, error); }
  });
}
