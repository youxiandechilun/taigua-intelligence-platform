/*
 * 中文导读：线路与语音外呼：model-telemetry.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash, randomUUID } from 'node:crypto';
import { crmDb } from '../crm/crm.db.js';
import type { CrmDb } from '../crm/crm.service.js';
import { modelPlatforms } from './model-platforms.js';
import { modelKey } from './model-credentials.js';

export const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
const counter = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1e12 ? v : null;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
async function providerFailureDiagnostic(response: Response, connection: Connection, purpose: string, init: RequestInit): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const diagnostic: { status: number; model: string; purpose: string; endpoint?: string; requestId?: string; code?: string; message?: string; bodySkipped?: string } = { status: response.status, model: connection.model, purpose };
  try {
    diagnostic.endpoint = new URL(connection.base).origin;
    const safeField: (value: unknown) => string = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) && !/^sk[-_]/i.test(value) && !(connection.key && value.includes(connection.key)) ? value : '';
    diagnostic.requestId = safeField(response.headers.get('x-request-id') || response.headers.get('x-dashscope-request-id'));
    const type = response.headers.get('content-type') || '';
    const length = Number(response.headers.get('content-length'));
    if (type.includes('text/event-stream') || length > 8192) {
      diagnostic.bodySkipped = type.includes('text/event-stream') ? 'stream' : 'size';
      return;
    }
    reader = response.clone().body?.getReader();
    if (!reader)
      return;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('diagnostic timeout')), 1000); });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done)
        break;
      size += value.byteLength;
      if (size > 8192) {
        diagnostic.bodySkipped = 'size';
        return;
      }
      chunks.push(value);
    }
    const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))), error = object(body.error);
    diagnostic.code = safeField(error.code || body.code);
    diagnostic.requestId ||= safeField(body.request_id || body.requestId || error.request_id);
    // Never log the request body. Remove echoed request fragments, quoted
    // values, credentials and contact details from the provider message.
    let message = String(error.message || body.message || '').slice(0, 768);
    if (connection.key)
      message = message.replaceAll(connection.key, '[REDACTED]');
    message = message.replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b1[3-9]\d{9}\b/gi, '[REDACTED]')
      .replace(/["'`“‘][^"'`”’\r\n]*["'`”’]/g, '[REDACTED]');
    const fragments = new Set<string>();
    try {
      const request = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      let remaining = 65536;
      for (const item of Array.isArray(request.messages) ? request.messages.slice(0, 128) : []) {
        if (typeof item?.content !== 'string')
          continue;
        const text = item.content.slice(0, remaining);
        remaining -= text.length;
        for (let i = 0; i + 6 <= text.length; i++)
          fragments.add(text.slice(i, i + 6));
        if (remaining <= 0)
          break;
      }
    }
    catch { /* Request parsing must never change a model response. */ }
    let safeMessage = '';
    for (let i = 0; i < message.length;) {
      if (fragments.has(message.slice(i, i + 6))) {
        safeMessage += '[REDACTED]';
        i += 6;
      }
      else {
        safeMessage += message[i++];
      }
    }
    diagnostic.message = safeMessage.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 384);
  }
  catch {
    diagnostic.bodySkipped ||= 'unavailable';
  }
  finally {
    clearTimeout(timer);
    // A cloned stream cancellation can wait on the original consumer.
    // Do not await it or change the original Response returned to callers.
    if (reader)
      void reader.cancel().catch(() => { });
    console.warn('[model-failure]', JSON.stringify(diagnostic));
  }
} export function tokenUsage(raw: unknown) {
  const u = object(raw), input = counter(u.input_tokens ?? u.prompt_tokens), output = counter(u.output_tokens ?? u.completion_tokens);
  const total = counter(u.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  const inputDetails = object(u.input_tokens_details ?? u.prompt_tokens_details), outputDetails = object(u.output_tokens_details ?? u.completion_tokens_details);
  return { inputTokens: input, outputTokens: output, totalTokens: total, inputAudioTokens: counter(inputDetails.audio_tokens), outputAudioTokens: counter(outputDetails.audio_tokens), cachedTokens: counter(inputDetails.cached_tokens ?? u.prompt_cache_hit_tokens) };
}
type Tokens = ReturnType<typeof tokenUsage>;
export type UsageObservation = Tokens & { requests: number; missingUsage: number };
export async function storeModelUsage(workspaceId: string, provider: string, modelId: string, purpose: string, id: string, usage: UsageObservation, db: CrmDb = crmDb, callId: string | null = null) {
  const recordId = keyFingerprint(workspaceId + ':' + provider + ':' + id);
  // Voice observations are cumulative. Retries and out-of-order heartbeats must
  // not add the same tokens twice or replace a complete total with an older one.
  await db.query(`INSERT INTO "ModelUsageRecord" ("id","workspaceId","provider","modelId","purpose","callId","inputTokens","outputTokens","totalTokens","inputAudioTokens","outputAudioTokens","cachedTokens","requests","missingUsage") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   ON CONFLICT ("id") DO UPDATE SET "inputTokens"=GREATEST("ModelUsageRecord"."inputTokens",EXCLUDED."inputTokens"),"outputTokens"=GREATEST("ModelUsageRecord"."outputTokens",EXCLUDED."outputTokens"),"totalTokens"=GREATEST("ModelUsageRecord"."totalTokens",EXCLUDED."totalTokens"),"inputAudioTokens"=GREATEST("ModelUsageRecord"."inputAudioTokens",EXCLUDED."inputAudioTokens"),"outputAudioTokens"=GREATEST("ModelUsageRecord"."outputAudioTokens",EXCLUDED."outputAudioTokens"),"cachedTokens"=GREATEST("ModelUsageRecord"."cachedTokens",EXCLUDED."cachedTokens"),"requests"=GREATEST("ModelUsageRecord"."requests",EXCLUDED."requests"),"missingUsage"=GREATEST("ModelUsageRecord"."missingUsage",EXCLUDED."missingUsage"),"updatedAt"=NOW() RETURNING "id"`, [recordId, workspaceId, provider, modelId, purpose, callId, usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.inputAudioTokens, usage.outputAudioTokens, usage.cachedTokens, usage.requests, usage.missingUsage]);
}
export async function observeTextUsage(workspaceId: string, preset: {id: string; key: string}, body: unknown, purpose: string, db: CrmDb = crmDb, callId: string | null = null) {
  const platform = modelPlatforms.find(p => p.key === preset.key); if (!platform) return;
  const b = object(body), usage = tokenUsage(b.usage);
  await storeModelUsage(workspaceId, platform.id, preset.id, purpose, typeof b.id === 'string' ? purpose + ':' + b.id : randomUUID(), { ...usage, requests: 1, missingUsage: usage.totalTokens === null ? 1 : 0 }, db, callId);
}
export async function observeModelConnection(workspaceId: string, modelId: string, key: string, connected: boolean, message: string, db: CrmDb = crmDb, observedAt = new Date()) {
  await db.query(`INSERT INTO "WorkspaceModelCheck" ("workspaceId","modelId","keyFingerprint","connected","message","checkedAt") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("workspaceId","modelId") DO UPDATE SET "keyFingerprint"=EXCLUDED."keyFingerprint","connected"=EXCLUDED."connected","message"=EXCLUDED."message","checkedAt"=EXCLUDED."checkedAt" WHERE "WorkspaceModelCheck"."checkedAt"<=EXCLUDED."checkedAt" RETURNING "modelId"`, [workspaceId, modelId, keyFingerprint(key), connected, message, observedAt]);
}
type Connection = { model: string; base: string; key: string };
export async function modelFetch(workspaceId: string, connection: Connection, purpose: string, init: RequestInit, callId: string | null = null) {
  const platform = modelPlatforms.find(p => connection.base === ({ qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1', stepfun: 'https://api.stepfun.com/v1', deepseek: 'https://api.deepseek.com/v1', zhipu: 'https://open.bigmodel.cn/api/paas/v4' } as const)[p.id]);
  const startedAt = new Date();
  const observe = async (connected: boolean, message: string, body?: unknown) => {
    if (!platform) return;
    try {
      // A request made with the old key must not certify a newly saved key.
      if (await modelKey(workspaceId, platform.key) === connection.key) await observeModelConnection(workspaceId, connection.model, connection.key, connected, message, crmDb, startedAt);
      if (body !== undefined) await observeTextUsage(workspaceId, { id: connection.model, key: platform.key }, body, purpose, crmDb, callId);
    } catch { console.warn('[model-usage] observation delayed'); }
  };
  let response: Response;
  try { response = await fetch(connection.base + '/chat/completions', { ...init, redirect: 'error' }); }
  catch (error) {
    if (!init.signal?.aborted || init.signal.reason?.name === 'TimeoutError') await observe(false, '实际调用未能连接模型服务');
    throw error;
  }
  if (!response.ok) {
    await providerFailureDiagnostic(response, connection, purpose, init); await observe(false, response.status === 401 ? '密钥无效或已过期' : response.status === 403 ? '当前账号没有此模型的权限' : response.status === 429 ? '模型额度不足或请求受限' : '实际调用未成功，请检查服务状态');
  } else {
    try {
      const body = await response.clone().json() as { choices?: unknown[]; error?: unknown };
      const connected = Array.isArray(body.choices) && body.choices.length > 0 && !body.error;
      await observe(connected, connected ? '最近实际调用已响应' : '模型未返回有效回答', body);
    } catch { await observe(false, '模型服务返回内容异常'); }
  }
  return response;
}
