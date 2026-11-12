/*
 * 中文导读：外呼任务：import-template.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const OUTBOUND_TEMPLATE_PATH = '/templates/outbound-numbers.xlsx';
export const OUTBOUND_TEMPLATE_FILENAME = '外呼号码导入模板.xlsx';

/** A generic blank template must not depend on a telephone supplier or a role-specific API. */
export function downloadOutboundTemplate() {
  const link = document.createElement('a');
  link.href = OUTBOUND_TEMPLATE_PATH;
  link.download = OUTBOUND_TEMPLATE_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
