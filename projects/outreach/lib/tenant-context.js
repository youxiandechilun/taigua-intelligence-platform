import { AsyncLocalStorage } from 'node:async_hooks';

/** @typedef {{mid:string}} TenantContext */
/** @type {AsyncLocalStorage<TenantContext>} */
const context = new AsyncLocalStorage();

/** @returns {string|null} */
export function currentMid() {
  return context.getStore()?.mid ?? null;
}

/** @template T @param {string} mid @param {()=>T} operation @returns {T} */
export function runTenant(mid, operation) {
  const normalized = String(mid).trim();
  if (!normalized) throw new Error('缺少商户身份');
  return context.run({ mid: normalized }, operation);
}
