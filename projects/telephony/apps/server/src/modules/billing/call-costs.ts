/*
 * 中文导读：按通话实际派发线路和历史单价核算分钟费用，并汇总 AI 用量估算；未知费用保持待核算。
 * 金额计算使用纳元整数汇总，减少浮点累积误差；最后转换为界面使用的人民币数值。
 * 这里输出估算或待核算结果；供应商账单实扣与该估算口径需要分别识别。
 * 缺失用量、历史线路单价或未知计费模式时保留原因，不用零元代替未知费用。
 */
import type { CrmDb, Row } from '../crm/crm.service.js';

// Public reference prices, checked 2026-11-08. These are estimates from actual
// metered usage, not supplier invoices, discounts or wallet deductions.
const source = 'https://help.aliyun.com/zh/model-studio/model-pricing';
const priceVersion = 'aliyun-mainland-public-20261108';
export type CostItem = { name: string; model: string; purpose: string; requests: number; amountCny: number | null; knownCny: number; reason: string | null; priceVersion: string | null; source: string | null };
export type CallCost = {
  currency: 'CNY'; status: 'ESTIMATED' | 'PENDING'; lineName: string; provider: string; billableMinutes: number | null;
  tariffCny: number | null; phoneCny: number | null; aiCny: number | null;
  totalCny: number | null; knownCny: number; knownAiCny: number; reasons: string[]; items: CostItem[];
};
export type CostTotals = { calls: number; billableMinutes: number; phoneCny: number | null; aiCny: number | null; totalCny: number | null; knownPhoneCny: number; knownAiCny: number; knownCny: number; pendingPhoneCalls: number; pendingAiCalls: number; pendingCalls: number };
const amount = (n: bigint) => Number(n) / 1e9;
const nanos = (n: number) => BigInt(Math.round(n * 1e9));
const number = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const integer = (v: unknown) => { const n = number(v); return n !== null && Number.isSafeInteger(n) ? n : null; };
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
/* 中文注释：根据已知用量和已核对的模型价格估算费用；未知计费模式或缺失用量保持待核算。 */


export function modelCost(row: Row): CostItem {
  const input = integer(row.inputTokens), output = integer(row.outputTokens);
  const cached = integer(row.cachedTokens) ?? 0;
  const requests = integer(row.requests) ?? 0;
  const complete = integer(row.missingUsage) === 0;
  // Qwen Plus non-thinking price is tiered by the input length of each request.
  // Aggregated multi-request rows cannot safely use a single input-length tier.
  let known = 0n, reason: string | null = null;
  if (row.provider === 'qwen' && row.modelId === 'qwen-plus' && row.purpose === 'SUMMARY' && requests === 1 && input !== null && input <= 128000 && output !== null && cached === 0 && !(number(row.inputAudioTokens) || number(row.outputAudioTokens))) {
    const [inRate, outRate] = [800, 2000];
    // Rates are nano CNY / token. No per-request cent rounding.
    known = BigInt(input) * BigInt(inRate) + BigInt(output) * BigInt(outRate);
    if (!complete) reason = '供应商未返回完整用量';
  } else if (row.provider === 'qwen' && row.modelId === 'text-embedding-v4' && requests === 1 && input !== null) {
    known = BigInt(input) * 500n;
    if (!complete) reason = '供应商未返回完整用量';
  } else {
    reason = !complete || input === null ? '供应商未返回完整用量' : '该模型或计费模式的单价待核对';
  }
  const knownCny = amount(known);
  return { name: row.purpose === 'SUMMARY' ? '通话整理' : row.purpose === 'VOICE_TTS' ? '语音合成' : row.purpose === 'VOICE_CALL' ? '语音对话' : '模型调用', model: String(row.modelId), purpose: String(row.purpose), requests, amountCny: reason ? null : knownCny, knownCny, reason, priceVersion: known > 0n ? priceVersion : null, source: known > 0n ? source : null };
}
/* 中文注释：读取本通派发线路和历史单价；接通电话不足一分钟按一分钟，并合并已知 AI 费用。 */


export function calculateCallCost(call: Row, usage: Row[]): CallCost {
  const meta = object(call.metadata), snapshot = object(call.snapshot), result = object(call.result);
  // Use the exact dispatched line, never today's mutable line configuration.
  const line = object(result.dispatchedLine || snapshot.routes?.[call.recipientIndex]?.line || snapshot.route?.line || snapshot.line);
  const tariff = number(meta.costPerMinute) ?? number(line.costPerMinute);
  const seconds = integer(call.durationSeconds);
  const ended = ['COMPLETED', 'PROCESSED', 'FAILED', 'NOT_ANSWERED', 'CANCELLED'].includes(String(call.status));
  const answered = ['COMPLETED', 'PROCESSED'].includes(String(call.status)) || result.wasConnected === true || (seconds !== null && seconds > 0 && call.status === 'FAILED');
  const minutes = !ended ? null : answered ? seconds === null ? null : Math.max(1, Math.ceil(seconds / 60)) : 0;
  const phone = minutes === null || minutes > 0 && tariff === null ? null : amount(BigInt(minutes) * nanos(tariff ?? 0));
  const items = usage.map(modelCost);
  const reasons: string[] = [];
  if (!ended) reasons.push('通话尚未结束');
  if (minutes === null && ended) reasons.push('接通时长待回传');
  if (minutes !== null && minutes > 0 && tariff === null) reasons.push('缺少本通电话的历史线路单价');
  const aiMode = String(meta.mode || snapshot.mode || 'AI') !== 'MANUAL';
  if (answered && aiMode && !usage.some(row => row.purpose === 'VOICE_CALL')) reasons.push('缺少通话模型用量');
  if (answered && aiMode && (snapshot.speechSynthesis || result.effectiveVoice?.speechSynthesis) && !usage.some(row => row.purpose === 'VOICE_TTS')) reasons.push('缺少复刻音色合成用量');
  if (items.some(item => item.amountCny === null)) reasons.push('部分 AI 用量或单价待核算');
  const aiPending = !ended || reasons.some(r => /模型|合成|AI/.test(r));
  const knownAi = items.reduce((n, item) => n + nanos(item.knownCny), 0n);
  const ai = aiPending ? null : amount(knownAi);
  const total = phone === null || ai === null ? null : amount(nanos(phone) + nanos(ai));
  const provider = String(meta.lineProvider || line.serviceProvider || (meta.provider === 'HAOKEHU_CALLBACK' ? '好客呼' : String(meta.provider || '').startsWith('ALIYUN') ? '阿里云线路' : '服务商待核对'));
  return { currency: 'CNY', status: total === null ? 'PENDING' : 'ESTIMATED', lineName: String(meta.lineName || line.name || provider), provider, billableMinutes: minutes, tariffCny: tariff, phoneCny: phone, aiCny: ai, totalCny: total, knownCny: amount(nanos(phone ?? 0) + knownAi), knownAiCny: amount(knownAi), reasons, items };
}
/* 中文注释：仅为已获授权的通话补充同工作区的费用与模型用量，不扩大可见通话范围。 */


// Call IDs are already authorized by the caller's existing call visibility
// query. This joins only the same workspace and never widens the set of calls.
export async function withCallCosts<T extends { callId: string }>(db: CrmDb, workspaceId: string, calls: T[]): Promise<Array<T & { cost: CallCost }>> {
  if (!calls.length) return [];
  const input = new Map<string, Row>(), usage = new Map<string, Row[]>(), tasks = new Map<string, Row>();
  for (let start = 0; start < calls.length; start += 2000) {
    const ids = calls.slice(start, start + 2000).map(c => c.callId);
    const [rows, observations] = await Promise.all([
      db.query(`SELECT c."callId",c."status",COALESCE(c."durationSeconds",CASE WHEN jsonb_typeof(c."metadata"->'durationSeconds')='number' THEN GREATEST(0,round((c."metadata"->>'durationSeconds')::numeric)) END) AS "durationSeconds",a."taskId",a."recipientIndex",
        jsonb_build_object('costPerMinute',c."metadata"->'costPerMinute','mode',c."metadata"->'mode','provider',c."metadata"->'provider','lineName',c."metadata"->'lineName','lineProvider',c."metadata"->'lineProvider') AS metadata,
        jsonb_build_object('wasConnected',a."result"->'wasConnected','dispatchedLine',a."result"->'dispatchedLine','effectiveVoice',jsonb_build_object('speechSynthesis',a."result"->'effectiveVoice'->'speechSynthesis')) AS result
        FROM "CallLog" c LEFT JOIN "SipAttempt" a ON a."workspaceId"=c."organizationId" AND a."id"=c."callId" WHERE c."organizationId"=$1 AND c."callId"=ANY($2::text[]) AND c."deleted"=false`, [workspaceId, ids]),
      db.query(`SELECT u."callId",u."provider",u."modelId",u."purpose",u."inputTokens",u."outputTokens",u."totalTokens",u."inputAudioTokens",u."outputAudioTokens",u."cachedTokens",u."requests",u."missingUsage"
        FROM "ModelUsageRecord" u JOIN unnest($2::text[]) wanted(id) ON wanted.id=u."callId" WHERE u."workspaceId"=$1`, [workspaceId, [...new Set(ids)]]),
    ]);
    for (const row of rows) input.set(row.callId, row);
    for (const row of observations) { const list = usage.get(row.callId) || []; list.push(row); usage.set(row.callId, list); }
  }
  // A task snapshot can contain thousands of recipient routes. Extract only
  // billing fields once per task, rather than detoasting it for every call.
  const taskIds = [...new Set([...input.values()].map(row => row.taskId).filter(Boolean))];
  for (let start = 0; start < taskIds.length; start += 1000) {
    const rows = await db.query(`SELECT t."id",t."snapshot"->>'mode' AS mode,
      COALESCE(t."snapshot"->'speechSynthesis'<>'null'::jsonb,false) AS "usesSpeechSynthesis",
      jsonb_build_object('costPerMinute',COALESCE(t."snapshot"->'route'->'line'->'costPerMinute',t."snapshot"->'line'->'costPerMinute'),
        'name',COALESCE(t."snapshot"->'route'->'line'->'name',t."snapshot"->'line'->'name'),
        'serviceProvider',COALESCE(t."snapshot"->'route'->'line'->'serviceProvider',t."snapshot"->'line'->'serviceProvider')) AS line,
      (SELECT jsonb_agg(jsonb_build_object('costPerMinute',r.value->'line'->'costPerMinute','name',r.value->'line'->'name','serviceProvider',r.value->'line'->'serviceProvider') ORDER BY r.ordinality)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."snapshot"->'routes')='array' THEN t."snapshot"->'routes' ELSE '[]'::jsonb END) WITH ORDINALITY r(value,ordinality)) AS routes
      FROM "SipTask" t WHERE t."workspaceId"=$1 AND t."id"=ANY($2::text[])`, [workspaceId, taskIds.slice(start, start + 1000)]);
    for (const row of rows) tasks.set(row.id, row);
  }
  for (const row of input.values()) {
    const task = tasks.get(row.taskId);
    if (task) row.snapshot = { mode: task.mode, speechSynthesis: task.usesSpeechSynthesis, line: task.routes?.[row.recipientIndex] || task.line };
  }
  return calls.map(call => ({ ...call, cost: calculateCallCost(input.get(call.callId) || { status: 'UNKNOWN' }, usage.get(call.callId) || []) }));
}
/* 中文注释：汇总已知金额和待核算数量；存在未知费用时不把部分合计当成完整总成本。 */


export function sumCallCosts(calls: Array<{ cost: CallCost }>): CostTotals {
  let phone = 0n, ai = 0n, pendingPhone = 0, pendingAi = 0, pending = 0, minutes = 0;
  for (const { cost } of calls) {
    phone += nanos(cost.phoneCny ?? 0); ai += nanos(cost.knownAiCny); minutes += cost.billableMinutes ?? 0;
    if (cost.phoneCny === null) pendingPhone++;
    if (cost.aiCny === null) pendingAi++;
    if (cost.totalCny === null) pending++;
  }
  return { calls: calls.length, billableMinutes: minutes, phoneCny: pendingPhone ? null : amount(phone), aiCny: pendingAi ? null : amount(ai), totalCny: pending ? null : amount(phone + ai), knownPhoneCny: amount(phone), knownAiCny: amount(ai), knownCny: amount(phone + ai), pendingPhoneCalls: pendingPhone, pendingAiCalls: pendingAi, pendingCalls: pending };
}
