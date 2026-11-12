import store from './store.js';
import llm from './llm.js';
import leads from './leads.js';
import { billable } from './billing.js';
import { PlatformError } from './platform-client.js';
import { pushCustomer } from './crm-service.js';

/** @typedef {{co:string,person?:string,region?:string,phone?:string,email?:string,wechat?:string,website?:string,source?:string,tag?:string}} LeadInput */
/** @typedef {{label:string,wechatId:string,owner:string,note?:string}} WechatInput */
/** @typedef {{leadId:string,accountId:string,text?:string,owner?:string}} ContactInput */

/** @param {unknown} value @param {number} max @returns {string} */
export function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

/** @param {string} collection @param {string} id */
export function owned(collection, id) {
  const row = store.findIn(collection, store.currentMid(), id);
  if (!row) throw new PlatformError('记录不存在或无权访问', 404, 'NOT_FOUND');
  return row;
}

/** @param {LeadInput[]} rows */
export function importLeads(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('每次最多导入1000条线索');
  const existing = [...store.get().leads];
  let added = 0;
  for (const input of rows) {
    const co = text(input.co);
    if (!co) continue;
    const key = text(input.email || input.phone || input.wechat || co).toLowerCase();
    if (existing.some((row) => text(row.email || row.phone || row.wechat || row.co).toLowerCase() === key)) continue;
    const row = store.add('leads', store.currentMid(), {
      co, person: text(input.person), country: '中国', region: text(input.region),
      phone: text(input.phone), email: text(input.email), wechat: text(input.wechat),
      website: text(input.website, 2000), source: text(input.source || '人工导入', 2000),
      tag: text(input.tag), status: 'candidate', qualification: '',
    }, 'l');
    existing.push(row);
    added += 1;
  }
  store.saveNow();
  return added;
}

/** @param {WechatInput} input */
export function createWechat(input) {
  const label = text(input.label);
  const wechatId = text(input.wechatId);
  if (!label || !wechatId) throw new Error('请填写账号名称和微信号');
  if (store.get().wechatAccounts.some((row) => row.wechatId === wechatId)) throw new Error('该微信账号已登记');
  const row = store.add('wechatAccounts', store.currentMid(), {
    label, wechatId, owner: text(input.owner), note: text(input.note, 1000), status: 'active',
    mode: 'manual',
  }, 'wx');
  store.saveNow();
  return row;
}

/** @param {string} keyword @param {string} region @param {string} mode @param {string} requestId */
export async function search(keyword, region, mode, requestId) {
  const term = text(keyword);
  if (!term) throw new Error('请填写产品、行业或公司关键词');
  if (mode === 'web') {
    return billable('lead_search', requestId, { keyword: term, region }, async () => {
      const result = await leads.search({ keyword: term + ' ' + text(region), country: '中国', limit: 30, mode: 'web' });
      const added = importLeads(result.results);
      return { leads: result.results, added, source: 'web' };
    });
  }
  const matches = store.get().leads.filter((row) => {
    const content = [row.co, row.person, row.tag, row.region].join(' ').toLowerCase();
    return content.includes(term.toLowerCase()) && (!region || content.includes(region.toLowerCase()));
  });
  return { leads: matches, added: 0, source: 'local' };
}

/** @param {string} leadId @param {string} requestId */
export async function draft(leadId, requestId) {
  const lead = owned('leads', leadId);
  const company = store.get().kb.company;
  const fallback = `您好，我们是${company.name || '产品服务团队'}，主要提供${company.products || '相关产品与服务'}。了解到贵司${lead.co}的业务，想了解是否有相关采购或合作需求，方便进一步沟通吗？`;
  if (!llm.cfg().enabled) return { text: fallback, mode: 'template' };
  return billable('ai_generate', requestId, { leadId }, async () => {
    const result = await llm.chat([
      { role: 'system', content: '根据提供的企业和产品事实起草中文首次联系消息。简短、准确，价格和认证缺少依据时保留待确认。只输出草稿。' },
      { role: 'user', content: JSON.stringify({ company, products: store.get().kb.products, target: { co: lead.co, tag: lead.tag } }) },
    ]);
    return { text: result.text.trim(), mode: 'ai' };
  });
}

/** @param {ContactInput} input */
export function createContact(input) {
  const lead = owned('leads', text(input.leadId));
  const account = owned('wechatAccounts', text(input.accountId));
  if (account.status !== 'active') throw new Error('微信账号已暂停');
  if (!lead.wechat && !lead.phone) throw new Error('该线索尚无微信号或联系电话');
  if (store.get().suppressions.some((row) => row.leadId === lead.id)) throw new Error('该线索已拒绝联系或退订');
  if (store.get().contactTasks.some((row) => row.leadId === lead.id && !['已取消', '已拒绝'].includes(row.status))) throw new Error('该线索已有联系任务');
  const message = text(input.text, 4000);
  if (!message) throw new Error('请填写并核对联系话术');
  const row = store.add('contactTasks', store.currentMid(), {
    leadId: lead.id, accountId: account.id, company: lead.co, contact: lead.wechat || lead.phone,
    text: message, owner: text(input.owner || account.owner), status: '待审核',
    history: [{ status: '待审核', at: Date.now(), note: '已建立人工联系任务' }],
  }, 'ct');
  store.saveNow();
  return row;
}

const transitions = {
  待审核: ['待联系', '已取消'], 待联系: ['已申请', '已联系', '已取消'],
  已申请: ['已通过', '已拒绝', '已取消'], 已通过: ['已联系', '已拒绝'],
  已联系: ['已回复', '已拒绝'], 已回复: ['已拒绝'], 已拒绝: [], 已取消: [],
};

/** @param {string} id @param {string} status @param {string} note */
export function updateContact(id, status, note) {
  const row = owned('contactTasks', id);
  if (!transitions[row.status]?.includes(status)) throw new Error('不支持该状态变更');
  row.status = status;
  row.history.push({ status, at: Date.now(), note: text(note, 2000) });
  row.updatedAt = Date.now();
  if (status === '已拒绝') store.add('suppressions', store.currentMid(), { leadId: row.leadId, reason: '拒绝联系' }, 'sp');
  store.saveNow();
  return row;
}

/** @param {string} leadId @param {{requirement:string,owner?:string}} input */
export function qualify(leadId, input) {
  const lead = owned('leads', leadId);
  if (!lead.wechat && !lead.phone && !lead.email) throw new Error('请先补充客户已确认的联系方式');
  const requirement = text(input.requirement, 4000);
  if (!requirement) throw new Error('请登记客户实际回复或确认的需求');
  let customer = store.get().customers.find((row) => row.leadId === leadId);
  if (!customer) {
    customer = store.add('customers', store.currentMid(), {
      leadId, name: lead.person || lead.co, co: lead.co, country: '中国', channel: 'wechat',
      contact: lead.wechat || lead.phone || lead.email, owner: text(input.owner), stage: '待跟进',
      grade: 'B', note: requirement, lastContact: Date.now(), nextFollow: Date.now() + 86400000, thread: [],
    }, 'cu');
  }
  lead.status = 'qualified';
  lead.qualification = requirement;
  customer.thread.push({ ts: Date.now(), dir: 'in', text: requirement });
  store.saveNow();
  return customer;
}

/** @param {string} leadId @param {string} owner */
export async function pushLead(leadId, owner, requestId) {
  const lead = owned('leads', leadId);
  if (lead.status !== 'qualified') throw new Error('请先确认客户需求并转为有效留资');
  const assigned = text(owner);
  if (!assigned) throw new Error('请填写接收负责人');
  const customer = store.get().customers.find((row) => row.leadId === leadId);
  return pushCustomer(customer.id, assigned, requestId);
}

/** @param {string} id @param {{note:string,stage?:string,owner?:string,nextFollow?:number}} input */
export function followUp(id, input) {
  const customer = owned('customers', id);
  const note = text(input.note, 4000);
  if (!note) throw new Error('请填写跟进内容');
  const stages = ['待跟进', '已联系', '已回复', '报价中', '已成交', '已放弃'];
  if (input.stage && !stages.includes(input.stage)) throw new Error('客户阶段无效');
  const timestamp = input.nextFollow === undefined ? customer.nextFollow : Number(input.nextFollow);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('下次跟进时间无效');
  customer.thread = [...(customer.thread || []), { ts: Date.now(), dir: 'out', text: note }].slice(-100);
  customer.lastContact = Date.now();
  customer.note = note;
  if (input.stage) customer.stage = input.stage;
  if (input.owner !== undefined) customer.owner = text(input.owner);
  customer.nextFollow = timestamp;
  store.saveNow();
  return customer;
}
