/*
 * 中文导读：线路与语音外呼：model-balances.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connection } from '../aliyun/aliyun.service.js';
import { modelKey } from './model-credentials.js';
import { modelPlatforms, type ModelPlatformId } from './model-platforms.js';
import { keyFingerprint } from './model-telemetry.js';
import { crmDb } from '../crm/crm.db.js';
import { decryptSecretValue } from '../../lib/secrets.js';

export const billingCredentialSchema = z.object({
  accessKeyId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9]+$/, '请填写有效的 AccessKey ID'),
  accessKeySecret: z.string().trim().min(16).max(256).regex(/^[A-Za-z0-9]+$/, '请填写有效的 AccessKey Secret'),
  securityToken: z.string().trim().max(8192).regex(/^[A-Za-z0-9._~+/=-]*$/, '临时令牌格式不正确').default(''),
}).strict();

async function billingCredentials(workspaceId: string) {
  const row = (await crmDb.query('SELECT "billingCredentials" FROM "WorkspaceModelAccount" WHERE "workspaceId"=$1 AND "provider"=\'qwen\'', [workspaceId]))[0];
  if (row?.billingCredentials) return billingCredentialSchema.parse(JSON.parse(decryptSecretValue(row.billingCredentials as string)));
  return (await connection(workspaceId)).credentials;
}
export async function billingCredentialConfigured(workspaceId: string) {
  const credentials = await billingCredentials(workspaceId);
  return !!credentials.accessKeyId && !!credentials.accessKeySecret;
}

const amount = z.union([z.number(), z.string().regex(/^-?[\d,]+(?:\.\d+)?$/)]).transform(v => Number(String(v).replaceAll(',', ''))).pipe(z.number().finite().min(-1e12).max(1e12));
const currency = z.enum(['CNY', 'USD', 'JPY']);
export type ModelBalance = { currency: 'CNY' | 'USD' | 'JPY'; available: number; cash?: number };
async function json(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(response.status === 401 || response.status === 403 ? '余额查询未获授权，请核对平台密钥权限' : '平台余额暂时无法读取，请稍后刷新'); }
  return response.json();
}
export async function balanceIdentity(workspaceId: string, provider: ModelPlatformId) {
  if (provider === 'qwen') {
    const credentials = await billingCredentials(workspaceId);
    return credentials.accessKeyId && credentials.accessKeySecret ? keyFingerprint(credentials.accessKeyId + ':' + credentials.accessKeySecret + ':' + (credentials.securityToken || '')) : '';
  }
  const p = modelPlatforms.find(p => p.id === provider)!;
  const key = await modelKey(workspaceId, p.key);
  return key ? keyFingerprint(key) : '';
}
export async function collectModelBalance(workspaceId: string, provider: ModelPlatformId): Promise<{ balances: ModelBalance[]; fingerprint: string }> {
  const platform = modelPlatforms.find(p => p.id === provider)!;
  if (platform.balance === 'manual') throw new Error('此平台暂未接入官方余额查询，请手动维护');
  if (provider === 'qwen') {
    const credentials = await billingCredentials(workspaceId), id = credentials.accessKeyId, secret = credentials.accessKeySecret;
    if (!id || !secret) throw new Error('需配置阿里云费用查询凭据，也可先手动维护余额');
    // QueryAccountBalance is read-only. Never derive a cloud-account balance
    // from the DashScope API key, local token counts, or a model price estimate.
    const params: Record<string, string> = { Action: 'QueryAccountBalance', Version: '2017-12-14', Format: 'JSON', AccessKeyId: id, SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0', SignatureNonce: randomUUID(), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    if (credentials.securityToken) params.SecurityToken = credentials.securityToken;
    const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const canonical = Object.keys(params).sort().map(k => encode(k) + '=' + encode(params[k]!)).join('&');
    params.Signature = createHmac('sha1', secret + '&').update('POST&%2F&' + encode(canonical)).digest('base64');
    const result = z.object({ Success: z.boolean(), Data: z.object({ Currency: currency, AvailableAmount: amount, AvailableCashAmount: amount.optional() }).optional() }).parse(await json('https://business.aliyuncs.com/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }));
    if (!result.Success || !result.Data) throw new Error('阿里云费用查询未获授权，请核对只读账单权限');
    return { fingerprint: keyFingerprint(id + ':' + secret + ':' + (credentials.securityToken || '')), balances: [{ currency: result.Data.Currency, available: result.Data.AvailableAmount, ...(result.Data.AvailableCashAmount !== undefined ? { cash: result.Data.AvailableCashAmount } : {}) }] };
  }
  const key = await modelKey(workspaceId, platform.key);
  if (!key) throw new Error('请先配置平台密钥');
  const headers = { Authorization: 'Bearer ' + key };
  if (provider === 'stepfun') {
    const result = z.object({ object: z.literal('account'), balance: amount }).parse(await json('https://api.stepfun.com/v1/accounts', { headers }));
    return { fingerprint: keyFingerprint(key), balances: [{ currency: 'CNY', available: result.balance }] };
  }
  const result = z.object({ is_available: z.boolean(), balance_infos: z.array(z.object({ currency: z.enum(['CNY', 'USD']), total_balance: amount, topped_up_balance: amount.optional() })).min(1).max(2) }).parse(await json('https://api.deepseek.com/user/balance', { headers }));
  return { fingerprint: keyFingerprint(key), balances: result.balance_infos.map(b => ({ currency: b.currency, available: b.total_balance, ...(b.topped_up_balance !== undefined ? { cash: b.topped_up_balance } : {}) })) };
}
