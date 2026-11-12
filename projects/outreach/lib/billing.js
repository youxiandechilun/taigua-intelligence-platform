import crypto from 'node:crypto';
import store from './store.js';
import { configured, platformRequest, agentSlug, PlatformError } from './platform-client.js';

/** @typedef {{id:string,mid:string,requestId:string,fingerprint:string,action:string,holdId:string,status:string,result:unknown,error?:string}} BillingRecord */
/** @type {Map<string,{fingerprint:string,promise:Promise<unknown>}>} */
const running = new Map();
/** @type {Map<string,{fingerprint:string,promise:Promise<BillingRecord>}>} */
const preparing = new Map();

/** @param {string} action @param {object} input */
function fingerprintOf(action, input) {
  return crypto.createHash('sha256').update(JSON.stringify({ action, input })).digest('hex');
}

/**
 * @param {string} action
 * @param {string} requestId
 * @param {object} input
 * @returns {Promise<BillingRecord>}
 */
export async function prepareAction(action, requestId, input) {
  const mid = store.currentMid();
  if (!mid) throw new PlatformError('缺少商户身份', 401, 'AUTH_REQUIRED');
  const id = String(requestId || '').trim();
  if (!id || id.length > 150) throw new PlatformError('缺少有效的操作编号', 400, 'REQUEST_ID_REQUIRED');
  const fingerprint = fingerprintOf(action, input);
  const key = mid + ':' + id;
  const existing = store.get().billableOperations.find((row) => row.requestId === id);
  if (existing && existing.fingerprint !== fingerprint) throw new PlatformError('操作编号已用于其他内容', 409, 'IDEMPOTENCY_CONFLICT');
  if (existing) return existing;
  if (preparing.has(key)) {
    const current = preparing.get(key);
    if (current.fingerprint !== fingerprint) throw new PlatformError('操作编号已用于其他内容', 409, 'IDEMPOTENCY_CONFLICT');
    return current.promise;
  }
  const pending = reserve();
  preparing.set(key, { fingerprint, promise: pending });
  try {
    return await pending;
  } finally {
    preparing.delete(key);
  }

  async function reserve() {
    let holdId = '';
    if (configured) {
      const hold = await platformRequest('/api/internal/points/reserve', {
        mid, agent_slug: agentSlug, action, quantity: 1,
        request_id: agentSlug + ':' + mid + ':' + id,
      });
      holdId = hold.hold_id;
    }
    const record = store.add('billableOperations', mid, {
      requestId: id, fingerprint, action, holdId, status: 'reserved', result: null,
    }, 'op');
    store.saveNow();
    return record;
  }
}

/**
 * @template T
 * @param {string} action
 * @param {string} requestId
 * @param {object} input
 * @param {()=>Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function billable(action, requestId, input, operation) {
  const mid = store.currentMid();
  const key = mid + ':' + requestId;
  const fingerprint = fingerprintOf(action, input);
  if (running.has(key)) {
    const current = running.get(key);
    if (current.fingerprint !== fingerprint) throw new PlatformError('操作编号已用于其他内容', 409, 'IDEMPOTENCY_CONFLICT');
    return current.promise;
  }
  const pending = execute();
  running.set(key, { fingerprint, promise: pending });
  try {
    return await pending;
  } finally {
    running.delete(key);
  }

  async function execute() {
    const record = await prepareAction(action, requestId, input);
    if (record.status === 'completed') return record.result;
    if (record.status === 'settlement_pending') {
      await settle(record);
      return record.result;
    }
    if (record.status !== 'reserved') throw new PlatformError('该操作已有执行记录，请核对结果后处理', 409, 'OPERATION_REVIEW_REQUIRED');
    record.status = 'executing';
    store.saveNow();
    let result;
    try {
      result = await operation();
    } catch (error) {
      // A send failure may follow remote acceptance. Keep the intent for review
      // so a retry cannot send the same message again under the same operation.
      record.status = action.endsWith('_send') ? 'review_required' : 'failed';
      record.error = '执行未完成';
      if (configured && record.holdId && !action.endsWith('_send')) {
        try {
          await platformRequest('/api/internal/points/release', { hold_id: record.holdId, reason: 'operation_failed' });
        } catch {
          record.status = 'release_pending';
        }
      }
      store.saveNow();
      throw error;
    }
    record.result = result;
    record.status = 'settlement_pending';
    store.saveNow();
    try {
      await settle(record);
    } catch {
      // The external result is durable. Reconciliation only retries settlement.
      record.status = 'settlement_pending';
      store.saveNow();
    }
    return result;
  }
}

/** @param {BillingRecord} record */
async function settle(record) {
  if (configured && record.holdId) await platformRequest('/api/internal/points/settle', { hold_id: record.holdId, actual_quantity: 1 });
  record.status = 'completed';
  store.saveNow();
}

/** @param {string} id @param {'sent'|'failed'} outcome @param {string} note */
export async function reviewOperation(id, outcome, note) {
  const record = store.findIn('billableOperations', store.currentMid(), id);
  if (!record) throw new PlatformError('操作记录不存在', 404, 'NOT_FOUND');
  if (!['sent', 'failed'].includes(outcome) || !String(note || '').trim()) {
    throw new PlatformError('请填写核对结果和实际情况', 400, 'REVIEW_REQUIRED');
  }
  if (record.reviewOutcome && record.reviewOutcome !== outcome) throw new PlatformError('核对结果已提交', 409, 'REVIEW_CONFLICT');
  if (!record.reviewOutcome && record.status !== 'review_required') throw new PlatformError('该记录无需人工核对', 409, 'REVIEW_CONFLICT');
  record.reviewOutcome = outcome;
  record.reviewNote = String(note).trim().slice(0, 2000);
  record.reviewedAt = Date.now();
  if (outcome === 'sent') {
    record.result = { reviewed: true, outcome: 'sent' };
    record.status = 'settlement_pending';
    store.saveNow();
    await settle(record);
  } else {
    record.status = 'release_pending';
    store.saveNow();
    if (configured && record.holdId) await platformRequest('/api/internal/points/release', { hold_id: record.holdId, reason: 'review_confirmed_failed' });
    record.status = 'failed';
    store.saveNow();
  }
  return { id: record.id, status: record.status, outcome: record.reviewOutcome };
}

/** Interrupted provider operations need an explicit outcome before reuse. */
export function recoverBilling() {
  for (const record of store.getRoot().billableOperations) {
    if (record.status === 'executing') {
      record.status = record.action.endsWith('_send') ? 'review_required' : 'release_pending';
      record.error = '服务重启，执行结果需要核对';
    } else if (record.status === 'reserved') {
      record.status = 'release_pending';
    }
  }
  store.saveNow();
}

export async function reconcileBilling() {
  for (const tenant of store.listTenants()) {
    await store.runTenant(tenant.mid, async () => {
      for (const record of store.get().billableOperations) {
        try {
          if (record.status === 'settlement_pending') await settle(record);
          if (record.status === 'release_pending') {
            if (configured && record.holdId) await platformRequest('/api/internal/points/release', { hold_id: record.holdId, reason: 'operation_failed' });
            record.status = 'failed';
            store.saveNow();
          }
        } catch {
          // A later maintenance pass retries the durable financial operation.
        }
      }
    });
  }
}
