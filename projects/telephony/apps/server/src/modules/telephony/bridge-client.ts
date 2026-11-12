/*
 * 中文导读：应用后端与 SIP 语音桥之间的请求适配。
 */
import { BadRequestError } from '../../common/errors/badRequest.js';

export class BridgeRequestError extends BadRequestError {
  constructor(message: string, code: string, readonly bridgeStatus: number | null, readonly rejectedBeforeDispatch = false) {
    super(message);
    this.code = code;
  }
}

const bridgeBase = () => {
  const url = new URL(process.env.SIP_BRIDGE_URL || 'http://127.0.0.1:8511');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password) throw new Error('SIP_BRIDGE_URL must be a loopback HTTP URL');
  return url.origin;
};

// Both the bearer credential and the target remain server-side and loopback-only.
export async function bridgeRequest(path: string, body?: unknown, range?: string, timeoutMs = 15000) {
  if (!process.env.SIP_BRIDGE_TOKEN) throw new BadRequestError('电话服务尚未配置，请联系系统管理员。');
  if (range !== undefined && (body !== undefined || !/^bytes=(?:\d{1,12}-\d{0,12}|-\d{1,12})$/.test(range))) throw new BadRequestError('录音范围请求无效。');
  const response = await fetch(bridgeBase() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + process.env.SIP_BRIDGE_TOKEN, 'Content-Type': 'application/json', ...(range === undefined ? {} : { Range: range }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => { throw new BridgeRequestError('电话服务暂不可用，任务已保留，请联系管理员。', 'BRIDGE_REQUEST_UNCONFIRMED', null); });
  if (!response.ok && !(range !== undefined && response.status === 416)) {
    // Only this exact, local validation response proves that no call was sent.
    // Unknown failures remain uncertain and must never trigger an automatic retry.
    const detail = (await response.text().catch(() => '')).trim();
    if (path === '/calls' && body !== undefined && response.status === 400 && detail === 'invalid speech synthesis settings') {
      throw new BridgeRequestError('声音合成配置不一致，电话尚未发起，请联系管理员同步声音配置。', 'VOICE_SYNTHESIS_CONFIG_MISMATCH', 400, true);
    }
    throw new BridgeRequestError('电话服务未接受操作，请核对服务状态。', 'BRIDGE_HTTP_' + response.status, response.status);
  }
  return response;
}
