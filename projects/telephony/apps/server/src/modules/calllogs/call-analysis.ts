/*
 * 中文导读：通话记录：call-analysis.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { isAutomaticAnnouncement } from '../crm/assistant-announcement.js';

export const callSummarySchema = z.object({
  summary: z.string().min(1).max(1500),
  need: z.string().max(600),
  intent: z.enum(['INTERESTED', 'FOLLOW_UP', 'NO_NEED', 'OPT_OUT', 'UNKNOWN']),
  handoff: z.boolean(),
  reason: z.string().max(600),
  nextAction: z.string().max(600),
  evidence: z.object({
    summary: z.array(z.string().min(1).max(600)).max(6),
    need: z.array(z.string().min(1).max(600)).max(4),
    intent: z.array(z.string().min(1).max(600)).max(4),
    handoff: z.array(z.string().min(1).max(600)).max(4),
  }).strict().optional(),
  quality: z.object({
    outcome: z.enum(['GOOD', 'NEEDS_IMPROVEMENT', 'INSUFFICIENT']),
    summary: z.string().min(1).max(1000),
    issues: z.array(z.object({ issue: z.string().max(300), evidence: z.string().max(600), suggestion: z.string().max(600) }).strict()).max(8),
  }).strict().optional(),
}).strict();

const intents = { INTERESTED: '有意向', FOLLOW_UP: '待跟进', NO_NEED: '暂无需求', OPT_OUT: '拒绝再次联系', UNKNOWN: '尚不明确' };
export type CallSummary = z.infer<typeof callSummarySchema>;
export type TranscriptLine = { speaker: string; messageText: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// These whole utterances only establish who answered or who is calling. A
// keyword embedded in "你好" cannot establish business interest. Do not include
// "好", "可以" or "行": they can accept an explicit invitation in context.
const contactCheckTokens = [
  '我想问一下', '麻烦问一下', '请问一下', '请问', '问一下',
  '你好', '您好', '你们好', '您们好', '早上好', '下午好', '晚上好', '哈喽', '哈罗', '喂',
  '你是哪位', '您是哪位', '你哪位', '您哪位', '哪位',
  '你是谁', '您是谁', '你们是谁', '谁',
  '你是哪里的', '您是哪里的', '你们是哪里的', '你是哪里', '您是哪里', '你们是哪里',
  '你这是哪里', '您这是哪里', '你这边是哪里', '你们这边是哪里', '这是哪里', '你哪里', '您哪里', '哪里',
  '你是哪家公司的', '您是哪家公司的', '你们是哪家公司的',
  '你是哪家公司', '您是哪家公司', '你们是哪家公司', '哪家公司',
  '你是哪个公司的', '您是哪个公司的', '你们是哪个公司的',
  '你是哪个公司', '您是哪个公司', '你们是哪个公司', '哪个公司的',
  '你是哪家的', '您是哪家的', '你们是哪家的', '你是哪家', '您是哪家', '你们是哪家', '哪家',
  '你是什么单位', '您是什么单位', '你们是什么单位', '什么单位',
  '你是哪个单位', '您是哪个单位', '你们是哪个单位', '哪个单位',
  '你是哪边的', '您是哪边的', '你们是哪边的', '哪边的',
  '哪里打来的', '哪边打来的', '哪家公司打来的',
  '您找哪位', '你找哪位', '您找谁', '你找谁', '找谁',
  '您有什么事情', '你有什么事情', '有什么事情', '什么事情',
  '您有什么事', '你有什么事', '有什么事', '什么事',
  '你们是干什么的', '你是干什么的', '您是干什么的', '干什么的',
  '你们是做什么的', '你是做什么的', '您是做什么的', '你们做什么的', '做什么的',
  'whereareyoucallingfrom', 'whocompanyareyoufrom', 'whichcompanyareyoufrom',
  'whoiscalling', 'whoscalling', 'whoisthis', 'whosthis', 'whoareyou', 'hello', 'hiya', 'hi',
  '嗯', '啊', '呀', '哦', '噢', '喔', '哎', '诶', '呢', '吗',
].sort((a, b) => b.length - a.length);

export function isContactCheckOnly(text: string): boolean {
  if (isAudioCheckOnly(text)) return true;
  let remaining = text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!remaining || remaining.length > 320) return false;
  // Consume literal tokens instead of a repeated alternation, so punctuation
  // removal and a long unmatched suffix cannot create regex backtracking.
  while (remaining) {
    const token = contactCheckTokens.find(value => remaining.startsWith(value));
    if (!token) return false;
    remaining = remaining.slice(token.length);
  }
  return true;
}

// Hearing checks establish the connection, not an interest in the offer. Keep
// whole-utterance semantics so a real request after a hearing check survives.
export function isAudioCheckOnly(text: string): boolean {
  let remaining = text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!remaining || remaining.length > 320) return false;
  if (/^(?:yes|yeah|okay|ok|hello|hi)?(?:icanhearyou|canyouhearme|ihearyou|hearyounow|loudandclear|thesoundisclear|theaudioisclear)(?:now|yes|okay|ok|thanks)?$/u.test(remaining)) return true;
  if (!/听得到|听得见|听到了|听到|听见|听清|听不清|听不到|听不见|有声音|没声音|声音清楚|声音正常|信号/u.test(remaining)) return false;
  const tokens = ['听得到', '听得见', '听到了', '听到', '听见', '听清楚', '听清', '听不清', '听不到', '听不见', '有声音', '没声音', '声音清楚', '声音正常', '信号不好', '信号', '我这边', '你这边', '您这边', '这边', '那边', '现在', '刚刚', '刚才', '已经', '好的', '可以', '你好', '您好', '是的', '我', '你', '您', '能', '好', '对', '了', '吗', '啊', '呀', '吧', '呢', '喂', '嗯', '哦', '噢'].sort((a, b) => b.length - a.length);
  while (remaining) {
    const token = tokens.find(value => remaining.startsWith(value));
    if (!token) return false;
    remaining = remaining.slice(token.length);
  }
  return true;
}

export function hasOnlyContactChecks(rows: TranscriptLine[]): boolean {
  const customers = rows.filter(row => ['customer', 'user'].includes(row.speaker.toLowerCase()) && row.messageText.trim());
  return customers.length > 0 && customers.every(row => isContactCheckOnly(row.messageText));
}

export function isAnsweringMachine(metadata: unknown): boolean {
  const meta = object(metadata);
  return meta.answeringMachineDetected === true || object(meta.assistantDetection).detected === true || meta.disposition === 'ANSWERING_MACHINE';
}

// Completed refusals, explicit do-not-call requests and transcript-backed
// negative rule conclusions take precedence over positive provisional labels.
export function finalCallIntent(intent: CallSummary['intent'] | undefined, metadata: unknown, rows: TranscriptLine[] = []): CallSummary['intent'] {
  const meta = object(metadata);
  if (isAnsweringMachine(meta) || answeredByAssistant(rows, meta)) return 'UNKNOWN';
  const matched = verifiedRuleConclusion(meta, rows);
  if (meta.doNotCallRequested === true || intent === 'OPT_OUT' || matched?.intent === 'OPT_OUT') return 'OPT_OUT';
  if (intent === 'NO_NEED' || matched?.intent === 'NO_NEED') return 'NO_NEED';
  // This also fences model labels and flow outcomes, not just keyword rules.
  // It is call-local and never changes an existing customer or manual decision.
  if (hasOnlyContactChecks(rows)) return 'UNKNOWN';
  const customerEvidence = customerIntentEvidence(rows, meta);
  if (customerEvidence.explicitRefusal) return 'NO_NEED';
  const result = matched && matched.intent !== 'UNKNOWN' && (!intent || intent === 'UNKNOWN' || intent === 'FOLLOW_UP')
    ? matched.intent : intent || matched?.intent || ({ interested: 'INTERESTED', follow_up: 'FOLLOW_UP', declined: 'NO_NEED', neutral: 'UNKNOWN' } as const)[String(meta.flowOutcome) as 'interested'] || 'UNKNOWN';
  // Every positive source shares this gate: keyword, bridge flow, model and
  // older in-flight provisional values all need actual business acceptance.
  if (result === 'INTERESTED' && (!customerEvidence.interest || customerEvidence.blockedReason)) return customerEvidence.refusal ? 'FOLLOW_UP' : 'UNKNOWN';
  return result;
}

const compact = (text: string) => text.replace(/\s+/gu, '');
function verifiedQuotes(quotes: string[] | undefined, rows: TranscriptLine[]) {
  const customers = rows.filter(row => ['customer', 'user'].includes(row.speaker.toLowerCase()));
  return [...new Set((quotes || []).map(quote => quote.trim()).filter(quote => compact(quote).length >= 2 && customers.some(row => compact(row.messageText).includes(compact(quote)))))];
}
const quoteText = (quotes: string[]) => quotes.map(quote => `“${quote}”`).join('；');
const contactOrInvitationDeclinePattern = /不要|不用|先别|别加|不能加|不加微信|不想|不需要|没这方面需求|没有这方面需求|没需求|没有需求|没兴趣|不感兴趣|算了|不去|没时间|没有时间|没空|没有空|不(?:太|怎么)?方便|不参加|不看|先不|没必要|不考虑|别联系|别再打|别给我打|别打电话|以后再说|下次再说|改天再说/u;
const priceQuestionPattern = /(?:要不要|需不需要|需要不需要|用不用)(?:付费|收费|付款|付钱|交钱|花钱|钱|费用)|(?:不要|不用|不需要)(?:再|另外)?(?:付费|收费|付款|付钱|交钱|花钱|钱|费用)(?:了|的)?[吧吗么呢]|收不收费|免不免费/u;
// A price question contains negative words without declining an invitation.
// Negative price confirmations require a spoken question particle because
// speechText removes punctuation; contact refusals stay outside this mask.
// Keep match offsets so an actual later withdrawal still wins over consent.
const refusalText = (text: string) => text.replace(new RegExp(priceQuestionPattern.source, 'gu'), match => ' '.repeat(match.length));
const declinedContactOrInvitation = (text: string) => contactOrInvitationDeclinePattern.test(refusalText(text));
const explicitRefusalPattern = /不要|不用(?:了|再加|加|发)|先别加|别加|不能加|不加微信|不想(?:加|看|了解|参加|联系)|不需要|没这方面需求|没有这方面需求|没需求|没有需求|没兴趣|不感兴趣|算了|不去|不参加|不看|没必要|不考虑|别联系|别再打|别给我打|别打电话/u;
const speechText = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, '').replace(/加(?:个)?(?:加(?:个)?)+微信/gu, '加个微信');
const thirdPartyReply = (text: string) => /他说|她说|别人说|客户说|(?:老板|同事|朋友|家人)(?:说|让)|替他|替她|帮他|帮她|转告|转达|机主|(?:他的|她的)微信/u.test(text);
const quotedReply = (text: string) => /[“”‘’「」『』"]/u.test(text) || /(?:^|[^A-Za-z])'|'(?:$|[^A-Za-z])/u.test(text);
const reportedReply = (text: string) => thirdPartyReply(text) || /(?:你|您|系统|机器人|AI)(?:刚才)?(?:说|回复)/iu.test(text) || /^[“「『"'][\s\S]*[”」』"']$/u.test(text.trim());
const uncertainReply = (text: string) => /[?？]|怎么|为什么|能不能|可不可以|行不行|好不好|是不是|能否|如果|假如|要是|的话|不一定|没说|不是让|没让|但是|不过/u.test(text) || priceQuestionPattern.test(speechText(text)) || /[吗么呢]$|(?:是吧|对吧)$/u.test(speechText(text)) || quotedReply(text) || reportedReply(text);

// A reported sentence may be followed by the customer's own withdrawal.
// Inspect only independent clauses outside quotes; quoted or conditional
// refusals must not erase an earlier clear agreement.
function customerDeclineText(text: string): string {
  if (!reportedReply(text) && !quotedReply(text)) return text;
  const unquoted = text.replace(/“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|‘[^’]*(?:’|$)|"[^"]*(?:"|$)|'[^']*(?:'|$)/gu, ' ');
  return unquoted.split(/(?<=[，,。；;！!？?])|(?:但是|不过|可是|但)(?=我|现在|这次|已经|不要|不用|别|不|先)/u)
    .map(clause => clause.trim())
    .filter(clause => clause && !reportedReply(clause) && !quotedReply(clause)
      && !/如果|假如|要是|的话|没说|没有说|不是说|不是让|没让/u.test(clause)
      && !/[?？]|[吗么呢]$/u.test(clause))
    .join('；');
}

// Only use this whole-utterance agreement after an explicit invitation. A
// customer can correct a missed answer without having to repeat a password-like
// keyword; questions, quoted speech and negative/conditional replies stay out.
function contextualAgreement(text: string): boolean {
  if (uncertainReply(text)) return false;
  let t = speechText(text).replace(/^[嗯哦啊]/u, '');
  if (/^(?:yes|yeah|yep|sure|okay|ok|alright|allright)(?:please|thanks|thankyou)?$/iu.test(t)) return true;
  for (const prefix of ['我刚才说的是', '我刚刚说的是', '我说的就是', '我说的是', '我已经说了', '我都说了', '我刚才说', '我刚刚说', '我说的', '我是说', '我说', '刚才说', '刚刚说']) {
    if (t.startsWith(prefix)) { t = t.slice(prefix.length); break; }
  }
  if (/^(?:可以|嗯可以)(?:那)?你加我$/u.test(t)) return true;
  t = t.replace(/[啊呀哦啦了吧]{1,2}$/u, '');
  return /^(?:好|好的|好嘞|可以|可以的|行|行的|没问题|同意|中|嗯|嗯嗯)$/u.test(t);
}
const contactContext = (text: string) => /加(?:个|一下|下)?(?:[您你]的?|我)?微信|微信[^。！？?]{0,15}(?:加|联系)/u.test(text);
const repairPrompt = (text: string) => /没听清|再说一下|您还在听|你还在听|信号|听到您|听到你/u.test(text) && !/加|微信|直播|资料|手机|电脑/u.test(text);
function contactQuestion(text: string) {
  const sentences = text.match(/[^。！？?]+[。！？?]?/gu) || [];
  const index = sentences.map(sentence => /[?？]|吗[。！!]?$/u.test(sentence)).lastIndexOf(true);
  const question = sentences[index] || '';
  return !!question && (contactContext(question) || (contactContext(sentences[index - 1] || '') && /^(?:您|你)?(?:看|觉得)?(?:方便|可以|行|好)(?:吗|[?？])/u.test(question.trim())));
}

// Keep a question across a short ASR repair prompt, without using an agent's
// later assertion as evidence that the customer accepted anything.
function agentContext(previous: string, text: string) {
  return repairPrompt(text) ? previous : (previous + '。' + text).slice(-2500);
}

// A self-identified answering assistant is not the customer accepting an
// invitation. Do not treat a human asking about or quoting an assistant as one.
function answeredByAssistant(rows: TranscriptLine[], metadata: unknown = {}): boolean {
  const meta = object(metadata);
  if ([meta.disposition, meta.endReason].includes('ANSWERING_MACHINE')) return true;
  if (automaticAnnouncementEvidence(rows)) return true;
  return rows.some(row => {
    if (!['customer', 'user'].includes(row.speaker.toLowerCase())) return false;
    if (isAutomaticAnnouncement(row.messageText)) return true;
    const text = compact(row.messageText);
    if (/刚才|他说|她说|你说|听见|听到|你是|您是|不是|不想用/u.test(text)) return false;
    const self = /(?:我是|这里是|这是)(?:机主|主人|手机主人|对方)?(?:的)?(?:智能助理|智能助手|电话助理|电话助手|语音助理|语音助手|机器人代接助手|天翼通信助理|小助理)/u.test(text);
    const relay = /代接|代为接听|帮[^。！？?]{0,12}(?:转达|记录)|替[^。！？?]{0,12}接听|机主[^。！？?]{0,12}(?:不方便|无法|不在)/u.test(text);
    return (self && relay) || /(?:我是|这里是)(?:小爱同学|小爱|小艺|小布)(?:[，,。]|正在|为|帮|代|$)/u.test(text);
  });
}

// Join only adjacent customer ASR fragments. Agent speech resets the fragment,
// so unrelated customer answers never manufacture an automated announcement.
export function automaticAnnouncementEvidence(rows: TranscriptLine[]): string {
  let fragment = '';
  for (const row of rows) {
    if (!['customer', 'user'].includes(row.speaker.toLowerCase())) { fragment = ''; continue; }
    fragment = Array.from(fragment + row.messageText).slice(-600).join('');
    if (isAutomaticAnnouncement(row.messageText)) return row.messageText.slice(0, 600);
    if (isAutomaticAnnouncement(fragment)) return fragment.slice(0, 600);
  }
  return '';
}

const businessObject = /产品|服务|项目|方案|系统|软件|设备|课程|培训|直播|讲座|分享|活动|会议|试用|演示|报价|价格|资料|样品|样本|案例|合作|采购|订单|介绍|product|service|solution|software|proposal|brochure|pricing|price|quote|quotation|demo|trial|webinar|training|sample|details|information/iu;
const englishInterestDenial = /\b(?:not\s+interested|no\s+interest|do\s+not\s+want|don'?t\s+want|not\s+now|no\s+thanks|stop\s+calling|do\s+not\s+call|don'?t\s+call)\b/iu;
const chineseBusinessDenial = /(?:没(?:有)?|并无|毫无)(?:任何)?(?:意向|兴趣|需求)|(?:不|并不|不是|谈不上)(?:太|怎么|很|特别|那么|多)?(?:有意向|感兴趣|有兴趣|有需求)|(?:不|没(?:有)?|并不)(?:打算|准备|愿意|希望|想要|想|需要|要|考虑)(?:再|先|进一步|详细|具体)?(?:了解|试用|体验|预约|看演示|购买|采购|下单|订购|合作)|(?:别|不用|不必|无需)(?:再|先)?(?:给我|向我)?(?:发|寄|提供|发送)/u;
const businessInterestDenied = (text: string) => englishInterestDenial.test(text) || chineseBusinessDenial.test(speechText(text));

function directBusinessInterest(text: string): boolean {
  if (isContactCheckOnly(text) || declinedContactOrInvitation(speechText(text)) || businessInterestDenied(text) || quotedReply(text) || reportedReply(text)) return false;
  if (/\b(?:he|she|they|someone|the\s+customer|my\s+colleague)\s+(?:said|says|asked|asks|wants|is\s+interested)\b/iu.test(text)
    || /(?:^|[，,。；;])(?:(?:我|我们)的?)?(?:他|她|他们|她们|老板|同事|客户|朋友|家人)(?:很|比较|挺|也)?(?:有兴趣|感兴趣|有意向|想|需要|愿意|打算|准备|希望|问|询问)/u.test(text)) return false;
  const t = speechText(text);
  if (/了解[^。！？?]{0,20}(?:你是谁|您是谁|哪位|哪家|哪个公司|哪个单位|哪里打|哪边打|做什么的|干什么的)|^(?:我|我们)?(?:想|需要|希望)了解(?:一下|下)?(?:你|您)(?:是|叫|的身份)/u.test(t)) return false;
  // A concrete cooperation request is itself a business expression. A spoken
  // personal wish to learn more also survives a following business question;
  // punctuation alone must not erase it. Hypothetical/reported wishes stay out.
  const cooperationRequest = /(?:怎么|如何|怎样)(?:开展|进行)?合作|合作(?:具体|应该|需要|要)?(?:怎么|如何|怎样)(?:做|开展|进行|操作)/u.test(t);
  const personalInterest = text.split(/[，,。；;！!]/u).some(clause => /^(?:我|我们)(?:是)?(?:想|愿意|希望|需要)(?:先|再|进一步|详细|具体)?了解/u.test(speechText(clause)) && !/[?？]|[吗么呢]$/u.test(clause.trim()));
  const businessQuestion = (businessObject.test(text) || /收费|费用|多少钱/u.test(text)) && /[?？]|怎么|如何|怎样|多少|什么|哪些/u.test(text);
  if (!/如果|假如|要是|的话|不一定|没说|没有说|不是说|不是让|没让|但是|不过|随便问|随口问|只是问问/u.test(t)
    && (cooperationRequest || (personalInterest && businessQuestion))) return true;
  if (uncertainReply(text)) return false;
  // Interest and concrete requests carry their own business meaning. Generic
  // approval such as “这个好”“随便都行” never matches this branch.
  if (/有意向|(?:有|感|挺|很|比较|非常|特别)兴趣|(?:想|需要|愿意)(?:再|进一步|详细|具体)?了解|想听(?:一下|下)?(?:详细)?介绍/u.test(t)) return true;
  if (/(?:发|给|寄|提供|发送)(?:给)?我(?:一份|个|份|些|点|一下|下)?(?:资料|报价|方案|样品|案例|介绍|链接|产品目录|服务介绍)|(?:资料|报价|方案|样品|案例|链接)(?:发|给|寄)(?:给)?我|我(?:想|要|需要)(?:一份|个|份|些|点)?(?:资料|报价|方案|样品|案例|产品目录)/u.test(t)) return true;
  if (/(?:我|我们)?(?:想|需要|打算|准备|愿意|希望)(?:先|再|进一步|详细)?(?:试用|体验|预约演示|看演示|采购|购买|下单|订购|合作)|(?:这个|你们这个|这套)(?:产品|服务|系统|软件|方案)?(?:我|我们)(?:有需要|有需求|需要|想要)/u.test(t)) return true;
  return /\b(?:i(?:'m|\s+am)?|we(?:'re|\s+are)?)\s+(?:(?:really|very)\s+)?interested\b|\b(?:i|we)\s+(?:would\s+like|want|need)\s+to\s+(?:learn\s+more|try|buy|purchase|order|book\s+a\s+demo)\b/iu.test(text)
    || /\b(?:send|give|email|share)\s+(?:me|us)\s+(?:a\s+|the\s+|some\s+)?(?:details|information|brochure|quote|quotation|proposal|link|sample)\b/iu.test(text);
}

function businessInvitation(text: string): boolean {
  const sentences = text.match(/[^。！？?]+[。！？?]?/gu) || [];
  const index = sentences.map(sentence => /[?？]|[吗呢][。！!]?$/u.test(sentence)).lastIndexOf(true);
  const question = sentences[index] || '', context = (sentences[index - 1] || '') + question;
  if (!question || isContactCheckOnly(question) || !businessObject.test(context)) return false;
  if (/听我|听我们|接电话|接听|讲话|沟通|贵姓|姓名|声音|听到|听得|听见|如果|假如|can\s+you\s+hear|are\s+you\s+there/iu.test(question)) return false;
  return /(?:愿意|有兴趣|想不想|要不要|是否需要|需不需要|需要|可以|方便|想|有时间|有空|考虑)[^。！？?]{0,60}(?:了解|参加|观看|收看|来听|听听|看看|试用|体验|发|发送|提供|报价|资料|安排|预约|购买|采购|合作|需求|需要)/u.test(question)
    || /\b(?:would\s+you\s+like|are\s+you\s+interested|do\s+you\s+want|can\s+i\s+send|may\s+i\s+send|shall\s+i\s+send|want\s+me\s+to)\b/iu.test(question);
}

// The opening may finish a concrete invitation with a declarative contact
// arrangement. Do not let that arrangement hide the adjacent question, and
// never carry an old invitation across a later unrelated question.
function invitationAcceptance(answer: string, previous: string): boolean {
  if (quotedReply(answer) || reportedReply(answer) || quotedReply(previous) || reportedReply(previous)) return false;
  const sentences = previous.match(/[^。！？?；;\n\r]+[。！？?；;\n\r]?/gu) || [];
  const last = sentences.at(-1)?.trim() || '';
  const arrangement = contactContext(last) && !/[?？]|[吗么呢][。！!]?$/u.test(last)
    && !/不|没|别|无法|如果|假如|要是|方便的话|请提供|告诉我|您先|你先|等您|等你/u.test(last)
    && /我(?:这边|这就|马上|现在|稍后|一会|待会|等下|等会|回头)?加[您你](?:的|个)?微信|微信(?:上)?(?:把|发给|联系)/u.test(speechText(last));
  const adjacent = sentences.length >= 2 && arrangement && businessInvitation(sentences.slice(0, -1).join(''));
  if (!(businessInvitation(previous) || adjacent)) return false;
  if (contextualAgreement(answer)) return true;
  // Accept only a complete positive answer repeating the exact offered action.
  // A price question, qualification, quotation or unrelated suffix stays open.
  const question = sentences.filter(sentence => /[?？]|[吗么呢][。！!]?$/u.test(sentence)).at(-1) || '';
  const offered = speechText(question).replace(/[啊呀吧吗么呢]+$/u, '');
  const t = Array.from(speechText(answer));
  for (let n = 1; n < t.length && n <= 6; n++) {
    const prefix = t.slice(0, n).join('');
    if (!contextualAgreement(prefix) || isContactCheckOnly(prefix)) continue;
    const tail = t.slice(n).join('').replace(/[啊呀吧吗么]+$/u, '');
    // Derive the echo from the actual invitation; no extra keyword list.
    if (Array.from(tail).length >= 2 && !uncertainReply(tail) && !declinedContactOrInvitation(tail) && (offered.endsWith(tail) || (Array.from(tail).length >= 4 && offered.includes(tail)))) return true;
  }
  return false;
}

// This is deliberately broader than a livestream or WeChat invitation, while
// still requiring a concrete business request or assent to the last question.
function businessInterestQuote(rows: TranscriptLine[]): string {
  let previousAgent = '', interest = '';
  for (const row of rows) {
    const text = row.messageText.trim();
    if (['agent', 'assistant', 'bot'].includes(row.speaker.toLowerCase())) { previousAgent = agentContext(previousAgent, text); continue; }
    if (!['customer', 'user'].includes(row.speaker.toLowerCase())) continue;
    if (reportedReply(text) || quotedReply(text)) {
      if (declinedContactOrInvitation(speechText(customerDeclineText(text)))) interest = '';
      previousAgent = ''; continue;
    }
    if (declinedContactOrInvitation(speechText(text)) || businessInterestDenied(text)) { interest = ''; previousAgent = ''; continue; }
    if (directBusinessInterest(text) || (!isContactCheckOnly(text) && invitationAcceptance(text, previousAgent))) interest = text.slice(0, 600);
    previousAgent = '';
  }
  return interest;
}

export function qualifiedInterestQuote(rows: TranscriptLine[], metadata: unknown = {}): string {
  if (object(metadata).doNotCallRequested === true || isAnsweringMachine(metadata) || answeredByAssistant(rows, metadata)) return '';
  const candidates = new Set([wechatConsentQuote(rows), invitationInterestQuote(rows), businessInterestQuote(rows)].filter(Boolean));
  let interest = '';
  for (const row of rows) {
    if (!['customer', 'user'].includes(row.speaker.toLowerCase())) continue;
    const text = row.messageText.trim();
    if (candidates.has(text.slice(0, 600))) interest = text.slice(0, 600);
    else if (declinedContactOrInvitation(speechText(customerDeclineText(text))) || businessInterestDenied(customerDeclineText(text))) interest = '';
  }
  return interest;
}

// Consent is grounded in customer words, not an agent's claim or suggestion.
export function wechatConsentQuote(rows: TranscriptLine[]): string {
 if(answeredByAssistant(rows))return '';
 let previousAgent='', consent='', recentContact='', contactAge=99;
 for(const row of rows){
  const text=row.messageText.trim(), t=speechText(text);
  if(['agent','assistant','bot'].includes(row.speaker.toLowerCase())){previousAgent=agentContext(previousAgent,text);if(contactContext(text)){recentContact=text;contactAge=0;}continue;}
  if(!['customer','user'].includes(row.speaker.toLowerCase()))continue;
  // A quotation cannot grant new consent, but it also does not revoke the
  // customer's earlier clear agreement. Only an actual later refusal does.
  if(reportedReply(text)||quotedReply(text)){if(declinedContactOrInvitation(speechText(customerDeclineText(text))))consent='';previousAgent='';recentContact='';contactAge=99;continue;}
  const ambiguous=uncertainReply(text);
  const contactDenied=/(?:不要|不用|不需要)(?:再|直接|你|您|给我)?(?:加|发)|(?:不|没(?:有)?)(?:可以|能|想|愿意|同意|让|要)(?:再|先|直接|你|您|给我|去|来){0,4}加|先别加|别(?:再|给我)?加|不能加|不加微信|不想加|不许加|禁止加|拒绝加|别联系|不要联系|别再打|不要再打|别给我打|别打电话/u.test(t);
  const hasContactContext=contactContext(previousAgent)||(contactAge<=2&&!!recentContact);
  const directMatches=[...t.matchAll(/加我的?微信|加我微信|发我微信|发到我微信|(?:^|好|行|嗯|哦|啊|先|直接|你|您|那|就|请)加(?:个|一下|下)?微信(?:吧|就行|就好|发资料|给我|$)/gu),...(hasContactContext?[...t.matchAll(/(?:你|您)?(?:先|直接)?加我(?:一下|下|吧|就好|就行|即可)|(?:你|您)(?:先|直接)?加(?:就行|就好|吧)/gu)]:[])];
  const declines=[...refusalText(t).matchAll(new RegExp(contactOrInvitationDeclinePattern.source,'gu'))];
  // A later explicit request such as "不用介绍了，直接加我微信" can
  // clarify an introduction refusal. Contact-specific refusal always wins;
  // a later "算了，不用了" still revokes an earlier positive request.
  const direct=!ambiguous&&!contactDenied&&(directMatches.at(-1)?.index??-1)>(declines.at(-1)?.index??-1);
  if(contactDenied||(declinedContactOrInvitation(t)&&!direct)){consent='';previousAgent='';recentContact='';contactAge=99;continue;}
  const invited=contactQuestion(previousAgent)&&!/不要|不用|不能|不加|如果/u.test(previousAgent);
  if(direct||(invited&&contextualAgreement(text)))consent=text.slice(0,600);
  previousAgent='';
  contactAge++;
 }
 return consent;
}

// A clear yes to a livestream invitation is interest in the invitation. It
// does not grant permission to add WeChat or imply any completed follow-up.
export function invitationInterestQuote(rows: TranscriptLine[]): string {
  if (answeredByAssistant(rows)) return '';
  let previousAgent = '', interest = '';
  for (const row of rows) {
    const text = row.messageText.trim(), t = speechText(text);
    if (['agent', 'assistant', 'bot'].includes(row.speaker.toLowerCase())) { previousAgent = agentContext(previousAgent, text); continue; }
    if (!['customer', 'user'].includes(row.speaker.toLowerCase())) continue;
    if (reportedReply(text) || quotedReply(text)) {
      if (declinedContactOrInvitation(speechText(customerDeclineText(text)))) interest = '';
      previousAgent = ''; continue;
    }
    if (declinedContactOrInvitation(t)) {
      interest = ''; previousAgent = ''; continue;
    }
    // Bind assent to the last question and require its explicit invitation
    // object. A yes to hearing an introduction or answering the phone is not
    // a yes to attending the event mentioned in an earlier sentence.
    const sentences = previousAgent.match(/[^。！？?]+[。！？?]?/gu) || [];
    const questionIndex = sentences.map(sentence => /[?？]|[吗呢][。！!]?$/u.test(sentence)).lastIndexOf(true);
    const question = sentences[questionIndex] || '', previousSentence = sentences[questionIndex - 1] || '';
    const explicitInvitation = /直播|线上分享|线上讲座|线上活动/u.test(question)
      && /(?:有时间|有空|方便|愿意|要不要|可以|想不想|有兴趣)[^。！？?]{0,50}(?:了解|参加|观看|收看|来听|听听|看看|看一下)[^。！？?]{0,30}(?:[?？]|吗)/u.test(question);
    // Allow the event object in the immediately preceding statement only for
    // the narrow "have time to join/learn about it?" invitation wording.
    const contextualInvitation = /线上直播|线上分享|线上讲座|线上活动/u.test(previousSentence)
      && !/[?？]|如果|假如/u.test(previousSentence)
      && /(?:有时间|有空)(?:来|去)?(?:了解一下|了解|参加一下|参加|观看一下|观看|听一下|看看)(?:吗|[?？])/u.test(question);
    const invited = (explicitInvitation || contextualInvitation)
      && !/不方便|不愿意|没兴趣|不感兴趣|不需要|如果|假如|听我|听我们|介绍|接电话|接听|讲话|沟通|贵姓|姓名/u.test(question);
    const unambiguous = !uncertainReply(text) && !/有时间[^。！？?]{0,12}再|有空[^。！？?]{0,12}再|到时[^。！？?]{0,12}再|再说|不一定|看情况|可能/u.test(text);
    const affirmative = unambiguous
      && (contextualAgreement(text) || /^(?:嗯|哦|啊|诶|哎)?(?:(?:好|好的|好啊|好呀|可以|可以的|可以啊|可以呀|行|行的|行啊|没问题)){1,3}(?:谢谢|谢谢啊|谢谢您|谢了|麻烦了)?$/u.test(t));
    // Selecting a viewing device answers the event invitation, but saying a
    // phone number or mentioning a broken phone does not. Keep this bound to
    // the final viewing-device question and its adjacent event statement.
    const eventContext = /直播|线上(?:分享|讲座|活动|课程|课)/u.test(previousSentence + question);
    const viewingDeviceQuestion = eventContext && /手机|电脑|平板|ipad|设备/iu.test(question)
      && /观看|收看|看直播|看课|看/u.test(question)
      && /手机[^。！？?]{0,24}电脑|电脑[^。！？?]{0,24}手机|(?:用|是|选择|使用)[^。！？?]{0,12}(?:手机|电脑|平板|ipad)|(?:什么|哪种|哪个)设备/iu.test(question)
      && !/号码|手机号|电话号码|联系方式|微信号|加微信|电量|没电|坏了|如果|假如|不方便|不愿意|不需要/u.test(question);
    const deviceChoice = unambiguous
      && /^(?:嗯|哦|啊|诶|哎)?(?:用|用的|我用|我用的|我用的是|就用|还是用|可以用|我可以用|拿)?(?:手机|电脑|平板|ipad)(?:上)?(?:观看|收看|看直播|看课|看)?(?:就行|就行了|就好|就好了|就可以|就可以了|可以|吧|呗|方便|看方便)?(?:谢谢|谢谢啊|谢谢您|谢了|麻烦了)?$/iu.test(t);
    const viewingAcceptance = unambiguous && text.split(/[，,。；;！!]/u).some(clause => /^(?:嗯|哦|啊|诶|哎)?(?:我)?(?:可以|会|愿意|想|打算|准备)(?:观看|收看|看直播|看课|来听|参加|看看|看一下|看)(?:一下|的|啊|呀|吧)?$/u.test(speechText(clause)));
    const requestLink = unambiguous && eventContext && /(?:你|您)(?:先|直接)?发(?:个|一下|点)?(?:直播间|链接|资料|地址)给我|发我(?:一下|个)?(?:直播间|链接|资料|地址)/u.test(t);
    if ((invited && (affirmative || viewingAcceptance)) || (viewingDeviceQuestion && (deviceChoice || viewingAcceptance)) || requestLink) interest = text.slice(0, 600);
    previousAgent = '';
  }
  return interest;
}

export function customerIntentEvidence(rows: TranscriptLine[], metadata: unknown = {}) {
  const assistant = answeredByAssistant(rows, metadata);
  const consent = assistant ? '' : wechatConsentQuote(rows), invitation = assistant ? '' : invitationInterestQuote(rows);
  const interest = assistant ? '' : qualifiedInterestQuote(rows, metadata);
  const acceptedAt = Math.max(-1, ...rows.map((row, index) => ['customer', 'user'].includes(row.speaker.toLowerCase()) && [consent, invitation, interest].includes(row.messageText.trim().slice(0, 600)) && !!row.messageText.trim() ? index : -1));
  const refusal = rows.filter((row, index) => index > acceptedAt && ['customer', 'user'].includes(row.speaker.toLowerCase()) && (declinedContactOrInvitation(speechText(customerDeclineText(row.messageText))) || businessInterestDenied(customerDeclineText(row.messageText)))).at(-1)?.messageText.trim() || '';
  const explicitRefusal = rows.filter((row, index) => index > acceptedAt && ['customer', 'user'].includes(row.speaker.toLowerCase()) && (explicitRefusalPattern.test(refusalText(speechText(customerDeclineText(row.messageText)))) || businessInterestDenied(customerDeclineText(row.messageText)))).at(-1)?.messageText.trim() || '';
  return { consent, invitation, interest, refusal, explicitRefusal, blockedReason: object(metadata).doNotCallRequested === true ? 'DO_NOT_CALL' : assistant ? 'ANSWERING_ASSISTANT' : explicitRefusal ? 'CUSTOMER_REFUSAL' : refusal ? 'CUSTOMER_DEFERRAL' : rows.some(row => ['customer', 'user'].includes(row.speaker.toLowerCase()) && thirdPartyReply(row.messageText)) && !interest ? 'THIRD_PARTY_OR_RELAY' : !interest ? 'NO_EXPLICIT_ACCEPTANCE' : null };
}

// Rule conclusions remain provisional until their quote is found in the
// customer's own transcript. A label alone, an agent quote or a reported
// sentence cannot create a customer, and refusals cannot be upgraded.
function verifiedRuleConclusion(metadata: unknown, rows: TranscriptLine[]): { intent: CallSummary['intent']; evidence: string } | null {
  const meta = object(metadata);
  const mapped = { interested: 'INTERESTED', unclear: 'UNKNOWN', uninterested: 'NO_NEED', optout: 'OPT_OUT' } as const;
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const candidates = [
    { intent: meta.intent, quote: meta.intentEvidence, rules: meta.matchedRules },
    { intent: meta.provisionalIntent, quote: meta.matchedEvidence || meta.provisionalEvidence, rules: meta.provisionalRules || meta.matchedRules },
  ];
  const grounded: Array<{ intent: CallSummary['intent']; evidence: string }> = [];
  for (const candidate of candidates) {
    if (!(typeof candidate.intent === 'string' && Object.prototype.hasOwnProperty.call(mapped, candidate.intent)) || typeof candidate.quote !== 'string' || !Array.isArray(candidate.rules)) continue;
    const quote = candidate.quote.trim().slice(0, 600), text = normalize(quote);
    const intent = mapped[candidate.intent as keyof typeof mapped];
    const customerEvidence = intent === 'INTERESTED' ? customerIntentEvidence(rows, metadata) : null;
    // A literal one-character answer can accept the actual previous business
    // question. Require that exact whole customer turn and qualified quote;
    // this exception never makes a one-character substring generic evidence.
    const qualifiedSinglePositive = intent === 'INTERESTED' && Array.from(text).length === 1
      && customerEvidence?.interest === quote && !customerEvidence.blockedReason
      && rows.some(row => ['customer', 'user'].includes(row.speaker.toLowerCase()) && row.messageText.trim() === quote);
    if (!text || (!verifiedQuotes([quote], rows).length && !qualifiedSinglePositive) || reportedReply(quote) || quotedReply(quote)) continue;
    const matchingRule = candidate.rules.some(value => {
      const rule = object(value), keyword = typeof rule.keyword === 'string' ? normalize(rule.keyword) : '';
      return rule.intent === candidate.intent && typeof rule.id === 'string' && !!rule.id && !!keyword && text.includes(keyword);
    });
    if (!matchingRule) continue;
    if (intent === 'INTERESTED') {
      if (isContactCheckOnly(quote)) continue;
      if (!customerEvidence?.interest || customerEvidence.blockedReason) continue;
    }
    grounded.push({ intent, evidence: quote });
  }
  const rank = { OPT_OUT: 4, NO_NEED: 3, INTERESTED: 2, UNKNOWN: 1, FOLLOW_UP: 0 };
  return grounded.sort((a, b) => rank[b.intent] - rank[a.intent])[0] || null;
}

// Customer facts are extractive: a matching quote cannot justify arbitrary
// model prose attached to it. Historical prose is also projected from the
// transcript, without rewriting the original record or paying for reanalysis.
export function groundCallSummary(input: unknown, rows: TranscriptLine[], metadata: unknown = {}): CallSummary | null {
  const parsed = callSummarySchema.safeParse(input);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (isAnsweringMachine(metadata) || answeredByAssistant(rows, metadata)) {
    const evidence = String(object(object(metadata).assistantDetection).evidence || automaticAnnouncementEvidence(rows)).slice(0, 600);
    return { summary: '本次由语音助手或语音信箱接听，未确认机主本人意向。', need: '', intent: 'UNKNOWN', handoff: false, reason: '', nextAction: '本次不作为意向客户推送依据。', evidence: { summary: evidence ? [evidence] : [], need: [], intent: [], handoff: [] } };
  }

  const evidence = {
    summary: verifiedQuotes(data.evidence?.summary, rows),
    need: verifiedQuotes(data.evidence?.need, rows).filter(quote => !isContactCheckOnly(quote)),
    intent: verifiedQuotes(data.evidence?.intent, rows).filter(quote => !isContactCheckOnly(quote)),
    handoff: verifiedQuotes(data.evidence?.handoff, rows),
  };
  const substantive = rows.filter(row => ['customer', 'user'].includes(row.speaker.toLowerCase()) && compact(row.messageText).length >= 5);
  const fallback = [...new Set([...substantive.slice(0, 2), ...substantive.slice(-4)].map(row => row.messageText.slice(0, 160)))];
  const needQuotes = evidence.need.length ? evidence.need : data.evidence ? [] : substantive.filter(row => /需要|想要|希望|缺的是|最缺|痛点|难题|困难|搞不到|没有流量/u.test(row.messageText)).slice(-3).map(row => row.messageText.slice(0, 160));
  const summaryQuotes = evidence.summary.length ? evidence.summary : fallback;
  const customerEvidence = customerIntentEvidence(rows, metadata), consent = customerEvidence.consent, invitationInterest = customerEvidence.invitation, businessInterest = customerEvidence.interest;
  const deferred = customerEvidence.refusal && !customerEvidence.explicitRefusal && ['INTERESTED', 'FOLLOW_UP'].includes(data.intent);
  const ruleConclusion = verifiedRuleConclusion(metadata, rows);
  const intent = finalCallIntent(data.intent === 'OPT_OUT' ? 'OPT_OUT' : data.intent === 'NO_NEED' || customerEvidence.explicitRefusal ? 'NO_NEED' : businessInterest ? 'INTERESTED' : deferred ? 'FOLLOW_UP' : data.evidence && !evidence.intent.length ? 'UNKNOWN' : data.intent, metadata, rows);
  if(consent && intent === 'INTERESTED') { evidence.intent = [consent]; if(!needQuotes.length)needQuotes.push(consent); }
  else if (invitationInterest && intent === 'INTERESTED') evidence.intent = [invitationInterest];
  else if (businessInterest && intent === 'INTERESTED') evidence.intent = [businessInterest];
  else if (deferred && intent === 'FOLLOW_UP') evidence.intent = [customerEvidence.refusal];
  else if (customerEvidence.explicitRefusal && intent === 'NO_NEED') evidence.intent = [customerEvidence.explicitRefusal];
  else if (ruleConclusion?.intent === intent) evidence.intent = [ruleConclusion.evidence];
  const handoff = object(metadata).handoffRequested === true || (data.handoff && evidence.handoff.length > 0);
  const nextAction = intent === 'OPT_OUT' ? '建议：停止主动联系，保留客户拒绝联系的记录。'
    : consent && intent === 'INTERESTED' ? '建议：客户已同意微信联系，核对联系方式后由人工添加并发送直播间；尚未添加或发送，不再重复征求同意。'
    : invitationInterest && intent === 'INTERESTED' ? '建议：客户已肯定回应直播邀约，由人工跟进；添加微信或发送资料前仍需确认客户同意。'
    : handoff ? '建议：由人工核实客户需求和接管安排。'
    : intent === 'INTERESTED' || intent === 'FOLLOW_UP' ? '建议：先核实具体需求；经客户同意后再提供资料或安排人工沟通。'
    : intent === 'NO_NEED' ? '建议：尊重客户当前无需求的答复，结束本次沟通。'
    : '建议：信息不足，暂不认定客户需求或承诺。';
  return {
    ...data,
    summary: summaryQuotes.length ? `客户原话：${quoteText(summaryQuotes)}`.slice(0, 1500) : '暂无可核对的客户原话，客户需求待核实。',
    need: quoteText(needQuotes).slice(0, 600),
    intent, handoff,
    reason: handoff ? quoteText(evidence.handoff).slice(0, 600) || '接管请求已记录，具体原因待人工核实。' : '',
    nextAction,
    // Keep the absence of historical evidence explicit; do not upgrade a
    // previously inferred intent into a newly verified one on a second read.
    ...(data.evidence || businessInterest || ruleConclusion ? { evidence } : {}),
    ...(data.quality ? { quality: groundedQuality(data.quality, rows) } : {}),
  };
}

function groundedQuality(quality: NonNullable<CallSummary['quality']>, rows: TranscriptLine[]): NonNullable<CallSummary['quality']> {
  const issues = quality.issues.filter(issue => compact(issue.evidence).length >= 4 && rows.some(row => compact(row.messageText).includes(compact(issue.evidence))));
  const good = quality.outcome === 'GOOD' && quality.issues.length === 0 && rows.some(row => ['customer', 'user'].includes(row.speaker.toLowerCase()));
  return { outcome: issues.length ? 'NEEDS_IMPROVEMENT' : good ? 'GOOD' : 'INSUFFICIENT', summary: issues.length ? `以下 ${issues.length} 项评估保留了可核对的转写原话；改进建议不代表客户已经确认的需求或约定。` : good ? '本次文字评估未列出需要改进的事项，请结合对话记录核对。' : '原评估缺少可逐字核对的依据，请以对话记录为准。', issues };
}

export function summaryFromFields(fields: unknown): CallSummary | null {
  if (!Array.isArray(fields)) return null;
  const field = (names: string[]) => String(names.map(name => fields.find(item => item?.name === name)?.value).find(value => value !== undefined && value !== null && value !== '') || '');
  const rawIntent = field(['客户意向', 'intent']);
  const normalizedIntent = String(rawIntent ?? '').trim();
  const intent = (/^(?:interested|有意向|感兴趣|愿意|同意|可以加我|可以那你加我|客户感兴趣)$/iu.test(normalizedIntent) ? 'INTERESTED' : (/^(?:no_need|无意向|不感兴趣|拒绝|没兴趣)$/iu.test(normalizedIntent) ? 'NO_NEED' : (Object.entries(intents).find(([key, label]) => rawIntent === key || rawIntent === label)?.[0] || 'UNKNOWN'))) as CallSummary['intent'];
  if (!field(['沟通摘要', 'summary']) && !rawIntent) return null;
  const quotes = (name: string): string[] => fields.find(item => item?.name === name)?.evidence || [];
  const hasEvidence = fields.some(item => item?.name === '沟通摘要' && Array.isArray(item.evidence));
  return { summary: field(['沟通摘要', 'summary']) || '待核实', need: field(['客户需求', 'need']), intent, handoff: false, reason: '', nextAction: '', ...(hasEvidence ? { evidence: { summary: quotes('沟通摘要'), need: quotes('客户需求'), intent: quotes('客户意向'), handoff: quotes('人工接管') } } : {}) };
}

export function summaryFields(input: unknown) {
  const parsed = callSummarySchema.safeParse(input);
  if (!parsed.success) return [];
  const d = parsed.data;
  return [
    { name: '沟通摘要', value: d.summary, ...(d.evidence ? { evidence: d.evidence.summary } : {}) },
    { name: '客户需求', value: d.need || '未明确表达，待核实', ...(d.evidence ? { evidence: d.evidence.need } : {}) },
    { name: '客户意向', value: intents[d.intent], ...(d.evidence ? { evidence: d.evidence.intent } : {}) },
    { name: '人工接管', value: d.handoff ? '需要人工跟进' : '未提出', ...(d.evidence ? { evidence: d.evidence.handoff } : {}) },
    ...(d.reason ? [{ name: '接管理由', value: d.reason }] : []),
    { name: '建议下一步', value: d.nextAction || '待人工确认' },
  ];
}
export function summaryEvaluation(input: unknown) {
  const result = callSummarySchema.safeParse(input);
  if (!result.success || !result.data.quality) return [];
  const q = result.data.quality;
  return [
    { identifier: '文字对话评估', value: { GOOD: '沟通正常', NEEDS_IMPROVEMENT: '建议改进', INSUFFICIENT: '信息不足' }[q.outcome], description: q.summary },
    ...q.issues.map(item => ({ identifier: item.issue, value: item.suggestion, description: item.evidence })),
  ];
}

export function transcriptReview(rows: Array<{ speaker: string; messageText: string }>) {
  if (!rows.length) return [];
  const agent = rows.filter(row => ['agent', 'assistant', 'bot'].includes(row.speaker.toLowerCase()));
  const customer = rows.filter(row => ['user', 'customer'].includes(row.speaker.toLowerCase()));
  const groups = new Map<string, { text: string; count: number }>();
  for (const row of agent) {
    const normalized = row.messageText.replace(/[\p{P}\p{Z}\s]/gu, '');
    if (normalized.length < 8) continue;
    const group = groups.get(normalized) ?? { text: row.messageText, count: 0 };
    group.count++; groups.set(normalized, group);
  }
  const repeated = [...groups.values()].filter(row => row.count > 1);
  return [
    { identifier: '对话记录', value: `客户 ${customer.length} 条 · 数字员工 ${agent.length} 条` },
    { identifier: '重复文本检查', value: repeated.length ? `发现 ${repeated.length} 组重复内容` : '未发现整句重复', description: repeated.map(row => `“${row.text.slice(0, 200)}”记录了 ${row.count} 次`).join('\n') },
  ];
}
