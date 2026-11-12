/*
 * 中文导读：线路与语音外呼：opening-interruption-rules.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CrmDb } from '../crm/crm.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';

const keywords = z.array(z.string().trim().min(1).max(80).refine(value => /[\p{L}\p{N}]/u.test(value), '请填写有效词语'));
export const openingInterruptionRulesSchema = z.object({
  lockOpening: z.boolean(),
  acknowledgementKeywords: keywords,
  interruptKeywords: keywords,
}).strict();
export type OpeningInterruptionRules = z.infer<typeof openingInterruptionRulesSchema>;
export const defaultOpeningInterruptionRules: OpeningInterruptionRules = {
  lockOpening: false,
  acknowledgementKeywords: ['嗯', '嗯嗯', '喂', '你好', '您好', '哦', '噢', '啊', '呃', '好', '好的', '明白', '明白了', '知道了', '了解', '收到', '对', '是的', '行', 'hello', 'hi', 'hey', 'um', 'uh', 'oh', 'ok', 'okay', 'right', 'got it', 'I see'],
  interruptKeywords: ['不需要', '不要', '别打', '不方便', '没兴趣', '再见', '哪位', '什么公司', '什么事', '收费', '多少钱', '怎么', '为什么', '有意向', '感兴趣', '发我', '加微信', 'no thanks', 'not interested', 'stop calling', 'who are you', 'how much', 'interested'],
};
const compact = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function classifyOpeningSpeech(text: string, rules: OpeningInterruptionRules) {
  const value = compact(text);
  const keyword = rules.interruptKeywords.find(item => { const token = compact(item); return token && value.includes(token); });
  if (keyword) return { substantive: true, reason: 'interrupt_keyword', keyword };
  if (!value) return { substantive: false, reason: 'empty', keyword: null };
  const words = [...new Set(rules.acknowledgementKeywords.map(compact).filter(Boolean))].sort((a, b) => b.length - a.length);
  // Acknowledgements must cover the WHOLE utterance. Prefixes never hide a question.
  if ([...value].length > 80) return { substantive: true, reason: 'substantive_speech', keyword: null };
  const reachable = new Set([0]);
  for (let i = 0; i < value.length; i++) {
    if (!reachable.has(i)) continue;
    for (const word of words) if (value.startsWith(word, i)) reachable.add(i + word.length);
  }
  return { substantive: !reachable.has(value.length), reason: reachable.has(value.length) ? 'acknowledgement' : 'substantive_speech', keyword: null };
}
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
export function resolveOpeningInterruptionRules(raw: unknown): OpeningInterruptionRules {
  const parsed = openingInterruptionRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultOpeningInterruptionRules;
}
export const openingRulesRevision = (rules: OpeningInterruptionRules) => createHash('sha256').update(JSON.stringify(rules)).digest('hex');
export async function openingInterruptionRules(db: CrmDb, workspaceId: string) {
  const row = (await db.query('SELECT "settings" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1', [workspaceId]))[0];
  return resolveOpeningInterruptionRules(record(row?.settings).openingInterruptionRules);
}
export async function saveOpeningInterruptionRules(db: CrmDb, workspaceId: string, raw: unknown, expectedRevision: string) {
  const rules = openingInterruptionRulesSchema.parse(raw);
  return db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['opening-rules:' + workspaceId]);
    const current = await openingInterruptionRules(tx, workspaceId);
    if (openingRulesRevision(current) !== expectedRevision) throw new BadRequestError('规则已由其他管理员更新，请刷新规则后重新保存。');
    await tx.query(`INSERT INTO "WorkspaceCallPolicy" ("workspaceId","settings") VALUES ($1,jsonb_build_object('openingInterruptionRules',$2::jsonb))
      ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=COALESCE("WorkspaceCallPolicy"."settings",'{}'::jsonb)||jsonb_build_object('openingInterruptionRules',$2::jsonb),"updatedAt"=NOW() RETURNING "workspaceId"`, [workspaceId, JSON.stringify(rules)]);
    return rules;
  });
}
