import store from './store.js';
import { sendError } from './auth-routes.js';
import * as domestic from './domestic-service.js';

/** @param {import('express').Express} app */
export function installDomesticRoutes(app) {
  /** @param {(req:import('express').Request,res:import('express').Response)=>unknown} handler */
  const route = (handler) => (req, res) => Promise.resolve().then(() => handler(req, res)).catch((error) => sendError(res, error));

  app.get('/api/domestic/overview', route((req, res) => {
    const data = store.get();
    res.json({ ok: true, data: {
      candidates: data.leads.filter((row) => row.status !== 'qualified').length,
      qualified: data.leads.filter((row) => row.status === 'qualified').length,
      pending: data.contactTasks.filter((row) => ['待审核', '待联系', '已申请'].includes(row.status)).length,
      customers: data.customers.length,
      due: data.customers.filter((row) => row.nextFollow && row.nextFollow <= Date.now()).length,
      wechatAccounts: data.wechatAccounts.length,
    } });
  }));
  app.get('/api/domestic/leads', route((req, res) => {
    const query = domestic.text(req.query.q).toLowerCase();
    let rows = store.get().leads;
    if (query) rows = rows.filter((row) => [row.co, row.person, row.phone, row.wechat, row.tag].join(' ').toLowerCase().includes(query));
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    res.json({ ok: true, data: { list: rows.slice().reverse().slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize } });
  }));
  app.post('/api/domestic/leads', route((req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
    res.json({ ok: true, added: domestic.importLeads(rows) });
  }));
  app.post('/api/domestic/search', route(async (req, res) => {
    const result = await domestic.search(domestic.text(req.body.keyword), domestic.text(req.body.region), domestic.text(req.body.mode), req.get('Idempotency-Key'));
    res.json({ ok: true, data: result });
  }));
  app.post('/api/domestic/draft', route(async (req, res) => {
    const result = await domestic.draft(domestic.text(req.body.leadId), req.get('Idempotency-Key'));
    res.json({ ok: true, data: result });
  }));
  app.get('/api/wechat/accounts', route((req, res) => res.json({ ok: true, data: store.get().wechatAccounts })));
  app.post('/api/wechat/accounts', route((req, res) => res.json({ ok: true, data: domestic.createWechat(req.body) })));
  app.put('/api/wechat/accounts/:id', route((req, res) => {
    const account = domestic.owned('wechatAccounts', req.params.id);
    for (const key of ['label', 'owner', 'note']) {
      if (req.body[key] !== undefined) account[key] = domestic.text(req.body[key], key === 'note' ? 1000 : 200);
    }
    if (req.body.status !== undefined) {
      if (!['active', 'paused'].includes(req.body.status)) throw new Error('账号状态无效');
      account.status = req.body.status;
    }
    store.saveNow();
    res.json({ ok: true, data: account });
  }));
  app.delete('/api/wechat/accounts/:id', route((req, res) => {
    domestic.owned('wechatAccounts', req.params.id);
    if (store.get().contactTasks.some((row) => row.accountId === req.params.id)) throw new Error('账号已有联系记录，请使用暂停操作');
    store.remove('wechatAccounts', store.currentMid(), req.params.id);
    store.saveNow();
    res.json({ ok: true });
  }));
  app.get('/api/contact-tasks', route((req, res) => res.json({ ok: true, data: store.get().contactTasks.slice().reverse() })));
  app.post('/api/contact-tasks', route((req, res) => res.json({ ok: true, data: domestic.createContact(req.body) })));
  app.patch('/api/contact-tasks/:id', route((req, res) => res.json({ ok: true, data: domestic.updateContact(req.params.id, domestic.text(req.body.status), domestic.text(req.body.note, 2000)) })));
  app.post('/api/domestic/leads/:id/qualify', route((req, res) => res.json({ ok: true, data: domestic.qualify(req.params.id, req.body) })));
  app.post('/api/domestic/leads/:id/push', route(async (req, res) => res.json({ ok: true, data: await domestic.pushLead(req.params.id, req.body.owner, req.get('Idempotency-Key')) })));
  app.get('/api/domestic/pushes', route((req, res) => res.json({ ok: true, data: store.get().leadPushes.slice().reverse() })));
  app.post('/api/domestic/customers/:id/followups', route((req, res) => res.json({ ok: true, data: domestic.followUp(req.params.id, req.body) })));
}
