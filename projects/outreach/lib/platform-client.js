import store from './store.js';
import { syncServiceAccounts } from './configured-accounts.js';

/** @typedef {{mid:string,merchant_name:string,agent_id:number,slug:string,balance:number,expire_at:number,external_user_id:string,session_token?:string}} PlatformIdentity */
/** @typedef {{enabled:boolean,base_url:string,api_key:string,model:string,timeout_seconds:number}} ModelConfig */
/** @typedef {{provider:string,base_url:string,api_key:string}} SearchConfig */
/** @typedef {{model:ModelConfig,search:SearchConfig}} PlatformConfig */

export const agentSlug = process.env.TAIGUA_AGENT_SLUG || 'ztgt';
export const configured = Boolean(process.env.TAIGUA_PLATFORM_URL);

export class PlatformError extends Error {
  /** @param {string} message @param {number} status @param {string} code */
  constructor(message, status = 503, code = 'PLATFORM_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @template T @param {string} path @param {object|undefined} body @returns {Promise<T>} */
export async function platformRequest(path, body) {
  if (!configured || !process.env.INTERNAL_API_KEY) {
    throw new PlatformError('平台连接尚未配置', 503, 'PLATFORM_UNCONFIGURED');
  }
  const base = process.env.TAIGUA_PLATFORM_URL.replace(/\/$/, '');
  let response;
  try {
    response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.INTERNAL_API_KEY,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PlatformError('平台服务暂时无法连接，请稍后重试');
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload.ok !== 'boolean') {
    throw new PlatformError('平台返回格式异常');
  }
  if (!response.ok || !payload.ok) {
    throw new PlatformError(payload.msg || '平台请求失败', response.status, payload.code || 'PLATFORM_ERROR');
  }
  return payload.data;
}

/** @param {string} token @returns {Promise<PlatformIdentity>} */
export function redeem(token) {
  return platformRequest('/api/internal/sso/redeem', { token, agent_slug: agentSlug });
}

/** @param {string} token @returns {Promise<PlatformIdentity>} */
export function validate(token) {
  return platformRequest('/api/internal/sso/validate', { token, agent_slug: agentSlug });
}

/** @type {Map<string,number>} */
const refreshTimes = new Map();

/** @param {string} mid @param {boolean} force */
export async function refreshConfig(mid, force = false) {
  if (!configured) return;
  if (!force && Date.now() - (refreshTimes.get(mid) || 0) < 30000) return;
  /** @type {PlatformConfig} */
  const config = await platformRequest('/api/internal/config?slug=' + encodeURIComponent(agentSlug));
  if (!config || !config.model || !config.search) {
    throw new PlatformError('平台配置格式异常');
  }
  store.saveSettings(mid, {
    llm: {
      enabled: config.model.enabled === true,
      baseUrl: config.model.base_url,
      key: config.model.api_key,
      model: config.model.model,
    },
    lead: {
      searchProvider: config.search.provider,
      apiUrl: config.search.base_url,
      searchKey: config.search.api_key,
    },
    mail: config.mail || {},
    whatsapp: config.whatsapp || {},
    crm: config.crm || {},
  });
  syncServiceAccounts(mid, config);
  refreshTimes.set(mid, Date.now());
}
