import store from './store.js';
import { PlatformError } from './platform-client.js';

/** @param {string} customerId @param {string} owner @param {string} requestId */
export async function pushCustomer(customerId, owner, requestId) {
  const mid = store.currentMid();
  const customer = store.findIn('customers', mid, customerId);
  if (!customer) throw new PlatformError('客户不存在', 404, 'NOT_FOUND');
  const assigned = String(owner || '').trim().slice(0, 200);
  if (!assigned) throw new PlatformError('请填写接收负责人', 400, 'OWNER_REQUIRED');
  const key = String(requestId || '').trim();
  if (!key || key.length > 150) throw new PlatformError('缺少有效的操作编号', 400, 'REQUEST_ID_REQUIRED');
  let record = store.get().leadPushes.find((row) => row.requestId === key);
  if (record && (record.customerId !== customerId || record.owner !== assigned)) throw new PlatformError('操作编号已用于其他内容', 409, 'IDEMPOTENCY_CONFLICT');
  if (record && ['已送达', '推送中'].includes(record.status)) return record;
  const config = store.get().settings.crm || {};
  customer.owner = assigned;
  if (!record) record = store.add('leadPushes', mid, { requestId: key, leadId: customer.leadId || '', customerId, owner: assigned }, 'lp');
  Object.assign(record, { channel: config.base_url ? 'crm' : 'in_app', status: config.base_url ? '推送中' : '已送达' });
  store.saveNow();
  if (!config.base_url) return record;
  try {
    const response = await fetch(config.base_url.replace(/\/$/, '') + '/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (config.api_key || ''), 'Idempotency-Key': mid + ':' + key },
      body: JSON.stringify({ external_id: mid + ':' + customer.id, merchant_id: mid, company: customer.co, name: customer.name, contact: customer.contact, channel: customer.channel, requirement: customer.note, owner: assigned }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('CRM未确认接收，请稍后重试或检查目标系统记录');
    record.status = '已送达';
    record.deliveredAt = Date.now();
  } catch {
    record.status = '推送待重试';
  }
  store.saveNow();
  return record;
}
