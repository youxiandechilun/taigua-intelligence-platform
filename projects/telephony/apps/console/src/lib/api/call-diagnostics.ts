/*
 * 中文导读：共享基础能力：call-diagnostics.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const callReason:Record<string,string>={REDIAL_LINE_UNAVAILABLE:'重拨线路已变化或不可用，请重新选择',CALLBACK_COMPLETED:'通话正常结束',CALLBACK_NOT_CONNECTED:'平台话单显示未接通',CALLBACK_EMPLOYEE_ABANDONED:'员工未接听或已取消',CALLBACK_CUSTOMER_ABANDONED:'客户未接听或已取消',CALLBACK_REJECTED:'平台未接受请求，请核对授权与额度',CALLBACK_UNCERTAIN:'拨号响应待核对，未自动重拨',CALLBACK_REQUESTED:'平台已受理，等待话单',ANSWERING_MACHINE:'语音助手接听，已自动挂断',NORMAL_CLEARING:'正常结束',RETRY_POLICY_DISABLED:'已取消后续重拨',NO_ANSWER:'无人接听',NO_USER_RESPONSE:'线路返回无响应，未接通',USER_BUSY:'客户忙线',EMPLOYEE_UNAVAILABLE:'员工接听线路未接通',SERVICE_BUSY:'电话服务忙',VOICE_SERVICE_ERROR:'语音服务异常',NORMAL_TEMPORARY_FAILURE:'线路暂时不可用',CALL_REJECTED:'呼叫被拒绝，请查看线路诊断',UNALLOCATED_NUMBER:'线路返回号码不可达，请核对号码与线路',ORIGINATOR_CANCEL:'主动结束',EMPLOYEE_NO_ANSWER:'员工未接听',EMPLOYEE_NO_USER_RESPONSE:'员工接听号码未接通，线路返回无响应',EMPLOYEE_USER_BUSY:'员工号码忙线',EMPLOYEE_CALL_REJECTED:'员工呼叫被拒绝，请核对线路参数',EMPLOYEE_UNALLOCATED_NUMBER:'员工号码或被叫前缀无效',EMPLOYEE_NORMAL_CLEARING:'员工通话已结束，尚未连接客户',EMPLOYEE_ORIGINATOR_CANCEL:'员工呼叫已取消',EMPLOYEE_NORMAL_TEMPORARY_FAILURE:'员工接听线路暂不可用',EMPLOYEE_NETWORK_OUT_OF_ORDER:'员工接听线路网络异常',EMPLOYEE_DESTINATION_OUT_OF_ORDER:'员工接听线路不可达',EMPLOYEE_RECOVERY_ON_TIMER_EXPIRE:'员工接听线路响应超时',EMPLOYEE_INCOMPATIBLE_DESTINATION:'员工接听线路编码不兼容',EMPLOYEE_INVALID_GATEWAY:'员工接听线路配置异常',EMPLOYEE_INVALID_PROFILE:'外线通话引擎配置异常'};

export type CallDiagnostics = { sipStatus?: number; cause?: string; sipDisposition?: string; leg?: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const reasonCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : '';
export function callDiagnostics(value: unknown): CallDiagnostics | null {
  const raw = object(value);
  const sipStatus = typeof raw.sipStatus === 'number' && Number.isInteger(raw.sipStatus) && raw.sipStatus >= 100 && raw.sipStatus <= 699 ? raw.sipStatus : undefined;
  const cause = reasonCode(raw.cause) || undefined;
  const sipDisposition = reasonCode(raw.sipDisposition) || undefined;
  const leg = raw.leg === 'EMPLOYEE' || raw.leg === 'CUSTOMER' ? raw.leg : undefined;
  return sipStatus !== undefined || cause || sipDisposition || leg ? { sipStatus, cause, sipDisposition, leg } : null;
}
// SIP response meanings follow RFC 3261, section 21. A code alone cannot identify a carrier's account restriction.
const sipMessages: Record<number, string> = {
  400: 'SIP 请求格式不被接受', 401: 'SIP 服务要求身份认证',
  402: '线路返回 SIP 402，具体含义请与线路商确认',
  403: 'SIP 服务拒绝本次呼叫，具体限制需结合线路商回执确认',
  404: 'SIP 服务未找到被叫地址或目标域', 407: 'SIP 代理要求身份认证',
  408: 'SIP 请求等待响应超时', 480: '被叫暂时不可用', 484: '被叫地址不完整',
  486: '被叫忙线', 488: 'SIP 会话参数不被接受',
  500: 'SIP 服务内部错误', 502: 'SIP 网关收到无效上游响应',
  503: 'SIP 服务暂时不可用', 504: 'SIP 服务等待上游响应超时',
  600: '被叫所有终端忙线', 603: '呼叫被拒绝',
};
export function callReasonText(reason: string, diagnostics?: CallDiagnostics | null) {
  const code = callDiagnostics(diagnostics)?.sipStatus;
  const explanation = callReason[reason] || reason || '原因未记录';
  if (code === undefined) return explanation;
  if (reason === 'VOICE_SERVICE_ERROR') return `${explanation}（SIP ${code}）`;
  return `${sipMessages[code] || explanation}（SIP ${code}）`;
}
export function callFailure(metadata: unknown, status: string) {
  const raw = object(metadata);
  const reason = reasonCode(raw.disposition) || reasonCode(raw.reason);
  const diagnostics = callDiagnostics(raw.diagnostics);
  const failed = ['FAILED', 'NOT_ANSWERED', 'NEEDS_REVIEW'].includes(status);
  const sipFailure = diagnostics?.sipStatus !== undefined && diagnostics.sipStatus >= 300;
  const serviceFailure = reason === 'VOICE_SERVICE_ERROR' || reason === 'SERVICE_BUSY';
  if (!failed && !sipFailure && !serviceFailure) return null;
  const code = serviceFailure ? reason : sipFailure ? `SIP ${diagnostics!.sipStatus}` : reason || '错误码未记录';
  return { reason, diagnostics, code, message: callReasonText(reason, diagnostics) };
}
