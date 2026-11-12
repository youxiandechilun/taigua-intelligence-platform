/*
 * 中文导读：数字员工与话术：generated-instructions.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { naturalTelephoneRulesSection } from './agent.conversation.js';

// Only whole, known system-generated sections are deduplicated. Never parse,
// shorten or remove arbitrary business instructions supplied by the user.
export function appendGeneratedInstructions(input: string, sections: string[]): string {
  let result = input;
  for (const raw of sections) {
    const section = raw.trim();
    if (!section) continue;
    const first = result.indexOf(section);
    if (first < 0) {
      result = result.trimEnd() + (result.trim() ? '\n\n' : '') + section;
      continue;
    }
    const end = first + section.length;
    result = result.slice(0, end) + result.slice(end).split(section).join('');
  }
  return result;
}
// This exact boundary was emitted by releaseRuntime before voice-expression
// settings. Business prompts appear before it, including arbitrary headings
// inside the user's AI work instructions.
export const runtimeVoiceBoundary = '这些规则统一日常电话表达。未填写的变量不得念给客户；涉及资料、转接和联系操作时以真实工具回执为准。';
const runtimeVoiceStart = '【Runtime voice binding】';
const runtimeVoiceEnd = '【End runtime voice binding】';


export type RuntimeVoiceBinding = { gender?: string; expression?: string; language?: string };

// Called after selecting the actual opening speaker. Exact new expressions
// and bounded legacy generator lines can change; the user's business prompt
// and any custom voice requirements inside it remain byte-for-byte intact.
export function applyRuntimeVoice(input: string, binding: RuntimeVoiceBinding, previousExpression?: string): string {
  if (binding.gender === undefined && binding.expression === undefined) return input;
  let instructions = input;
  let previousBody = '';
  const ownStart = instructions.lastIndexOf(runtimeVoiceStart);
  const ownEnd = ownStart < 0 ? -1 : instructions.indexOf(runtimeVoiceEnd, ownStart);
  const boundaryBeforeOwn = instructions.lastIndexOf(runtimeVoiceBoundary);
  if (ownStart >= 0 && ownEnd >= ownStart && (boundaryBeforeOwn < 0 || ownStart > boundaryBeforeOwn)) {
    previousBody = instructions.slice(ownStart + runtimeVoiceStart.length, ownEnd).trim();
    instructions = instructions.slice(0, ownStart) + instructions.slice(ownEnd + runtimeVoiceEnd.length);
  }
  const priorGender = previousBody.match(/^(?:角色性别：(女|男|中性)|Speaker gender: (female|male|neutral))$/m);
  const priorExpression = previousBody.replace(/^(?:角色性别：(女|男|中性)|Speaker gender: (female|male|neutral))\r?\n?/m, '').trim();
  const gender = binding.gender ?? (priorGender?.[1] === '女' ? 'female' : priorGender?.[1] === '男' ? 'male' : priorGender?.[2] || (priorGender ? 'neutral' : undefined));
  const expression = binding.expression ?? priorExpression;
  const boundaryAt = instructions.lastIndexOf(runtimeVoiceBoundary);
  if (boundaryAt >= 0) {
    // Match the legacy wrapper before deduplicating its repeated rules section.
    // The exact rules-to-boundary adjacency proves that this is a generated
    // wrapper; never scan the surrounding AI work instructions for role lines.
    if (gender !== undefined) {
      const headingAt = instructions.lastIndexOf(naturalTelephoneRulesSection, boundaryAt);
      const roleAt = headingAt < 0 ? -1 : instructions.lastIndexOf('\n角色性别：', headingAt);
      const knownWrapper = headingAt >= 0 && !instructions.slice(headingAt + naturalTelephoneRulesSection.length, boundaryAt).trim();
      if (knownWrapper && roleAt >= 0 && /^\n角色性别：(女|男|中性)\r?\n(?:\r?\n)*$/.test(instructions.slice(roleAt, headingAt))) {
        instructions = instructions.slice(0, roleAt) + '\n' + instructions.slice(headingAt);
      }
    }
    const floor = instructions.lastIndexOf(runtimeVoiceBoundary) + runtimeVoiceBoundary.length;
    let suffix = instructions.slice(floor);
    if (binding.expression !== undefined) {
      const exact = previousExpression?.trim();
      const exactAt = exact ? suffix.lastIndexOf(exact) : -1;
      if (exact && exactAt >= 0) suffix = suffix.slice(0, exactAt) + suffix.slice(exactAt + exact.length);
      // Legacy generated expression sections were single lines. Restrict the
      // fallback to the release suffix after its known provenance boundary.
      suffix = suffix.replace(/^【(?:系统统一声音调教|本人表达细调|本人开场参考)】[^\r\n]*(?:\r?\n|$)/gm, '');
    }
    instructions = instructions.slice(0, floor) + suffix;
  } else if (binding.expression !== undefined && previousExpression?.trim()) {
    // Isolated demo snapshots have no release boundary. Replace only an exact
    // generated expression at their end; do not search arbitrary reference Q&A.
    const exact = previousExpression.trim();
    const trimmed = instructions.trimEnd();
    if (trimmed.endsWith(exact)) instructions = trimmed.slice(0, -exact.length);
  }
  if (instructions.includes(naturalTelephoneRulesSection)) {
    instructions = appendGeneratedInstructions(instructions, [naturalTelephoneRulesSection]);
  }
  const genderLine = gender === undefined ? '' : binding.language === 'en'
    ? 'Speaker gender: ' + (gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'neutral')
    : '角色性别：' + (gender === 'female' ? '女' : gender === 'male' ? '男' : '中性');
  const body = [genderLine, expression].filter(value => value?.trim()).join('\n');
  return body ? appendGeneratedInstructions(instructions, [runtimeVoiceStart + '\n' + body + '\n' + runtimeVoiceEnd]) : instructions;
}
