/*
 * 中文导读：线路与语音外呼：attempt-line.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { Row } from '../crm/crm.service.js';
import type { LineSettings } from './sip.schema.js';

// New attempts preserve the exact line used at dispatch; older calls retain
// their original per-recipient route or manual-call line without rewriting history.
export function attemptLine(attempt: Row): LineSettings | undefined {
  return attempt.result?.dispatchedLine || attempt.snapshot?.routes?.[attempt.recipientIndex]?.line || attempt.snapshot?.route?.line || attempt.snapshot?.line;
}
