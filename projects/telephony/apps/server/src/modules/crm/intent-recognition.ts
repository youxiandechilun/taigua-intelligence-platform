/*
 * 中文导读：客户管理：intent-recognition.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import { resolveOpeningInterruptionRules } from '../telephony/opening-interruption-rules.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { buildAssistantAnnouncementHead, isAutomaticAnnouncement, matchesAssistantAnnouncementKeyword, matchesAssistantKeywordText } from './assistant-announcement.js';
import { customerIntentEvidence, finalCallIntent, isContactCheckOnly, qualifiedInterestQuote } from '../calllogs/call-analysis.js';
import type { CrmDb, Row } from './crm.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';

export const intentLabels = ['interested', 'unclear', 'uninterested', 'optout'] as const;
export type IntentLabel = (typeof intentLabels)[number];

export const intentRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  intent: z.enum(intentLabels),
  keywords: z.array(z.string().trim().min(1).max(80)).default([]),
  // New UI name; keywords remains for snapshots created before the rules page.
  positiveKeywords: z.array(z.string().trim().min(1).max(80)).default([]),
  negativeKeywords: z.array(z.string().trim().min(1).max(80)).default([]),
  matchMode: z.enum(['any', 'all', 'phrase']).default('any'),
  priority: z.number().int().min(0).max(1000).default(100),
  enabled: z.boolean().default(true),
  applyTo: z.array(z.enum(['outbound', 'demo', 'manual', 'assistant'])).max(4).default(['outbound', 'demo', 'manual', 'assistant']),
  replyHint: z.string().trim().max(500).nullable().optional(),
  action: z.string().trim().max(200).nullable().optional(),
}).strict();
export type IntentRule = z.infer<typeof intentRuleSchema>;

export const intentRulesSchema = z.array(intentRuleSchema).max(100);

export const defaultIntentRules: IntentRule[] = [
  {
    id: 'builtin.optout',
    name: '明确拒绝联系',
    intent: 'optout',
    keywords: ['不要再打', '别再打', '不再联系', '不要再联系', '不要联系', '拒绝联系', '别联系我'],
    positiveKeywords: ['不要再打', '别再打', '不再联系', '不要再联系', '不要联系', '拒绝联系', '别联系我'],
    negativeKeywords: [],
    matchMode: 'any',
    priority: 1000,
    enabled: true,
    applyTo: ['outbound', 'demo', 'manual', 'assistant'],
  },
  {
    id: 'builtin.uninterested',
    name: '明确暂时无需求',
    intent: 'uninterested',
    keywords: ['没兴趣', '不感兴趣', '没有需求', '暂时不需要', '不用了', '不考虑'],
    positiveKeywords: ['没兴趣', '不感兴趣', '没有需求', '暂时不需要', '不用了', '不考虑'],
    negativeKeywords: [],
    matchMode: 'any',
    priority: 900,
    enabled: true,
    applyTo: ['outbound', 'demo', 'manual', 'assistant'],
  },
  {
    id: 'builtin.interested',
    name: '明确表达了解或合作意愿',
    intent: 'interested',
    keywords: ['有兴趣', '感兴趣', '想了解', '需要了解', '可以发资料', '加微信', '联系我', '怎么合作'],
    positiveKeywords: ['有兴趣', '感兴趣', '想了解', '需要了解', '可以发资料', '加微信', '联系我', '怎么合作'],
    negativeKeywords: ['没兴趣', '不感兴趣', '没有需求', '不要联系', '要不要收费'],
    matchMode: 'any',
    priority: 700,
    enabled: true,
    applyTo: ['outbound', 'demo', 'manual', 'assistant'],
  },
];

const compact = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const displayText = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, 6000);
const compactList = (values: string[]) => [...new Set(values.map(compact).filter(Boolean))];

// A short affirmative is an independent answer, never a substring of a
// longer sentence such as “进行通知” or a confirmation of audibility.
const weakAffirmatives = ['allright', 'alright', '非常可以', '可以的', '可以啊', '没问题', '没事', 'okay', 'yeah', 'sure', 'yep', 'yes', '好的', '好啊', '好呀', '好吧', '好嘞', '可以', '行的', '行啊', '对的', '是的', '同意', '嗯嗯', 'ok', '好', '行', '嗯', '对', '是', '中'];
function intentKeywordPresent(text: string, keyword: string, positive: boolean, original: string, acceptsInvitation: boolean) {
  if (!text.includes(keyword)) return false;
  if (!positive || (Array.from(keyword).length > 1 && !weakAffirmatives.includes(keyword))) return true;
  // The shared qualifier already checks the complete reply and its adjacent
  // invitation. Requiring bare tokens again would discard a qualified ASR
  // echo such as "好，了解一下吗？" after the bridge accepted it.
  return acceptsInvitation && Array.from(text).length <= 32;
}

function hasNearbyNegation(text: string, keyword: string, negatives: string[], positiveIntent = false) {
  if (negatives.some(value => text.includes(value))) return true;
  if (!positiveIntent) return false;
  const at = text.indexOf(keyword);
  if (at < 0) return false;
  // Match the bridge's ten-rune window, including supplementary characters.
  const before = Array.from(text.slice(0, at)).slice(-10).join('');
  return ['不', '没', '无', '别', '不要', '不用', '不想', '不感兴趣', '不需要', '暂时不', '不考虑', '拒绝'].some(value => before.includes(value));
}

export type IntentMatch = {
  intent: IntentLabel;
  rules: Array<{ id: string; name: string; intent: IntentLabel; keyword: string; priority: number }>;
  evidence: string;
};

export function matchIntent(text: string, rules: IntentRule[] = defaultIntentRules, scope?: 'outbound' | 'demo' | 'manual' | 'assistant', previousAgent = ''): IntentMatch | null {
  const original = displayText(text);
  const normalized = compact(original);
  if (!normalized) return null;
  const contactCheck = isContactCheckOnly(original) || isAutomaticAnnouncement(original);
  const acceptsInvitation = !contactCheck && !!previousAgent && !!qualifiedInterestQuote([{ speaker: 'agent', messageText: previousAgent }, { speaker: 'customer', messageText: original }]);
  const candidates: IntentMatch['rules'] = [];
  for (const rule of rules.filter(item => item.enabled)) {
    if (rule.intent === 'interested' && contactCheck) continue;
    if (scope && rule.applyTo.length > 0 && !rule.applyTo.includes(scope) && !(scope !== 'manual' && rule.applyTo.includes('assistant'))) continue;
    const negatives = compactList(rule.negativeKeywords);
    const keywords = compactList(rule.keywords.length ? rule.keywords : rule.positiveKeywords);
    if (!keywords.length) continue;
    if (rule.matchMode === 'all' && !keywords.every(keyword => intentKeywordPresent(normalized, keyword, rule.intent === 'interested', original, acceptsInvitation) && !hasNearbyNegation(normalized, keyword, negatives, rule.intent === 'interested'))) continue;
    for (const rawKeyword of keywords) {
      if (!intentKeywordPresent(normalized, rawKeyword, rule.intent === 'interested', original, acceptsInvitation)) continue;
      if (hasNearbyNegation(normalized, rawKeyword, negatives, rule.intent === 'interested')) continue;
      candidates.push({ id: rule.id, name: rule.name, intent: rule.intent, keyword: rawKeyword, priority: rule.priority });
    }
  }
  if (!candidates.length) return null;
  const rank: Record<IntentLabel, number> = { optout: 4, uninterested: 3, interested: 2, unclear: 1 };
  candidates.sort((a, b) => b.priority - a.priority || rank[b.intent] - rank[a.intent] || b.keyword.length - a.keyword.length);
  const winner = candidates[0]!;
  return {
    intent: winner.intent,
    rules: candidates.filter(item => item.intent === winner.intent).slice(0, 12),
    evidence: original.slice(0, 600),
  };
}

export async function intentRules(db: CrmDb, workspaceId: string): Promise<IntentRule[]> {
  const row = (await db.query('SELECT "settings" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1', [workspaceId]))[0];
  const saved = row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
    ? (row.settings as Record<string, unknown>).intentRules
    : null;
  const parsed = intentRulesSchema.safeParse(saved);
  return parsed.success ? parsed.data : defaultIntentRules;
}

export async function saveIntentRules(db: CrmDb, workspaceId: string, raw: unknown): Promise<IntentRule[]> {
  const rules = intentRulesSchema.parse(raw);
  await db.query(`INSERT INTO "WorkspaceCallPolicy" ("workspaceId","settings")
    VALUES ($1,jsonb_build_object('intentRules',$2::jsonb))
    ON CONFLICT ("workspaceId") DO UPDATE SET
      "settings"=COALESCE("WorkspaceCallPolicy"."settings",'{}'::jsonb)||jsonb_build_object('intentRules',$2::jsonb),
      "updatedAt"=NOW()
    RETURNING "workspaceId"`, [workspaceId, JSON.stringify(rules)]);
  return rules;
}

export async function mutateIntentRules(db: CrmDb, workspaceId: string, mutate: (rules: IntentRule[]) => IntentRule[]): Promise<IntentRule[]> {
  return db.transaction(async tx => {
    await tx.query('INSERT INTO "WorkspaceCallPolicy" ("workspaceId","settings") VALUES ($1,\'{}\'::jsonb) ON CONFLICT ("workspaceId") DO NOTHING RETURNING "workspaceId"', [workspaceId]);
    await tx.query('SELECT "workspaceId" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1 FOR UPDATE', [workspaceId]);
    return saveIntentRules(tx, workspaceId, mutate(await intentRules(tx, workspaceId)));
  });
}

// A mobile assistant or voicemail is an answering party, not a customer intent.
// Keep these settings independent so an assistant announcement can never become
// an interested lead merely because it offers to take a message.
export const assistantDetectionRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(120)).min(1),
  negativeKeywords: z.array(z.string().trim().min(1).max(120)).default([]),
  enabled: z.boolean().default(true),
  matchMode: z.enum(['semantic', 'keyword']).default('semantic'),
}).strict();
export type AssistantDetectionRule = z.infer<typeof assistantDetectionRuleSchema>;
export const assistantDetectionRulesSchema = z.array(assistantDetectionRuleSchema).max(100).superRefine((rules, ctx) => {
  const seen = new Set<string>();
  for (let index = 0; index < rules.length; index++) {
    if (seen.has(rules[index]!.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: '规则标识不能重复。' });
    seen.add(rules[index]!.id);
  }
});

const assistantMentionExclusions = ['我不是语音助手', '我不是智能助手', '我不是智能助理', '不是代接', '不是语音信箱', '我用的语音助手', '我自己的语音助手', '你是语音助手吗', '你是智能助手吗'];
export const defaultAssistantDetectionRules: AssistantDetectionRule[] = [
  {
    "id": "builtin.assistant.voicemail",
    "matchMode": "semantic",
    "name": "语音信箱和留言播报",
    "keywords": [
      "转至语音留言",
      "转到语音留言",
      "转入语音留言",
      "转至语音信箱",
      "转入语音信箱",
      "话已转至语音留言",
      "话已转到语音留言",
      "话已转入语音留言",
      "话已转至语音信箱",
      "电话已转至语音留言",
      "电话已转入语音信箱",
      "已转至语音留言",
      "已转到语音留言",
      "已转入语音留言",
      "已转至语音信箱",
      "已转入语音信箱",
      "通话已转入语音留言",
      "你尝试联系的用户无法接听",
      "您尝试联系的用户无法接听",
      "您的呼叫现在无法接听",
      "您的呼叫暂时无法接听",
      "本次呼叫.*通知",
      "此次呼叫.*通知",
      "通话已转至语音留言",
      "通话已转到语音留言",
      "您的通话已转至语音留言",
      "您拨打的电话已转入语音信箱",
      "您拨打的电话已转至语音信箱",
      "欢迎使用语音信箱",
      "这里是语音信箱",
      "请在提示音后留言",
      "请在提示音后录制留言",
      "请在嘟声后留言",
      "请在滴声后留言",
      "我是语音信箱",
      "thepersonyouaretryingtoreachisunavailable",
      "yourcallhasbeenforwardedtovoicemail",
      "pleaseleaveamessageafterthetone",
      "语音留言",
      "语音信箱",
      "语音流言"
    ],
    "negativeKeywords": [
      "我不是语音助手",
      "我不是智能助手",
      "我不是智能助理",
      "不是代接",
      "不是语音信箱",
      "我用的语音助手",
      "我自己的语音助手",
      "你是语音助手吗",
      "你是智能助手吗"
    ],
    "enabled": true
  },
  {
    "id": "builtin.assistant.explicit",
    "matchMode": "semantic",
    "name": "明确智能代接播报",
    "keywords": [
      "我是机器人助手",
      "我是智能电话助手",
      "我是机主的电话助理",
      "我是机主的语音助手",
      "我是小爱同学",
      "我是小艾同学",
      "我是小爱电话助理",
      "我是小艺通话助手",
      "我是智能接听助理",
      "我是智能接听助手",
      "我是电话代接助手",
      "我是语音代接助手"
    ],
    "negativeKeywords": [
      "我不是语音助手",
      "我不是智能助手",
      "我不是智能助理",
      "不是代接",
      "不是语音信箱",
      "我用的语音助手",
      "我自己的语音助手",
      "你是语音助手吗",
      "你是智能助手吗"
    ],
    "enabled": true
  },
  {
    "id": "builtin.assistant.named",
    "matchMode": "semantic",
    "name": "手机助手代接声明",
    "keywords": [
      "机主的智能助理",
      "机主的智能助手",
      "机主的电话助理",
      "机主的语音助手",
      "主人的智能助理",
      "主人的智能助手",
      "小爱同学",
      "小艾同学",
      "小爱电话助理",
      "小艺通话助手",
      "机器人助手",
      "智能电话助手",
      "智能接听助理",
      "智能接听助手",
      "电话代接助手",
      "语音代接助手",
      "小爱",
      "小艾",
      "小艺",
      "小布",
      "小v",
      "语音助手",
      "智能助理",
      "智能助手",
      "电话助理",
      "接听助理",
      "接听助手",
      "通话助手"
    ],
    "negativeKeywords": [
      "我不是语音助手",
      "我不是智能助手",
      "我不是智能助理",
      "不是代接",
      "不是语音信箱",
      "我用的语音助手",
      "我自己的语音助手",
      "你是语音助手吗",
      "你是智能助手吗"
    ],
    "enabled": true
  },
  {
    id: 'builtin.assistant.screening', name: '无身份代接和留言指令',
    keywords: ['请留下.*姓名.*来电原因', '我会帮你确认.*是否方便接听', '我会帮您确认.*是否方便接听', '此人暂时无法接听.*提示音后', '若要留言.*提示音后', '请在提示音后.*回复'],
    negativeKeywords: assistantMentionExclusions, matchMode: 'semantic', enabled: true,
  }
];

export type AssistantDetectionMatch = {
  detected: true;
  rules: Array<{ id: string; name: string; keyword: string }>;
  evidence: string;
};

export const assistantDetectionResultSchema = z.object({
  detected: z.literal(true),
  rules: z.array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), keyword: z.string().min(1).max(120) }).strict()).max(100),
  evidence: z.string().max(6000),
  at: z.iso.datetime(),
  messageId: z.string().min(1).max(200),
}).strict();

// Machine results must not retain a customer-intent fallback from earlier turns.
export const clearRecognitionIntentSql = `-'intent'-'intentEvidence'-'matchedIntent'-'matchedRules'-'matchedEvidence'-'provisionalIntent'-'provisionalRules'-'provisionalEvidence'-'provisionalAt'-'provisionalMessageId'-'liveIntentEligible'`;

const boundAssistantText = (value: string, limit: number) => [...value].slice(0, limit).join('');

export type AssistantDetectionDiagnostic = {
  id: string;
  name: string;
  matchMode: 'semantic' | 'keyword';
  status: 'matched' | 'semantic_not_confirmed' | 'excluded' | 'disabled' | 'no_keyword';
  keyword?: string;
  negativeKeyword?: string;
};

// The preview and live recognition use this same decision path. Diagnostics
// are built only for the settings preview, never for each live ASR fragment.
export function evaluateAssistantDetection(text: string, rules: AssistantDetectionRule[] = defaultAssistantDetectionRules, explain = false): { matched: AssistantDetectionMatch | null; diagnostics: AssistantDetectionDiagnostic[] } {
  const original = displayText(text);
  const normalized = compact(original);
  const diagnostics: AssistantDetectionDiagnostic[] = [];
  if (!normalized) return { matched: null, diagnostics };
  const quoted = /[“”‘’「」『』"']/u.test(original);
  const announcement = buildAssistantAnnouncementHead(normalized);
  const matches: AssistantDetectionMatch['rules'] = [];
  for (const rule of rules) {
    const matchMode = rule.matchMode ?? 'semantic';
    const negativeKeyword = rule.negativeKeywords.find(phrase => compact(phrase) && normalized.includes(compact(phrase)));
    if (!explain && (!rule.enabled || negativeKeyword)) continue;
    let literalKeyword: string | undefined;
    let ruleMatched = false;
    for (const keyword of rule.keywords) {
      const literal = (explain || matchMode === 'keyword') && matchesAssistantKeywordText(normalized, keyword);
      if (literal && !literalKeyword) literalKeyword = keyword;
      const accepted = matchMode === 'keyword' ? literal : !quoted && matchesAssistantAnnouncementKeyword(announcement, keyword, rule.id === 'builtin.assistant.named');
      if (rule.enabled && !negativeKeyword && accepted) {
        ruleMatched = true;
        if (matches.length >= 12) continue;
        matches.push({ id: rule.id, name: rule.name, keyword });
        if (!explain && matches.length >= 12) return { matched: { detected: true, rules: matches, evidence: boundAssistantText(original, 600) }, diagnostics };
      }
    }
    if (explain) diagnostics.push({ id: rule.id, name: rule.name, matchMode, status: ruleMatched ? 'matched' : !literalKeyword ? 'no_keyword' : !rule.enabled ? 'disabled' : negativeKeyword ? 'excluded' : 'semantic_not_confirmed', ...(literalKeyword ? { keyword: literalKeyword } : {}), ...(negativeKeyword ? { negativeKeyword } : {}) });
  }
  return { matched: matches.length ? { detected: true, rules: matches, evidence: boundAssistantText(original, 600) } : null, diagnostics };
}

export function matchAssistantDetection(text: string, rules: AssistantDetectionRule[] = defaultAssistantDetectionRules): AssistantDetectionMatch | null {
  return evaluateAssistantDetection(text, rules).matched;
}

export async function assistantDetectionRules(db: CrmDb, workspaceId: string): Promise<AssistantDetectionRule[]> {
  const row = (await db.query('SELECT "settings" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1', [workspaceId]))[0];
  const parsed = assistantDetectionRulesSchema.safeParse(record(row?.settings).assistantDetectionRules);
  return parsed.success ? parsed.data : defaultAssistantDetectionRules;
}

export async function saveAssistantDetectionRules(db: CrmDb, workspaceId: string, raw: unknown, expectedRevision?: string): Promise<AssistantDetectionRule[]> {
  const rules = assistantDetectionRulesSchema.parse(raw);
  await db.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['assistant-detection-rules:'+workspaceId]);
    assertConfigurationRevision(expectedRevision,await assistantDetectionRules(tx,workspaceId));
    await tx.query(`INSERT INTO "WorkspaceCallPolicy" ("workspaceId","settings")
      VALUES ($1,jsonb_build_object('assistantDetectionRules',$2::jsonb))
      ON CONFLICT ("workspaceId") DO UPDATE SET
        "settings"=COALESCE("WorkspaceCallPolicy"."settings",'{}'::jsonb)||jsonb_build_object('assistantDetectionRules',$2::jsonb),
        "updatedAt"=NOW() RETURNING "workspaceId"`,[workspaceId,JSON.stringify(rules)]);
  });
  return rules;
}
export {configurationRevision as assistantRulesRevision};

export async function recognitionRules(db: CrmDb, workspaceId: string) {
  const row = (await db.query('SELECT "settings" FROM "WorkspaceCallPolicy" WHERE "workspaceId"=$1', [workspaceId]))[0];
  const settings = record(row?.settings);
  const intent = intentRulesSchema.safeParse(settings.intentRules);
  const assistant = assistantDetectionRulesSchema.safeParse(settings.assistantDetectionRules);
  return { intentRules: intent.success ? intent.data : defaultIntentRules, assistantDetectionRules: assistant.success ? assistant.data : defaultAssistantDetectionRules, openingInterruptionRules: resolveOpeningInterruptionRules(settings.openingInterruptionRules) };
}

// Each dispatch captures the latest workspace rules. The attempt owns its
// immutable copy, so an ongoing conversation never switches rules mid-call.
export async function freezeAttemptRecognitionRules(db: CrmDb, workspaceId: string) {
  const rules = await recognitionRules(db, workspaceId);
  return { version: 1 as const, source: 'workspace' as const,
    revision: createHash('sha256').update(JSON.stringify(rules)).digest('hex'),
    frozenAt: new Date().toISOString(), ...rules };
}

export function attemptRecognitionRules(result: Record<string, unknown>, rawSnapshot: unknown) {
  const frozen = record(result.recognitionRules), snapshot = record(rawSnapshot);
  // Calls dispatched by the older bridge keep their task snapshot. Explicit
  // empty arrays remain a deliberate choice to disable keyword recognition.
  const source = frozen.version === 1 ? frozen : snapshot;
  const intent = intentRulesSchema.safeParse(source.intentRules);
  const assistant = assistantDetectionRulesSchema.safeParse(source.assistantDetectionRules);
  return { intentRules: intent.success ? intent.data : defaultIntentRules,
    assistantDetectionRules: assistant.success ? assistant.data : defaultAssistantDetectionRules };
}

function recognitionScope(rawSnapshot: unknown): 'outbound' | 'demo' | 'manual' {
  const snapshot = record(rawSnapshot);
  return snapshot.mode === 'MANUAL' ? 'manual' : snapshot.demoCall === true || snapshot.testCall === true ? 'demo' : 'outbound';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const resultSchema = z.object({
  provisionalIntent: z.enum(intentLabels).optional(),
  provisionalRules: z.array(z.object({ id: z.string(), name: z.string(), intent: z.enum(intentLabels), keyword: z.string(), priority: z.number() }).strict()).optional(),
  provisionalEvidence: z.string().optional(),
  provisionalAt: z.string().optional(),
  provisionalMessageId: z.string().optional(),
}).passthrough();

export const liveIntentInputSchema = z.object({
  attemptId: z.string().uuid(),
  messageId: z.string().trim().min(1).max(200),
  speaker: z.enum(['customer', 'user', 'agent']).default('customer'),
  scope: z.enum(['outbound', 'demo', 'manual', 'assistant']).optional(),
  text: z.string().trim().min(1).max(6000),
  previousAgent: z.string().trim().max(6000).optional(),
  timestamp: z.iso.datetime(),
}).strict();

// Bounded signed customer turns support conservative provisional display.
// They never grant contact consent or replace the terminal transcript/analysis.
const liveTurnSchema = z.object({ messageId: z.string(), timestamp: z.string(), messageText: z.string(), previousAgent: z.string().optional() });

export async function ingestLiveIntent(db: CrmDb, raw: unknown) {
  const input = liveIntentInputSchema.parse(raw);
  if (input.speaker === 'agent') return { saved: false, matched: null, ignored: 'agent_transcript' as const };
  return db.transaction(async tx => {
    const attempt = (await tx.query(`SELECT a."id",a."workspaceId",a."taskId",a."status",a."result",t."snapshot",t."recipients",t."createdBy"
      FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId"
      WHERE a."id"=$1 FOR UPDATE OF a`, [input.attemptId]))[0] as Row | undefined;
    if (!attempt) throw new BadRequestError('实时转写未关联本系统通话。');
    if (!['DISPATCHING', 'DIALING', 'CONNECTED'].includes(String(attempt.status))) {
      return { saved: false, matched: null, ignored: 'call_not_active' as const };
    }
    const previous = record(attempt.result);
    const priorAssistant = record(previous.assistantDetection);
    if (priorAssistant.detected === true) return { saved: false, matched: null, assistantDetection: priorAssistant, ignored: 'assistant_already_detected' as const };
    const frozenRules = attemptRecognitionRules(previous, attempt.snapshot);
    const parsedTurns = z.array(liveTurnSchema).safeParse(previous.liveRecognitionTurns);
    const turns = parsedTurns.success ? parsedTurns.data : [];
    let fragment = input.text;
    if (!input.previousAgent) for (const turn of turns.slice(-4).reverse()) {
      const age = Date.parse(input.timestamp) - Date.parse(turn.timestamp);
      if (age < 0 || age > 10000) break;
      fragment = (turn.messageText + fragment).slice(-6000);
      if (turn.previousAgent) break;
    }
    const assistant = matchAssistantDetection(input.text, frozenRules.assistantDetectionRules)
      || matchAssistantDetection(fragment, frozenRules.assistantDetectionRules);
    if (assistant) {
      const detected = { ...assistant, at: input.timestamp, messageId: input.messageId };
      const payload = { answeringMachineDetected: true, assistantDetection: detected, liveIntentEligible: false, reason: 'ANSWERING_MACHINE', flowOutcome: 'neutral', handoffRequested: false, doNotCallRequested: false };
      await tx.query(`UPDATE "SipAttempt" SET "result"=(COALESCE("result",'{}'::jsonb)${clearRecognitionIntentSql})||$2::jsonb WHERE "id"=$1 RETURNING "id"`, [input.attemptId, JSON.stringify(payload)]);
      const call = await tx.query(`UPDATE "CallLog" SET "metadata"=(COALESCE("metadata",'{}'::jsonb)${clearRecognitionIntentSql})||$3::jsonb WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false RETURNING "callId"`, [attempt.workspaceId, input.attemptId, JSON.stringify({ ...payload, disposition: 'ANSWERING_MACHINE' })]);
      return { saved: true, matched: null, assistantDetection: detected, callLogUpdated: call.length > 0 };
    }
    const old = resultSchema.parse(previous);
    if (turns.some(turn => turn.messageId === input.messageId) || old.provisionalMessageId === input.messageId) {
      return { saved: false, matched: null, duplicate: true };
    }
    turns.push({ messageId: input.messageId, timestamp: input.timestamp, messageText: input.text.slice(0, 600), ...(input.previousAgent ? { previousAgent: input.previousAgent } : {}) });
    turns.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.messageId.localeCompare(b.messageId));
    const history = turns.slice(-40);
    const matched = matchIntent(input.text, frozenRules.intentRules, recognitionScope(attempt.snapshot), input.previousAgent);
    const rank: Record<IntentLabel, number> = { optout: 4, uninterested: 3, interested: 2, unclear: 1 };
    const selected = old.provisionalIntent && (!matched || rank[old.provisionalIntent] > rank[matched.intent]) ? old.provisionalIntent : matched?.intent;
    const replaceEvidence = matched && selected === matched.intent && (!old.provisionalAt || Date.parse(input.timestamp) >= Date.parse(old.provisionalAt) || selected !== old.provisionalIntent);
    const provisional = selected ? {
      provisionalIntent: selected,
      provisionalRules: replaceEvidence ? matched.rules : old.provisionalRules || [],
      provisionalEvidence: replaceEvidence ? matched.evidence.slice(0, 600) : old.provisionalEvidence || '',
      provisionalAt: replaceEvidence ? input.timestamp : old.provisionalAt || input.timestamp,
      provisionalMessageId: replaceEvidence ? input.messageId : old.provisionalMessageId || input.messageId,
    } : {};
    const rows = history.flatMap(turn => [...(turn.previousAgent ? [{ speaker: 'agent', messageText: turn.previousAgent }] : []), { speaker: 'customer', messageText: turn.messageText }]);
    // Preserve the selected quote even after a long call rolls the bounded
    // history forward; refusal/third-party vetoes are sticky for this attempt.
    if ('provisionalEvidence' in provisional && provisional.provisionalEvidence && !rows.some(row => row.messageText === provisional.provisionalEvidence)) rows.unshift({ speaker: 'customer', messageText: provisional.provisionalEvidence });
    const groundedMetadata = { ...previous, ...provisional };
    const evidence = customerIntentEvidence(rows, groundedMetadata);
    const blockedReason = ['DO_NOT_CALL', 'ANSWERING_ASSISTANT', 'CUSTOMER_REFUSAL', 'CUSTOMER_DEFERRAL', 'THIRD_PARTY_OR_RELAY'].includes(evidence.blockedReason || '') ? evidence.blockedReason : previous.liveRecognitionBlockedReason || null;
    const liveIntentEligible = !blockedReason && selected === 'interested' && finalCallIntent(undefined, groundedMetadata, rows) === 'INTERESTED';
    const payload = { ...provisional, liveRecognitionTurns: history, liveRecognitionBlockedReason: blockedReason, liveIntentEligible };
    await tx.query(`UPDATE "SipAttempt" SET "result"=COALESCE("result",'{}'::jsonb)||$2::jsonb WHERE "id"=$1 RETURNING "id"`, [input.attemptId, JSON.stringify(payload)]);
    const call = await tx.query(`UPDATE "CallLog" SET "metadata"=COALESCE("metadata",'{}'::jsonb)||$3::jsonb
      WHERE "organizationId"=$1 AND "callId"=$2 AND "deleted"=false RETURNING "callId"`, [attempt.workspaceId, input.attemptId, JSON.stringify({ ...provisional,
        ...('provisionalRules' in provisional ? { matchedRules: provisional.provisionalRules, matchedEvidence: provisional.provisionalEvidence } : {}),
        liveRecognitionBlockedReason: blockedReason, liveIntentEligible })]);
    return { saved: true, matched: selected ? { intent: selected, rules: 'provisionalRules' in provisional ? provisional.provisionalRules : [], evidence: 'provisionalEvidence' in provisional ? provisional.provisionalEvidence : '' } : null,
      liveIntentEligible, callLogUpdated: call.length > 0 };
  });
}
