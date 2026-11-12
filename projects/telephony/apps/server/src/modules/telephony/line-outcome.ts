/*
 * 中文导读：线路与语音外呼：line-outcome.ts。相关类型、配置或辅助实现集中在本文件。
 */
type OutcomeEvent = {
  state: string;
  reason: string;
  durationSeconds?: number;
  diagnostics?: {sipStatus?: number};
};

// Only a completed telephone exchange proves recovery. Recipient-specific
// failures and model errors are neutral; they must neither trip nor heal a line.
export function lineOutcome(event: OutcomeEvent, wasConnected = false): boolean | null {
  if (wasConnected || event.state === 'COMPLETED' || Number(event.durationSeconds) > 0) return true;
  if (['VOICE_SERVICE_ERROR','ANSWERING_MACHINE','ORIGINATOR_CANCEL'].includes(event.reason)) return null;
  const status = event.diagnostics?.sipStatus;
  if (status !== undefined) {
    if ([401,402,403,407,420,488,500,502,503,504,505,513,580].includes(status)) return false;
    if ([486,600,603].includes(status)) return true;
    // A 404 can identify a nonexistent destination. It is not evidence that the
    // entire carrier is unavailable, and must not refresh lastSuccessAt either.
    if (status >= 400) return null;
  }
  if (['INVALID_GATEWAY','INVALID_PROFILE','NETWORK_OUT_OF_ORDER','DESTINATION_OUT_OF_ORDER','NORMAL_TEMPORARY_FAILURE','RECOVERY_ON_TIMER_EXPIRE','SERVICE_UNAVAILABLE','INCOMPATIBLE_DESTINATION','INTERWORKING'].includes(event.reason)) return false;
  if (event.reason === 'USER_BUSY') return true;
  return null;
}
