import { request, notify, edit, field, area, dataOf, button, table, escapeHtml as esc } from './domestic-api.js';
import { handleAction } from './domestic-actions.js';

const pages = { dashboard: '数据看板', leads: '找线索与留资', accounts: '微信账号', tasks: '联系与开发信任务', customers: '客户管理', knowledge: '公司与产品知识库' };
let page = location.hash.slice(1) || 'dashboard';
let generation = 0;
const workspace = document.querySelector('#workspace');

const cell = (value, wrap = false) => `<td${wrap ? ' class="wrap"' : ''}>${esc(value || '—')}</td>`;
const row = (cells) => `<tr>${cells.join('')}</tr>`;
const date = (timestamp) => timestamp ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(timestamp) : '—';

async function render() {
  if (!pages[page]) page = 'dashboard';
  const version = ++generation;
  workspace.setAttribute('aria-busy', 'true');
  document.querySelector('#navigation').innerHTML = Object.entries(pages).map(([key, label]) => `<button type="button" data-page="${key}" ${key === page ? 'aria-current="page"' : ''}>${label}</button>`).join('');
  try {
    const body = await views[page]();
    if (version !== generation) return;
    workspace.innerHTML = `<h1>${pages[page]}</h1>${body}`;
    workspace.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (version !== generation) return;
    workspace.innerHTML = `<h1>${pages[page]}</h1><div class="panel"><p>${esc(error.message)}</p><div class="toolbar">${button('重新加载', 'reload')}${error.status === 401 ? button('本机口令登录', 'login') + '<a id="login-platform" href="/">前往平台登录</a>' : ''}</div></div>`;
    workspace.setAttribute('aria-busy', 'false');
    if (error.status === 401) {
      const status = await request('/api/auth/status').catch(() => null);
      const url = status?.platformUrl;
      if (url) document.querySelector('#login-platform').href = url;
    }
  }
}

const views = {
  async dashboard() {
    const data = (await request('/api/domestic/overview')).data;
    const metrics = [['候选线索', data.candidates], ['有效留资', data.qualified], ['待处理联系', data.pending], ['客户档案', data.customers]];
    return `<div class="metrics">${metrics.map(([label, count]) => `<div class="metric"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div><div class="panel"><h2>今天的联系安排</h2><p>已有 ${data.wechatAccounts} 个微信账号，${data.due} 位客户到达跟进时间。</p><div class="toolbar">${button('添加候选线索', 'add-lead')}${button('登记微信账号', 'add-account')}</div></div><div class="panel"><h2>业务流程</h2><p class="hint">整理公司和产品资料 → 查找候选企业 → 准备并审核联系话术 → 在微信中确认联系 → 登记真实需求 → 分配客户并持续跟进</p></div>`;
  },
  async leads() {
    const response = await request('/api/domestic/leads?pageSize=100');
    const items = response.data.list;
    return `<div class="toolbar">${button('添加线索', 'add-lead')}${button('导入名单', 'import-leads')}${button('查找线索', 'search')}<span class="hint">共 ${response.data.total} 条，当前显示最近100条</span></div>` + table(['企业与联系人', '地区', '联系方式', '来源', '状态', '操作'], items.map((item) => row([
      cell(item.co + (item.person ? ' · ' + item.person : ''), true), cell(item.region), cell(item.wechat || item.phone || item.email), cell(item.source, true), cell(item.status === 'qualified' ? '有效留资' : '候选线索'),
      `<td>${button('准备联系', 'contact', item.id)}${item.status === 'qualified' ? button('分配留资', 'push', item.id) : button('确认需求', 'qualify', item.id)}</td>`,
    ])));
  },
  async accounts() {
    const accounts = (await request('/api/wechat/accounts')).data;
    return `<div class="toolbar">${button('登记微信账号', 'add-account')}</div><p class="hint">个人微信通过人工联系任务使用。负责人在微信中确认添加或发送，再登记结果。</p>` + table(['账号名称', '微信号', '负责人', '状态', '备注'], accounts.map((account) => row([cell(account.label), cell(account.wechatId), cell(account.owner), cell(account.status === 'active' ? '使用中' : '已暂停'), cell(account.note, true)])));
  },
  async tasks() {
    const tasks = (await request('/api/contact-tasks')).data;
    return table(['目标企业', '联系账号', '负责人', '状态', '更新时间', '操作'], tasks.map((task) => row([cell(task.company), cell(task.contact), cell(task.owner), cell(task.status), cell(date(task.updatedAt || task.createdAt)), `<td>${button('查看并登记结果', 'task-status', task.id)}</td>`])));
  },
  async customers() {
    const [result, pushes] = await Promise.all([request('/api/customers'), request('/api/domestic/pushes')]);
    return table(['客户', '联系方式', '负责人', '阶段', '下次跟进', '操作'], result.customers.map((customer) => row([cell(customer.co || customer.name), cell(customer.contact), cell(customer.owner), cell(customer.stage), cell(date(customer.nextFollow)), `<td>${button('记录跟进', 'follow', customer.id)}</td>`]))) + `<div class="panel" style="margin-top:24px"><h2>留资分配记录</h2>${pushes.data.slice(0, 10).map((record) => `<div class="activity">${esc(record.owner)} · ${esc(record.status)} · ${date(record.createdAt)}</div>`).join('') || '<p class="hint">暂无分配记录</p>'}</div>`;
  },
  async knowledge() {
    const kb = (await request('/api/kb')).kb;
    return `<div class="panel knowledge-form"><h2>公司资料</h2><form id="company-form">${field('公司名称', 'name', kb.company.name, 'text', true)}${field('主营产品', 'products', kb.company.products)}${field('公司网站', 'website', kb.company.website, 'url')}${area('公司介绍', 'intro', kb.company.intro)}<button class="primary" type="submit">保存公司资料</button></form></div><div class="toolbar">${button('添加产品资料', 'add-product')}</div>` + table(['产品', '规格型号', '产品介绍'], kb.products.map((product) => row([cell(product.name), cell(product.model), cell(product.desc, true)])));
  },
};

document.querySelector('#navigation').addEventListener('click', (event) => {
  const target = event.target.closest('[data-page]');
  if (target) location.hash = target.dataset.page;
});
window.addEventListener('hashchange', () => { page = location.hash.slice(1); render(); });
workspace.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  target.disabled = true;
  try {
    if (target.dataset.action === 'reload') return await render();
    if (target.dataset.action === 'login') {
      edit('本机口令登录', field('访问口令', 'password', '', 'password', true), async (form) => {
        const result = await request('/api/auth/login', dataOf(form));
        sessionStorage.setItem('outreach_token', result.token);
        await render();
      });
      return;
    }
    await handleAction(target.dataset.action, target.dataset.id, render);
  } catch (error) {
    notify(error.message, true);
  } finally {
    target.disabled = false;
  }
});
workspace.addEventListener('submit', async (event) => {
  if (event.target.id !== 'company-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await request('/api/kb/company', dataOf(new FormData(event.target)), 'PUT');
    notify('公司资料已保存');
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
for (const id of ['close-editor', 'cancel-editor']) document.getElementById(id).addEventListener('click', () => document.querySelector('#editor').close());
document.querySelector('#logout').addEventListener('click', async () => {
  await request('/api/auth/logout', {});
  sessionStorage.removeItem('outreach_token');
  await render();
});
request('/api/auth/status').then((result) => {
  if (result.platformUrl) document.querySelector('#platform-link').href = result.platformUrl;
}).catch(() => {});
render();
