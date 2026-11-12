/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from '../client';

export type TestNumberWhitelistEntry = {
  id: string;
  phoneNumber: string;
  note: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TestNumberWhitelistCatalog = {
  canManage: true;
  items: TestNumberWhitelistEntry[];
  maxEntries: number;
};

export type TestNumberWhitelistInput = Pick<TestNumberWhitelistEntry, 'phoneNumber' | 'note' | 'enabled'>;

const base = '/telephony/test-number-whitelist';
const options = (org: string) => ({ headers: { 'x-workspace-id': org } });

export const testNumberWhitelistKey = (user: string, org: string) => ['telephony', user, org, 'test-number-whitelist'] as const;

export const testNumberWhitelistApi = {
  get: (org: string) => unwrap<TestNumberWhitelistCatalog>(apiClient.get(base, options(org))),
  create: (org: string, input: TestNumberWhitelistInput) => unwrap<TestNumberWhitelistCatalog>(apiClient.post(base, input, options(org))),
  update: (org: string, id: string, input: TestNumberWhitelistInput & { expectedUpdatedAt: string }) => unwrap<TestNumberWhitelistCatalog>(apiClient.patch(base + '/' + encodeURIComponent(id), input, options(org))),
  remove: (org: string, id: string, expectedUpdatedAt: string) => unwrap<TestNumberWhitelistCatalog>(apiClient.delete(base + '/' + encodeURIComponent(id), { ...options(org), data: { expectedUpdatedAt } })),
};
