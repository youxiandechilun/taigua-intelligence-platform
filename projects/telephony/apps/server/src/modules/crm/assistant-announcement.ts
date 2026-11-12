/*
 * 中文导读：客户管理：assistant-announcement.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Pure announcement matching shared in semantics with
// bridge/cmd/bridge/assistant_rules.go. Callers normalize text and keywords,
// then apply their rule-level negative phrases before consulting this helper.
const greetings = ['您好', '你好', '喂', '哎', '嗯', '很抱歉', '非常抱歉', '抱歉', '对不起', 'sorry', 'hello', 'hi'];
const introductions = ['我是', '这里是', '我这边是', '您正在与'];
const identityNames = ['机主的智能助理', '机主的智能助手', '机主的电话助理', '机主的语音助手', '主人的智能助理', '主人的智能助手', '小爱同学', '小艾同学', '小爱电话助理', '小艺通话助手', '机器人助手', '智能电话助手', '智能接听助理', '智能接听助手', '电话代接助手', '语音代接助手', '小爱', '小艾', '小艺', '小布', '小v', '语音助手', '智能助理', '智能助手', '电话助理', '接听助理', '接听助手', '通话助手'];
const productSuffixes = ['产品', '的产品', '研发', '开发', '销售', '行业', '公司'];
const reportedPhrases = ['刚才', '他说', '她说', '你说', '我说', '听见', '听到', '你是', '您是', '不是', '不想用', '什么意思', '啥意思', '怎么回事', '为什么', '提示说', '显示'];
const mentionExclusions = ['我不是语音助手', '我不是智能助手', '我不是智能助理', '不是代接', '不是语音信箱', '我用的语音助手', '我自己的语音助手', '你是语音助手吗', '你是智能助手吗'];
const carrierPrefixes = ['您拨打的电话正在通话中', '你拨打的电话正在通话中', '您拨打的用户正在通话中', '你拨打的用户正在通话中', '您拨打的电话暂时无法接听', '你拨打的电话暂时无法接听', '您拨打的用户暂时无法接听', '你拨打的用户暂时无法接听', '您拨打的电话无人接听', '你拨打的电话无人接听', '您拨打的用户无人接听', '你拨打的用户无人接听'];
const answeringDuties = ['代接', '代为接听', '帮他接听', '帮她接听', '帮主人接听', '帮机主接听', '替他接听', '替她接听', '替主人接听', '替机主接听', '为主人接听', '为机主接听', '机主暂时', '机主现在', '主人暂时', '主人现在', '帮您记录', '帮你记录', '帮您转达', '帮你转达', '为您转达', '为你转达', '代为转达', '请问您找', '请问你找', '有什么事', '有什么事情'];
const bound = (value: string, limit: number) => Array.from(value).slice(0, limit).join('');
const containsPart = (value: string, parts: string[]) => parts.some(part => value.includes(part));
const productSuffix = (value: string) => productSuffixes.some(product => value.startsWith(product));
const answeringDuty = (value: string) => containsPart(value, answeringDuties);
const normalizeKeyword = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const quotedAnnouncement = (value: string) => /[“”‘’「」『』"']/u.test(value);
const unavailableParts = ['无法接听', '无人接听', '无法接通', '不能接听', '未能接通', '正在通话中', 'unavailable'];
const notificationParts = ['通知', '短信提醒', '来电提醒', '通话提醒'];

// Explicit keyword mode has no announcement/identity gate. Exclusions are
// applied by the caller before this literal, ordered-fragment match.
export function matchesAssistantKeywordText(normalized: string, keyword: string): boolean {
  const parts = keyword.split('.*').map(normalizeKeyword);
  if (!normalized || parts.length > 5 || parts.some(part => !part)) return false;
  let end = 0;
  for (const part of parts) {
    const position = normalized.indexOf(part, end);
    if (position < 0) return false;
    end = position + part.length;
  }
  return true;
}

export type AssistantAnnouncementHead = Readonly<{ head: string; introHead: string; reported: boolean }>;

function stripGreetings(text: string) {
  for (let index = 0; index < 5; index++) {
    const before = text;
    for (const greeting of greetings) if (text.startsWith(greeting)) text = text.slice(greeting.length);
    if (text === before) break;
  }
  return text;
}

function knownIntroduction(head: string): { identity: string; suffix: string } | null {
  for (const intro of introductions) {
    if (!head.startsWith(intro)) continue;
    const subject = head.slice(intro.length);
    let longest = '';
    for (const name of identityNames) if (subject.startsWith(name) && name.length > longest.length) longest = name;
    if (longest) return { identity: longest, suffix: subject.slice(longest.length) };
  }
  return null;
}

// Build once per utterance; all bounds count Unicode code points, as in Go.
export function buildAssistantAnnouncementHead(normalized: string): AssistantAnnouncementHead {
  const head = bound(stripGreetings(normalized), 120);
  let reported = containsPart(head, [...reportedPhrases, ...mentionExclusions]);
  let introHead = head;
  if (!reported) {
    const carrier = carrierPrefixes.find(prefix => head.startsWith(prefix));
    if (carrier) introHead = stripGreetings(head.slice(carrier.length));
  }
  introHead = bound(introHead, 70);
  const known = knownIntroduction(introHead);
  reported ||= !!known && productSuffix(known.suffix);
  return { head, introHead, reported };
}

function identityKeyword(phrase: string): string | null {
  let subject = phrase;
  const intro = introductions.find(prefix => subject.startsWith(prefix));
  if (intro) subject = subject.slice(intro.length);
  if (identityNames.includes(subject) || ['助手', '助理', '同学'].some(suffix => subject.endsWith(suffix))) return subject;
  return null;
}

function namedAnnouncement(head: string, identity: string) {
  return introductions.some(intro => {
    const prefix = intro + identity;
    return head.startsWith(prefix) && !productSuffix(head.slice(prefix.length)) && answeringDuty(head);
  });
}

function contextualVoicemail(head: string, phrase: string) {
  return head.includes(phrase)
    && ['话已', '电话已', '通话已', '已转', '转至', '转入', '您的电话', '您拨打', '你拨打'].some(prefix => head.startsWith(prefix))
    && containsPart(head, ['无法接听', '提示音后', '录音完成后']);
}

// Recognize complete carrier clauses independently: ASR can split the
// unavailability and notification into separate turns. A person's own
// "我现在无法接听" or discussion of a missed call does not meet this contract.
function carrierAnnouncement(head: string) {
  if (['本次呼叫将以', '此次呼叫将以', '本次通话将以'].some(prefix => head.startsWith(prefix))
    && phrasePresent(head, '方式') && notificationParts.some(part => phrasePresent(head, part))) return true;
  if (!unavailableParts.some(part => phrasePresent(head, part))) return false;
  if (['您拨打的电话', '你拨打的电话', '您拨打的用户', '你拨打的用户', '您尝试联系的用户', '你尝试联系的用户', 'thepersonyouaretryingtoreach'].some(prefix => head.startsWith(prefix))) return true;
  if (['您的呼叫现在无法接听', '您的呼叫暂时无法接听', '你的呼叫现在无法接听', '你的呼叫暂时无法接听'].some(prefix => head.startsWith(prefix))) return true;
  return ['您的呼叫', '你的呼叫', '本次呼叫', '此次呼叫', '本次通话'].some(prefix => head.startsWith(prefix))
    && notificationParts.some(part => phrasePresent(head, part));
}

// This pure semantic veto is also used by final intent analysis. Rule enablement
// still controls live hangup; a known automated notice cannot prove a human's
// business interest even when a workspace intentionally disables hangup.
export function isAutomaticAnnouncement(text: string): boolean {
  if (quotedAnnouncement(text)) return false;
  const context = buildAssistantAnnouncementHead(normalizeKeyword(text));
  if (!context.head || context.reported) return false;
  if (structuredProxyAnnouncement(context.head)) return true;
  if (carrierAnnouncement(context.head)) return true;
  const known = knownIntroduction(context.introHead);
  if (known && !productSuffix(known.suffix) && answeringDuty(context.introHead)) return true;
  return ['转至', '转到', '转入', '电话已', '话已', '已转', '通话已', '您的通话', '您拨打', '你拨打', '欢迎使用语音信箱', '这里是语音信箱', '我是语音信箱', '请在提示音后', '请在嘟声后', '请在滴声后', '请在蜂鸣声后', '请在录音完成后', 'yourcallhasbeen', 'pleaseleaveamessageafterthetone'].some(prefix => context.head.startsWith(prefix))
    && broadcastFeature(context.head);
}

// A screening service can omit its name. Require a complete screening duty or
// recording instruction; a reference to a name, an owner or a message is not enough.
function structuredProxyAnnouncement(head: string): boolean {
  const present = (parts: string[]) => parts.some(part => phrasePresent(head, part));
  const identityRequest = ['请留下', '请说出', '请告知', '请提供', '请说明'].some(prefix => head.startsWith(prefix))
    && present(['姓名', '名字']) && present(['来电原因', '来电事由']);
  const screeningDuty = present(['我会帮你确认', '我会帮您确认', '我将帮你确认', '我将帮您确认', '我会为你确认', '我会为您确认'])
    && present(['此人', '机主', '主人', '对方']) && present(['是否方便接听', '是否能够接听', '是否可以接听']);
  if (screeningDuty && (identityRequest || ['我会', '我将'].some(prefix => head.startsWith(prefix)) && present(['此人', '机主', '主人']))) return true;
  const recordingInstruction = present(['提示音后', '嘟声后', '滴声后', '蜂鸣声后']) && present(['留言', '录制留言', '回复']);
  return recordingInstruction && ['请在', '若要留言', '如需留言', '如果需要留言', '此人暂时无法接听', '对方暂时无法接听', '机主暂时无法接听', '主人暂时无法接听'].some(prefix => head.startsWith(prefix));
}

function broadcastFeature(phrase: string) {
  if (Array.from(phrase).length < 6) return false;
  if (structuredProxyAnnouncement(phrase)) return true;
  const voicemail = containsPart(phrase, ['语音留言', '语音信箱', '语音流言', 'voicemail']);
  if (voicemail && containsPart(phrase, ['转至', '转到', '转入', '已转', '欢迎使用', '这里是', '我是', 'forwarded', 'welcometo', 'thisis'])) return true;
  if (containsPart(phrase, ['提示音后', '嘟声后', '滴声后', '蜂鸣声后', '录音完成后']) && phrase.includes('留言')) return true;
  if (phrase.includes('leaveamessage') && phrase.includes('afterthetone')) return true;
  if (containsPart(phrase, ['您拨打', '你拨打', '您尝试联系的用户', '你尝试联系的用户', 'thepersonyouaretryingtoreach'])
    && containsPart(phrase, ['无法接听', '无人接听', '正在通话中', 'unavailable'])) return true;
  if (carrierAnnouncement(phrase)) return true;
  const known = knownIntroduction(phrase);
  return !!known && !productSuffix(known.suffix) && answeringDuty(phrase);
}

function phrasePresent(head: string, phrase: string) {
  if (!phrase) return false;
  for (let start = 0; start < head.length;) {
    const position = head.indexOf(phrase, start);
    if (position < 0) return false;
    if (phraseAllowedAt(head, position)) return true;
    start = position + phrase.length;
  }
  return false;
}

function phraseAllowedAt(head: string, position: number) {
  let prefix = Array.from(head.slice(0, position)).slice(-8).join('');
  // Adjacent explicit negation also protects contained features. An unrelated
  // warning such as “不要挂断” does not negate a later mailbox instruction.
  for (let index = 0; index < 2; index++) {
    for (const modifier of ['已经', '自动', '直接', '再次', '现在', '进行', '予以', '被']) if (prefix.endsWith(modifier)) prefix = prefix.slice(0, -modifier.length);
  }
  return !['没有', '并未', '从未', '不会', '不是', '并非', '不要', '不曾', '不想', '不用', '未', '没', '不'].some(negative => prefix.endsWith(negative));
}

// Names and short generic words require an identity plus an answering duty.
// Only complete automatic-broadcast features may occur inside the first 120
// code points; other long phrases retain their announcement-start semantics.
export function matchesAssistantAnnouncement(context: AssistantAnnouncementHead, phrase: string, identityOnly = false): boolean {
  if (!phrase || !context.head || context.reported) return false;
  if (Array.from(phrase).length >= 4 && structuredProxyAnnouncement(context.head) && phrasePresent(context.head, phrase)) return true;
  if (['语音留言', '语音信箱', '语音流言'].includes(phrase)) return !identityOnly && contextualVoicemail(context.head, phrase) && phrasePresent(context.head, phrase);
  const identity = identityKeyword(phrase);
  const named = namedAnnouncement(context.introHead, identity ?? phrase);
  if (!identityOnly && identity === null && [...unavailableParts, ...notificationParts].includes(phrase)
    && carrierAnnouncement(context.head) && phrasePresent(context.head, phrase)) return true;
  if (identityOnly || identity !== null || Array.from(phrase).length < 6) return named;
  if (context.head.startsWith(phrase)) return true;
  return named || broadcastFeature(phrase) && phrasePresent(context.head, phrase);
}

// Only the literal ".*" separator is supported. Each bounded segment is
// normalized independently and matched in order without executing a regex.
// Wildcards cannot turn an assistant name or a generic word into a hangup.
export function matchesAssistantAnnouncementKeyword(context: AssistantAnnouncementHead, keyword: string, identityOnly = false): boolean {
  if (quotedAnnouncement(keyword) || !context.head || context.reported) return false;
  if (!keyword.includes('.*')) return matchesAssistantAnnouncement(context, normalizeKeyword(keyword), identityOnly);
  const parts = keyword.split('.*').map(normalizeKeyword);
  if (identityOnly && !structuredProxyAnnouncement(context.head) || parts.length > 5 || parts.some(part => !part) || Array.from(parts.join('')).length < 6) return false;
  let start = -1, end = 0;
  for (const part of parts) {
    const position = context.head.indexOf(part, end);
    if (position < 0 || !phraseAllowedAt(context.head, position)) return false;
    if (start < 0) start = position;
    end = position + part.length;
  }
  const span = context.head.slice(start, end);
  return structuredProxyAnnouncement(context.head) || carrierAnnouncement(context.head) || broadcastFeature(span)
    || start === 0 && Array.from(parts[0]!).length >= 6 && identityKeyword(parts[0]!) === null;
}
