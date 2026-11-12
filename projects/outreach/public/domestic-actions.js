import { request, notify, edit, field, area, dataOf, escapeHtml as esc } from './domestic-api.js';

/** @param {string} action @param {string} id @param {()=>Promise<void>} reload */
export async function handleAction(action, id, reload) {
  if (action === 'add-account') {
    edit('登记微信账号', field('账号名称', 'label', '', 'text', true) + field('微信号', 'wechatId', '', 'text', true) + field('负责人', 'owner') + area('备注', 'note'), async (form) => {
      await request('/api/wechat/accounts', dataOf(form));
      await reload();
    });
  }
  if (action === 'add-lead') {
    edit('添加候选线索', '<div class="form-grid">' + field('公司名称', 'co', '', 'text', true) + field('联系人', 'person') + field('地区', 'region') + field('行业标签', 'tag') + field('联系电话', 'phone') + field('微信号', 'wechat') + field('邮箱', 'email', '', 'email') + field('来源或链接', 'source') + '</div>', async (form) => {
      await request('/api/domestic/leads', dataOf(form));
      await reload();
    });
  }
  if (action === 'import-leads') {
    edit('导入候选名单', '<p class="hint">每行一条，依次填写公司、联系人、电话、微信号、地区，以逗号分隔。</p>' + area('名单内容', 'text', '', true), async (form) => {
      const rows = String(form.get('text')).split(/\r?\n/).filter((line) => line.trim()).map((line) => {
        const [co, person, phone, wechat, region] = line.split(/[,，\t]/).map((value) => value.trim());
        return { co, person, phone, wechat, region, source: '名单导入' };
      });
      const result = await request('/api/domestic/leads', { rows });
      notify('已导入 ' + result.added + ' 条新线索');
      await reload();
    });
  }
  if (action === 'search') {
    edit('查找线索', field('产品、行业或公司关键词', 'keyword', '', 'text', true) + field('地区', 'region') + '<label>来源<select name="mode"><option value="local">已有线索库</option><option value="web">公开网页检索</option></select></label>', async (form) => {
      const result = await request('/api/domestic/search', dataOf(form));
      notify('本次匹配 ' + result.data.leads.length + ' 条，新增 ' + result.data.added + ' 条');
      await reload();
    });
  }
  if (action === 'contact') {
    const [draft, accounts] = await Promise.all([request('/api/domestic/draft', { leadId: id }), request('/api/wechat/accounts')]);
    if (!accounts.data.length) throw new Error('请先在微信账号中登记用于联系的账号');
    const options = accounts.data.filter((row) => row.status === 'active').map((row) => `<option value="${esc(row.id)}">${esc(row.label)} · ${esc(row.owner || '未指定负责人')}</option>`).join('');
    edit('准备微信联系任务', `<label>使用账号<select name="accountId" required>${options}</select></label>` + field('负责人', 'owner') + area('核对并编辑联系话术', 'text', draft.data.text, true) + '<p class="hint">保存后进入待审核。审核通过后，由负责人在微信中确认联系并登记结果。</p>', async (form) => {
      await request('/api/contact-tasks', { ...dataOf(form), leadId: id });
      await reload();
      notify('联系任务已进入待审核');
    });
  }
  if (action === 'task-status') {
    const tasks = (await request('/api/contact-tasks')).data;
    const task = tasks.find((row) => row.id === id);
    const next = { 待审核: ['待联系', '已取消'], 待联系: ['已申请', '已联系', '已取消'], 已申请: ['已通过', '已拒绝', '已取消'], 已通过: ['已联系', '已拒绝'], 已联系: ['已回复', '已拒绝'], 已回复: ['已拒绝'] }[task.status] || [];
    if (!next.length) throw new Error('该任务已结束');
    edit('登记联系结果', `<p class="hint">目标 ${esc(task.company)} · ${esc(task.contact)}</p>` + area('联系话术', 'text', task.text) + `<label>处理结果<select name="status">${next.map((status) => `<option>${status}</option>`).join('')}</select></label>` + area('实际处理情况或客户回复', 'note'), async (form) => {
      await request('/api/contact-tasks/' + encodeURIComponent(id), dataOf(form), 'PATCH');
      await reload();
    });
  }
  if (action === 'qualify') {
    edit('确认有效留资', area('客户实际回复或确认的需求', 'requirement', '', true) + field('负责人', 'owner'), async (form) => {
      await request('/api/domestic/leads/' + encodeURIComponent(id) + '/qualify', dataOf(form));
      await reload();
      notify('已建立客户档案');
    });
  }
  if (action === 'push') {
    edit('分配留资', field('接收负责人', 'owner', '', 'text', true), async (form) => {
      await request('/api/domestic/leads/' + encodeURIComponent(id) + '/push', dataOf(form));
      await reload();
      notify('已分配负责人并保存站内推送记录');
    });
  }
  if (action === 'follow') {
    const customers = (await request('/api/customers')).customers;
    const customer = customers.find((row) => row.id === id);
    const stages = ['待跟进', '已联系', '已回复', '报价中', '已成交', '已放弃'];
    edit('记录客户跟进', field('负责人', 'owner', customer.owner) + `<label>客户阶段<select name="stage">${stages.map((stage) => `<option ${stage === customer.stage ? 'selected' : ''}>${stage}</option>`).join('')}</select></label>` + area('本次沟通或报价情况', 'note', '', true) + field('下次跟进时间', 'nextFollow', '', 'datetime-local'), async (form) => {
      const data = dataOf(form);
      data.nextFollow = data.nextFollow ? new Date(String(data.nextFollow)).getTime() : 0;
      await request('/api/domestic/customers/' + encodeURIComponent(id) + '/followups', data);
      await reload();
    });
  }
  if (action === 'add-product') {
    edit('新增产品资料', field('产品名称', 'name', '', 'text', true) + field('型号或规格', 'model') + area('产品介绍与适用范围', 'desc', '', true), async (form) => {
      await request('/api/kb/products', dataOf(form));
      await reload();
    });
  }
}
