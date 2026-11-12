import { element, message, node, products, record, request, status } from './platform-http.js';
import { sections } from './platform-config-fields.js';

const selector = element('product');
if (!(selector instanceof HTMLSelectElement)) throw new Error('配置范围选择器缺失');
for (const [value, label] of products) {
  const option = node('option', label);
  option.value = value;
  selector.append(option);
}
let revision = 0;
/** @param {string} sectionName @param {Record<string, unknown>} values */
function form(sectionName, values) {
  const definition = sections[sectionName];
  const details = node('details');
  details.className = 'integration-card';
  details.open = sectionName === 'model';
  details.append(node('summary', definition.title));
  const form = node('form');
  const grid = node('div');
  grid.className = 'integration-grid';
  for (const field of definition.fields) {
    const label = node('label');
    label.append(node('span', field.label));
    const input = node('input');
    input.name = field.key;
    input.id = `${sectionName}-${field.key}`;
    input.type = field.type === 'secret' ? 'password' : (field.type || 'text');
    input.autocomplete = field.type === 'secret' ? 'new-password' : 'off';
    const value = values[field.key];
    if (field.type === 'checkbox') input.checked = value === true;
    else if (field.type === 'secret') input.placeholder = values[`${field.key}_set`] ? '已配置；留空保持原值' : '尚未配置';
    else input.value = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    if (field.type === 'number') { input.min = '1'; input.max = String(field.max || 120); input.step = '1'; }
    label.append(input);
    if (field.type === 'secret') {
      const clearLabel = node('label', '清除已保存密钥');
      clearLabel.className = 'clear-secret';
      const clear = node('input');
      clear.type = 'checkbox';
      clear.name = `clear_${field.key}`;
      clearLabel.prepend(clear);
      label.append(clearLabel);
    }
    grid.append(label);
  }
  form.append(grid);
  const save = node('button', `保存${definition.title}`);
  save.type = 'submit'; save.className = 'btn btn-primary';
  const feedback = node('span'); feedback.role = 'status'; feedback.className = 'save-feedback';
  form.append(save, feedback);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; feedback.textContent = '正在保存…';
    const selectedProduct = selector.value;
    /** @type {Record<string, string | number | boolean>} */
    const values = {};
    for (const field of form.querySelectorAll('input')) {
      values[field.name] = field.type === 'checkbox' ? field.checked : (field.type === 'number' ? Number(field.value) : field.value);
    }
    try {
      await request('/api/admin/integrations', 'PUT', { slug: selectedProduct, config: { [sectionName]: values } });
      if (selector.value === selectedProduct) {
        feedback.textContent = '保存成功';
        for (const field of form.querySelectorAll('input[type="password"]')) {
          if (field instanceof HTMLInputElement) { field.value = ''; field.placeholder = '已保存；留空保持原值'; }
        }
        for (const field of form.querySelectorAll('input[name^="clear_"]')) {
          if (field instanceof HTMLInputElement) field.checked = false;
        }
      }
    } catch (error) { feedback.textContent = message(error); }
    finally { save.disabled = false; }
  });
  details.append(form);
  return details;
}

async function load() {
  const current = ++revision;
  status('正在读取配置…');
  element('configuration').replaceChildren();
  try {
    const result = await request(`/api/admin/integrations?slug=${encodeURIComponent(selector.value)}`);
    if (current !== revision) return;
    if (!record(result)) throw new Error('配置响应格式错误');
    for (const section of Object.keys(sections)) {
      const values = result[section];
      if (!record(values)) throw new Error('服务配置不完整，请重试');
      element('configuration').append(form(section, values));
    }
    status(selector.value === 'global' ? '各产品默认使用本页配置。' : '当前显示生效配置；保存后作为本产品的配置。');
  } catch (error) { if (current === revision) status(message(error), true); }
}
selector.addEventListener('change', load);
element('reload').addEventListener('click', load);
if (await window.admInit('admin-integrations.html')) await load();
