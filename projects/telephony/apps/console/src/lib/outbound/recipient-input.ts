/*
 * 中文导读：外呼任务：recipient-input.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { Recipient } from '@/src/lib/api/resources/aliyun';

const separators = /[\s,，;；、]+/u;

export function normalizeRecipientPhone(value: string) {
  return value.normalize('NFKC').replace(/[\s()-]/g, '').replace(/^(\+86|0086)/, '');
}

export function parseRecipientText(text: string) {
  const recipients: Recipient[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const items = text.normalize('NFKC').split(separators).filter(Boolean);
  for (const [index, item] of items.entries()) {
    const phoneNumber = normalizeRecipientPhone(item);
    if (!/^1[3-9]\d{9}$/.test(phoneNumber) && !/^0\d{2,3}\d{7,8}$/.test(phoneNumber)) {
      issues.push(`第 ${index + 1} 项“${item.slice(0, 40)}”：请填写国内手机号或带区号的座机`);
    } else if (seen.has(phoneNumber)) {
      duplicates++;
    } else {
      seen.add(phoneNumber);
      recipients.push({ phoneNumber, name: '', variables: {} });
    }
  }
  return { recipients, issues, duplicates };
}

export function mergeRecipientLists(existing: Recipient[], incoming: Recipient[]) {
  const merged = new Map(existing.map(recipient => [recipient.phoneNumber, recipient]));
  let duplicates = 0;
  for (const recipient of incoming) {
    const current = merged.get(recipient.phoneNumber);
    if (!current) {
      merged.set(recipient.phoneNumber, recipient);
      continue;
    }
    duplicates++;
    // Keep authorized CRM links and script variables when a pasted number overlaps.
    if ((!current.crmCompanyId && recipient.crmCompanyId)
      || (!current.crmCompanyId && !recipient.crmCompanyId && !current.name && recipient.name)) {
      merged.set(recipient.phoneNumber, recipient);
    }
  }
  return { recipients: [...merged.values()], duplicates };
}

export function removeRecipientFromText(text: string, phoneNumber: string) {
  return text.split(separators).filter(item => item && normalizeRecipientPhone(item) !== phoneNumber).join('\n');
}
