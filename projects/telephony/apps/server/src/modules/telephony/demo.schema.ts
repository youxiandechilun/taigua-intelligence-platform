/*
 * 中文导读：线路与语音外呼：demo.schema.ts。定义请求数据结构与校验约束。
 */
import { z } from 'zod';
import { recipientSchema } from '../aliyun/aliyun.schema.js';
import { dialSelectionSchema } from './sip.schema.js';

const spokenText = z.string().trim().min(1, '请填写演示话术。').max(300, '每段演示话术最多300字。').refine(value => !/\{\{[^{}]+\}\}/u.test(value), '演示话术请填写完整，不要保留未填写的变量。');
export const demoLanguageSchema = z.enum(['zh-CN', 'en']);
export type DemoLanguage = z.infer<typeof demoLanguageSchema>;
export const demoLanguages: DemoLanguage[] = ['zh-CN', 'en'];
export const demoScriptSchema = z.object({
  opening: spokenText,
  voiceId: z.string().uuid().nullable().default(null),
  qa: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), question: spokenText, answer: spokenText }).strict()).min(1, '请至少添加一组问答。').max(30, '演示最多设置30组问答。'),
  fallback: spokenText,
}).strict().refine(value => new Set(value.qa.map(row => row.id)).size === value.qa.length, '问答编号不能重复。')
  .refine(value => new Set(value.qa.map(row => row.question)).size === value.qa.length, '请合并重复的问题。');
export type DemoLanguageConfiguration = z.infer<typeof demoScriptSchema>;
const draftText = z.string().trim().max(300, '每段演示话术最多300字。').refine(value => !/\{\{[^{}]+\}\}/u.test(value), '演示话术请填写完整，不要保留未填写的变量。');
const demoScriptDraftSchema = z.object({
  opening: draftText, voiceId: z.string().uuid().nullable().default(null),
  qa: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), question: draftText, answer: draftText }).strict()).max(30, '演示最多设置30组问答。'),
  fallback: draftText,
}).strict();
export const emptyDemoScript = (): DemoLanguageConfiguration => ({ opening: '', voiceId: null, qa: [], fallback: '' });
function emptyScript(value: DemoLanguageConfiguration) { return !value.opening && !value.fallback && !value.qa.length && value.voiceId === null; }
export const demoConfigurationSchema = z.object({
  version: z.literal(2),
  languages: z.object({ 'zh-CN': demoScriptDraftSchema, en: demoScriptDraftSchema }).strict(),
}).strict().superRefine((value, ctx) => {
  let ready = 0;
  for (const language of demoLanguages) {
    const script = value.languages[language];
    if (emptyScript(script)) continue;
    const parsed = demoScriptSchema.safeParse(script);
    if (parsed.success) ready++;
    else for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['languages', language, ...issue.path] });
  }
  if (!ready) ctx.addIssue({ code: 'custom', message: '请至少完整填写一套中文或英文演示话术。', path: ['languages'] });
});
export type DemoConfiguration = z.infer<typeof demoConfigurationSchema>;
export function readyDemoLanguages(configuration: DemoConfiguration): DemoLanguage[] { return demoLanguages.filter(language => demoScriptSchema.safeParse(configuration.languages[language]).success); }
// Read old rows without rewriting them. The QA body is authoritative when an
// old English demo retained the previous Chinese default fallback.
export function inferDemoLanguage(script: DemoLanguageConfiguration): DemoLanguage {
  const text = script.qa.length ? script.qa.map(row => row.question + '\n' + row.answer).join('\n') : script.opening + '\n' + script.fallback;
  const han = (text.match(/\p{Script=Han}/gu) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin > 0 && latin > han * 2 ? 'en' : 'zh-CN';
}
export function normalizeDemoConfiguration(raw: unknown): DemoConfiguration {
  if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 2) return demoConfigurationSchema.parse(raw);
  const script = demoScriptSchema.parse(raw), language = inferDemoLanguage(script);
  return { version: 2, languages: { 'zh-CN': emptyDemoScript(), en: emptyDemoScript(), [language]: structuredClone(script) } };
}
export const demoSaveSchema = z.object({ expectedRevision: z.number().int().min(0), configuration: demoConfigurationSchema }).strict();
export const demoPreviewSchema = z.object({ language: demoLanguageSchema, expectedRevision: z.number().int().positive(), key: z.string().min(1).max(104), requestId: z.string().uuid(), retryOf: z.string().uuid().optional(), confirmed: z.literal(true) }).strict();
export const demoCallSchema = z.object({
  requestId: z.string().uuid(), agentId: z.string().uuid(), language: demoLanguageSchema, phoneNumber: recipientSchema.shape.phoneNumber,
  ...dialSelectionSchema.shape,
  requestedAt: z.iso.datetime({ offset: true }), expectedRevision: z.number().int().positive(), confirmation: z.literal('拨打演示电话'),
}).strict();
