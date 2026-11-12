/** @param {unknown} value @returns {string} */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** @param {string} path @param {object|undefined} body @param {string} method */
export async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  const token = sessionStorage.getItem('outreach_token');
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok || result?.ok !== true) {
    const error = new Error(result?.error || result?.msg || '操作未完成，请重试');
    error.status = response.status;
    throw error;
  }
  return result;
}

/** @param {string} message @param {boolean} error */
export function notify(message, error = false) {
  const element = document.querySelector('#message');
  element.textContent = message;
  element.dataset.error = String(error);
}

/** @param {string} title @param {string} fields @param {(data:FormData)=>Promise<void>} save */
export function edit(title, fields, save) {
  const dialog = document.querySelector('#editor');
  const form = document.querySelector('#editor-form');
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#editor-fields').innerHTML = fields;
  document.querySelector('#editor-error').textContent = '';
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await save(new FormData(form));
      dialog.close();
    } catch (error) {
      document.querySelector('#editor-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  dialog.showModal();
}

export const field = (label, name, value = '', type = 'text', required = false) => `<label>${escapeHtml(label)}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''}></label>`;
export const area = (label, name, value = '', required = false) => `<label>${escapeHtml(label)}<textarea name="${name}" ${required ? 'required' : ''}>${escapeHtml(value)}</textarea></label>`;
export const dataOf = (form) => Object.fromEntries(form.entries());
export const button = (label, action, id = '') => `<button type="button" data-action="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
export const table = (headings, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="empty">暂无记录，可使用上方按钮添加。</div>';
