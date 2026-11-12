/*
 * 中文导读：既有验证代码：workspace-access.test 的输入、输出及边界场景。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { resolveOrganizationApiKeyAuth } from '../../src/middleware/api-key-auth.js';

class Denied extends Error {}
function load(path: string, mocks: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(source, { exports, Buffer, process: { env: { INTERNAL_API_KEY: 'test-only-internal-token' } }, require: (name: string) => { if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name); return mocks[name]; } });
  return exports;
}

test('workspace list excludes recycled companies and unavailable memberships without exposing recovery metadata', async () => {
  let where: any, select: any, result: any, error: unknown;
  const loaded = load('../../src/modules/accounts/private-auth-policy.ts', {
    'better-auth/node': { fromNodeHeaders: (headers: unknown) => headers },
    '../../lib/auth.js': { auth: { api: { getSession: async () => ({ user: { id: 'viewer' }, session: { activeOrganizationId: 'live' } }) } } },
    '../../config/prisma.js': { __esModule: true, default: { organization: { findMany: async (args: any) => { where = args.where; select = args.select; return [{ id: 'live', name: '泰卦外贸' }]; } } } },
  });
  const res = { setHeader: () => {}, json: (body: unknown) => { result = body; }, status: () => res };
  await loaded.privateAuthPolicy({ path: '/organization/list', headers: {} }, res, (value: unknown) => { error = value; });
  assert.equal(error, undefined);
  assert.equal(where.deletedAt, null);
  assert.equal(where.members.some.userId, 'viewer');
  assert.equal(where.members.some.enabled, true);
  assert.equal(where.members.some.deletedAt, null);
  assert.equal(where.members.some.user.banned, false);
  assert.equal(select.recycleState, undefined);
  assert.equal(select.deletedById, undefined);
  assert.equal(result[0].id, 'live');
});

test('archived workspaces reject both direct organization selection and old membership access', async () => {
  let memberWhere: any, status = 200, passed = false;
  const loaded = load('../../src/modules/accounts/private-auth-policy.ts', {
    'better-auth/node': { fromNodeHeaders: (headers: unknown) => headers },
    '../../lib/auth.js': { auth: { api: { getSession: async () => ({ user: { id: 'viewer' }, session: { activeOrganizationId: 'live' } }) } } },
    '../../config/prisma.js': { __esModule: true, default: { member: { findFirst: async (args: any) => { memberWhere = args.where; return null; } } } },
  });
  const res = { json: () => {}, status: (code: number) => { status = code; return res; } };
  await loaded.privateAuthPolicy({ path: '/organization/set-active', headers: {}, query: {}, body: { organizationId: 'deleted' } }, res, () => { passed = true; });
  assert.equal(status, 403);
  assert.equal(passed, false);
  assert.equal(memberWhere.organization.deletedAt, null);
  assert.equal(memberWhere.deletedAt, null);
});

test('old sessions, preverified requests, API keys and internal callers cannot access a recycled workspace', async () => {
  let available = false, memberWhere: any;
  const loaded = load('../../src/middleware/auth.middleware.ts', {
    'node:crypto': await import('node:crypto'),
    'better-auth/node': { fromNodeHeaders: (headers: unknown) => headers },
    '../lib/auth.js': { auth: { api: {
      getSession: async () => ({ user: { id: 'viewer' }, session: { activeOrganizationId: 'target' } }),
      verifyApiKey: async () => ({ valid: true, key: { id: 'key', referenceId: 'target', permissions: { agent: ['read'] } } }),
    } } },
    '../common/errors/unauthenticated.js': { UnauthenticatedError: Denied },
    '../common/errors/forbidden.js': { ForbiddenError: Denied },
    '../modules/audit/audit-log.service.js': { recordAuditEvent: async () => {} },
    '../config/prisma.js': { __esModule: true, default: {
      organization: { findUnique: async () => ({ deletedAt: available ? null : new Date() }) },
      member: { findFirst: async (args: any) => { memberWhere = args.where; return available ? { userId: 'viewer' } : null; } },
    } },
    './api-key-auth.js': { resolveOrganizationApiKeyAuth },
  });
  const requests = [
    { headers: {} },
    { headers: {}, auth: { userId: 'viewer', activeOrganizationId: 'target', authMethod: 'session' } },
    { headers: { authorization: 'Bearer test-only-internal-token', 'x-user-id': 'viewer', 'x-organization-id': 'target' } },
    { headers: { 'x-api-key': 'test-only-company-key' } },
  ];
  for (const input of requests) {
    let error: unknown;
    await loaded.default({ ...input, body: {}, query: {} }, {}, (value: unknown) => { error = value; });
    assert.ok(error instanceof Error, 'Each authentication mode must reject archived workspaces');
  }
  assert.equal(memberWhere.organization.deletedAt, null);
  available = true;
  let error: unknown;
  await loaded.default({ headers: {}, body: {}, query: {} }, {}, (value: unknown) => { error = value; });
  assert.equal(error, undefined, 'The active workspace remains available');
});
