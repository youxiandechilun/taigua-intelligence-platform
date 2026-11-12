/*
 * 中文导读：线路与语音外呼：aliyun-engine.gateway.ts。处理实时连接和消息分发。
 */
import { modelFetch } from './model-telemetry.js';
import {knowledgeContext,knowledgePolicy} from '../kb/knowledge-retrieval.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import type { Row } from '../crm/crm.service.js';
import { assertAgentUse, taskRuntime } from '../agent/agent.release.js';
import { frozenTextConnection } from './aliyun-engine.service.js';
import { engineDialogue, engineDialogueInstructions, engineDialogueTools, engineEventReply, engineMessages, engineModelReply, type EngineDialogue } from './aliyun-engine.dialogue.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';

export function authenticateEngine(req: Request, kind: 'GATEWAY' | 'RECEIPT') {
  const expected = process.env['ALIYUN_ENGINE_' + kind + '_TOKEN'];
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || (kind === 'RECEIPT' && typeof req.query.token === 'string' ? req.query.token : '');
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!expected || expected.length < 32 || !supplied || !timingSafeEqual(hash(supplied), hash(expected))) throw new ForbiddenError('阿里云通信引擎认证失败。');
}
const schema = z.object({ session_id: z.string().min(1).max(200), out_id: z.string().regex(/^[a-f0-9]{15}$/), stream: z.literal(true), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10000) })).max(100) });
const connectivityProbe = z.object({ stream: z.literal(true), session_id: z.string().max(200).optional(), out_id: z.string().max(200).optional(), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10000) })).min(1).max(2).refine(messages => messages[messages.length - 1]?.role === 'user' && messages[messages.length - 1]?.content === '仅检查泰卦网关连通性' && messages.slice(0, -1).every(message => message.role === 'assistant')) });
const streams = new Map<string, AbortController>();

async function saveDialogue(a: Row, turnId: string, state: EngineDialogue) {
  return crmDb.transaction(async db => {
    const updated = await db.query(`UPDATE "SipAttempt" SET "result"=COALESCE("result",'{}'::jsonb)||jsonb_build_object('engineDialogue',$3::jsonb) WHERE "id"=$1 AND "result"->>'engineTurnId'=$2 AND "status" IN ('DISPATCHING','DIALING','CONNECTED') RETURNING "id"`, [a.attemptId, turnId, JSON.stringify(state)]);
    if (!updated.length) return false;
    if (state.optOutRequested) {
      const r = a.recipients[a.recipientIndex];
      const companies = await db.query(`UPDATE "CrmCompany" SET "status"='OPT_OUT',"nextFollowUp"=NULL,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND ("id"=$2 OR "phone"=$3) RETURNING "id"`, [a.workspaceId, r.crmCompanyId || '', r.phoneNumber]);
      await db.query(`UPDATE "CrmContact" SET "doNotCall"=true,"status"='OPT_OUT',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND ("companyId"=ANY($2::text[]) OR "mobile"=$3 OR "areaCode"||"landline"=$3) RETURNING "id"`, [a.workspaceId, companies.map(c => c.id), r.phoneNumber]);
      await db.query(`UPDATE "CrmTask" SET "status"='CANCELLED',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "companyId"=ANY($2::text[]) AND "status"='PENDING' RETURNING "id"`, [a.workspaceId, companies.map(c => c.id)]);
    }
    return true;
  });
}
async function modelMessage(response: globalThis.Response) {
  if (!response.body) throw new BadRequestError('共享模型服务暂不可用。');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 256000) throw new BadRequestError('共享模型返回内容过长。');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body.choices?.[0]?.message) throw new BadRequestError('共享模型没有返回有效回答。');
  return body.choices[0].message;
}
export async function engineGateway(req: Request, res: Response) {
  authenticateEngine(req, 'GATEWAY');
  // The cloud console may supply a synthetic session but has no task OutId. Keep
  // this explicit diagnostic free of model requests, training data and writes.
  const probe = connectivityProbe.safeParse(req.body);
  if (probe.success && !probe.data.out_id) {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '泰卦网关连接正常。此项仅检查连接，未调用模型或发起通话。' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  const input = schema.parse(req.body), turnId = randomUUID();
  const inputDigest = createHash('sha256').update(JSON.stringify(input.messages)).digest('hex');
  const a = await crmDb.transaction(async db => {
    const a = (await db.query(`SELECT c.*,a."status",a."result",a."startedAt",t."snapshot",t."createdBy",t."agentId",t."recipients",a."recipientIndex" FROM "AliyunEngineCall" c JOIN "SipAttempt" a ON a."id"=c."attemptId" AND a."workspaceId"=c."workspaceId" JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE c."outId"=$1 AND a."status" IN ('DISPATCHING','DIALING','CONNECTED') AND a."leaseUntil">NOW() FOR UPDATE OF c,a`, [input.out_id]))[0];
    if (!a || a.remoteId && a.remoteId !== input.session_id || a.snapshot.releaseId !== a.releaseId) throw new ForbiddenError('通话身份或正式版本不匹配。');
    await assertAgentUse({ workspaceId: a.workspaceId, userId: a.createdBy }, a.agentId, db);
    await db.query('UPDATE "AliyunEngineCall" SET "remoteId"=$2 WHERE "attemptId"=$1 RETURNING "attemptId"', [a.attemptId, input.session_id]);
    await db.query(`UPDATE "SipAttempt" SET "result"=COALESCE("result",'{}'::jsonb)||jsonb_build_object('engineTurnId',$2::text) WHERE "id"=$1 RETURNING "id"`, [a.attemptId, turnId]);
    return a;
  });
  const controller = new AbortController();
  streams.get(a.attemptId)?.abort(); streams.set(a.attemptId, controller);
  const deadline = setTimeout(() => controller.abort(), 25000);
  const closed = () => controller.abort(); res.on('close', closed);
  try {
    const runtime = { ...taskRuntime(a.snapshot, a.recipients[a.recipientIndex].variables || {}), maxDurationSeconds: a.snapshot.maxDurationSeconds, systemSpeech: a.snapshot.systemSpeech, language: a.snapshot.language };
    const { state, graph } = engineDialogue(a.result?.engineDialogue, runtime.flow);
    let content = state.inputDigest === inputDigest && state.response ? state.response : engineEventReply(state, runtime, input.messages, new Date(a.startedAt));
    if (!content) {
      const knowledge=await knowledgeContext(a.workspaceId,a.agentId,input.messages.filter(m=>m.role==='user').slice(-2).map(m=>m.content).join(' '),{channel:'ALIYUN',callId:a.attemptId,dedupeKey:inputDigest});
      const connection = await frozenTextConnection(a.workspaceId, a.snapshot.textModelId);
      const response = await modelFetch(a.workspaceId, connection, 'ALIYUN_CALL', {
        method: 'POST', headers: { Authorization: 'Bearer ' + connection.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: connection.model, stream: false, temperature: 0.25, max_tokens: 700, messages: [{ role: 'system', content: runtime.instructions + engineDialogueInstructions(state, graph)+'\n'+knowledgePolicy+'\n【本轮相关知识】\n'+(knowledge||'未检索到相关知识，必要时交由人工核实。') }, ...engineMessages(input.messages)], tools: engineDialogueTools(graph, state), tool_choice: 'auto' }),
        signal: controller.signal,
      }, a.attemptId);
      if (!response.ok) throw new BadRequestError('共享模型服务暂不可用。');
      content = engineModelReply(state, graph, await modelMessage(response), input.messages, runtime.opening, runtime);
    }
    if (controller.signal.aborted) { res.end(); return; }
    state.inputDigest = inputDigest; state.response = content;
    if (!await saveDialogue(a, turnId, state) || controller.signal.aborted) { res.end(); return; }
    // Only server-validated actions become MSML. A model cannot inject transfer destinations.
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  } finally {
    clearTimeout(deadline); res.off('close', closed);
    if (streams.get(a.attemptId) === controller) streams.delete(a.attemptId);
    if (!res.writableEnded && controller.signal.aborted) res.end();
  }
}
