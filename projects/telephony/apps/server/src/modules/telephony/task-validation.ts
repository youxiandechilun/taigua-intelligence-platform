/*
 * 中文导读：线路与语音外呼：task-validation.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { ZodError, type ZodIssue } from 'zod';

const taskFields = new Set([
  'requestId', 'retryPolicy', 'parallelism', 'expectedParallelism', 'lineId', 'province',
  'provider', 'name', 'agentId', 'recipients', 'startTime', 'endTime', 'attemptIds',
  'confirmed', 'confirmation', 'policy', 'expectedPolicy', 'includePrevious',
]);
const recipientFields = new Set(['crmCompanyId', 'crmContactId', 'phoneNumber', 'name', 'variables']);
const retryFields = new Set(['retries', 'retryIntervalMinutes']);

function fieldPath(issue: ZodIssue): (string | number)[] {
  const [field, index, child] = issue.path;
  if (typeof field !== 'string' || !taskFields.has(field)) return ['_root'];
  if (field === 'recipients') {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 2000) return [field];
    // Variable names are supplied by users. Keep the field location, never the key.
    return typeof child === 'string' && recipientFields.has(child) ? [field, index, child] : [field, index];
  }
  if (field === 'retryPolicy' || field === 'policy' || field === 'expectedPolicy') {
    return typeof index === 'string' && retryFields.has(index) ? [field, index] : [field];
  }
  if (field === 'attemptIds' && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 2000) return [field, index];
  return [field];
}

function fieldMessage(issue: ZodIssue, path: (string | number)[]) {
  const [field, index, child] = path;
  const row = typeof index === 'number' ? `第${index + 1}个客户：` : '';
  switch (field) {
    case 'name': return issue.code === 'too_big' ? '任务名称最多100字。' : '请填写1至100字的任务名称。';
    case 'agentId': return '请重新选择有效的数字员工。';
    case 'lineId': case 'province': case 'provider': return '请重新选择有效的线路和省份。';
    case 'parallelism': return '请选择1至6倍，且不能超过超级管理员设置的上限。';
    case 'expectedParallelism': return '原外呼倍数无效，请刷新任务后重试。';
    case 'startTime': return '预约开始时间格式不正确，请重新选择。';
    case 'endTime': return '预约结束时间格式不正确，请重新选择。';
    case 'requestId': return '提交编号无效，请刷新页面后重试。';
    case 'confirmation': case 'confirmed': return '请重新确认本次外呼操作。';
    case 'attemptIds': return '请选择1至2000条有效的重拨记录。';
    case 'includePrevious': return '重拨范围无效，请重新选择。';
    case 'retryPolicy': case 'policy': case 'expectedPolicy':
      if (index === 'retries') return '重拨次数应为0至3次。';
      if (index === 'retryIntervalMinutes') return '重拨间隔应为1至720分钟。';
      return '重拨设置格式不正确，请重新填写。';
    case 'recipients':
      if (!row) {
        if (issue.code === 'too_big') return '每次最多2000个号码，请分批导入。';
        if (issue.code === 'too_small') return '请至少添加1个客户号码。';
        return '客户名单格式不正确，请重新导入。';
      }
      if (child === 'phoneNumber') return row + '号码应为国内手机号或带区号的座机。';
      if (child === 'name') return row + '客户姓名最多200字，请检查姓名格式。';
      if (child === 'crmCompanyId' || child === 'crmContactId') return row + '客户库关联无效，请重新选择客户。';
      if (child === 'variables') {
        return row + (issue.code === 'custom' ? '每位客户最多10个自定义变量。' : '自定义变量名称最多100字，内容最多1000字。');
      }
      if (issue.code === 'custom' && issue.message === '请选择联系人所属企业') return row + '请选择联系人所属企业。';
      return row + '客户信息格式不正确，请检查后重新导入。';
    default:
      // These refinements use fixed application copy, never supplied values.
      if (issue.code === 'custom' && issue.message === '结束时间必须晚于开始时间') return '结束时间必须晚于开始时间。';
      return '外呼填写内容不符合要求，请检查后重试。';
  }
}

export function taskValidationError(error: ZodError) {
  // Preserve structural issue codes and safe field locations for the standard
  // error envelope. Only fixed Chinese copy reaches its message/fieldErrors.
  return new ZodError(error.issues.slice(0, 20).map(issue => {
    const path = fieldPath(issue);
    return { ...issue, path, message: fieldMessage(issue, path) };
  }));
}
