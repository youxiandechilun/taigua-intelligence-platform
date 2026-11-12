/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} path @param {string} [method] @param {object} [body] @returns {Promise<unknown>} */
export async function request(path, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method, signal: controller.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token') || ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    /** @type {unknown} */
    const result = await response.json();
    if (!record(result) || result.code !== 0) {
      if (response.status === 401) {
        localStorage.removeItem('tk_token');
        location.assign(document.body.dataset.admin === 'true' ? '/ht' : '/qt');
      }
      throw new Error(record(result) && typeof result.msg === 'string' ? result.msg : '服务响应异常');
    }
    return result.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('请求超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** @param {unknown} error @returns {string} */
export function message(error) { return error instanceof Error ? error.message : '操作失败，请重试'; }

/** @param {string} id @returns {HTMLElement} */
export function element(id) {
  const result = document.getElementById(id);
  if (!result) throw new Error(`页面组件缺失：${id}`);
  return result;
}

/** @param {string} text @param {boolean} [failed] */
export function status(text, failed = false) {
  const target = element('status');
  target.textContent = text;
  target.classList.toggle('failed', failed);
}

/** @template {keyof HTMLElementTagNameMap} T @param {T} tag @param {string} [text] */
export function node(tag, text = '') {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}

export const products = [
  ['global', '平台默认配置'], ['ztgh', '国内电销'], ['ztwh', '海外电销'],
  ['ztgj', '国内社媒'], ['ztwj', '海外社媒'], ['ztgt', '国内拓客'],
  ['ztwt', '海外拓客'], ['site', '独立站'],
];

export const actions = new Map([
  ['lead_search', '查找线索'], ['ai_generate', 'AI 内容生成'], ['mail_send', '发送邮件'],
  ['wa_send', 'WhatsApp 发送'], ['social_publish', '社媒发布'], ['call_minute', '通话分钟'], ['site_generate', '网站生成'],
]);
