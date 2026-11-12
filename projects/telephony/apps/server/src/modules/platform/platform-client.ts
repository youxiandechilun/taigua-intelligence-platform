/** 平台内部接口客户端，凭据仅在服务端使用。 */
import CustomApiError from '../../common/errors/customApiError.js';
export interface PlatformIdentity {
  mid: string;
  merchant_name: string;
  agent_id: number;
  slug: string;
  balance: number;
  expire_at: number;
  external_user_id: string;
  session_token: string;
}

export interface PlatformModel {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
  timeout_seconds: number;
}

export interface PlatformTelephony {
  enabled: boolean;
  provider: string;
  base_url: string;
  api_key: string;
  sip_domain: string;
  sip_username: string;
  sip_password: string;
  caller_id: string;
  tts_provider: string;
  tts_model: string;
  voice_id: string;
  realtime_model: string;
  asr_base_url: string;
  asr_model: string;
  asr_api_key: string;
  bridge_url: string;
  bridge_token: string;
  server_ip: string;
  port: number;
  transport: string;
  prefix: string;
  concurrency: number;
  calls_per_second: number;
  live_enabled: boolean;
  whitelist_confirmed: boolean;
  aliyun_access_key_id: string;
  aliyun_access_key_secret: string;
  aliyun_region: string;
  aliyun_application_code: string;
  aliyun_caller_number: string;
  aliyun_gateway_token: string;
  aliyun_receipt_token: string;
}

export interface PlatformWecom {
  corp_id: string;
  agent_id: string;
  corp_secret: string;
  token: string;
  encoding_aes_key: string;
  webhook_url: string;
}

export interface PlatformConfiguration {
  model: PlatformModel;
  telephony: PlatformTelephony;
  wecom: PlatformWecom;
}

export interface PlatformHold {
  hold_id: string;
  held: number;
  balance: number;
}

interface PointRequest {
  mid: string;
  agent_slug: string;
  action: string;
  quantity: number;
  request_id: string;
}

export class PlatformApiError extends CustomApiError {
  code: string;

  constructor(message: string, statusCode = 503, code = 'PLATFORM_UNAVAILABLE') {
    super(message, statusCode, { code });
    this.name = 'PlatformApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const platformEnabled = () => Boolean(process.env.TAIGUA_PLATFORM_URL?.trim());
export const platformAgentSlug = () => process.env.TAIGUA_AGENT_SLUG?.trim() || 'ztgh';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformApiError('平台返回的数据格式异常。');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PlatformApiError('平台返回的数值格式异常。');
  }
  return value;
}

function configuration() {
  const base = process.env.TAIGUA_PLATFORM_URL?.trim();
  const key = process.env.INTERNAL_API_KEY?.trim();
  if (!base || !key) throw new PlatformApiError('平台连接尚未配置。');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new PlatformApiError('平台连接地址无效。');
  }
  return { base: url.href.replace(/\/$/, ''), key };
}

async function request(path: string, body?: object): Promise<unknown> {
  const config = configuration();
  let response: Response;
  try {
    response = await fetch(config.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Internal-Key': config.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new PlatformApiError('平台暂时无法连接，请稍后重试。');
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = object(await response.json());
  } catch {
    throw new PlatformApiError('平台返回的数据格式异常。');
  }
  if (!response.ok || envelope.ok !== true) {
    throw new PlatformApiError(
      string(envelope.msg, '平台请求未完成。'),
      response.status >= 400 ? response.status : 503,
      string(envelope.code, 'PLATFORM_REQUEST_FAILED'),
    );
  }
  return envelope.data;
}

function identity(raw: unknown): PlatformIdentity {
  const data = object(raw);
  const mid = typeof data.mid === 'number' ? String(data.mid) : string(data.mid);
  if (!mid || !string(data.slug) || !string(data.session_token)) {
    throw new PlatformApiError('平台身份信息不完整。');
  }
  return {
    mid,
    merchant_name: string(data.merchant_name, '平台商户'),
    agent_id: count(data.agent_id),
    slug: string(data.slug),
    balance: count(data.balance),
    expire_at: count(data.expire_at),
    external_user_id: string(data.external_user_id),
    session_token: string(data.session_token),
  };
}

export async function redeemPlatformTicket(token: string): Promise<PlatformIdentity> {
  return identity(await request('/api/internal/sso/redeem', { token, agent_slug: platformAgentSlug() }));
}

export async function validatePlatformSession(token: string): Promise<PlatformIdentity> {
  return identity(await request('/api/internal/sso/validate', { token, agent_slug: platformAgentSlug() }));
}

let cachedConfiguration: { value: PlatformConfiguration; expires: number } | undefined;
let pendingConfiguration: Promise<PlatformConfiguration> | undefined;
export async function platformConfiguration(): Promise<PlatformConfiguration> {
  if (cachedConfiguration && cachedConfiguration.expires > Date.now()) return cachedConfiguration.value;
  if (!pendingConfiguration) pendingConfiguration = loadPlatformConfiguration().then(value => {
    cachedConfiguration = { value, expires: Date.now() + 5000 };
    return value;
  }).finally(() => { pendingConfiguration = undefined; });
  return pendingConfiguration;
}

async function loadPlatformConfiguration(): Promise<PlatformConfiguration> {
  const data = object(await request('/api/internal/config?slug=' + encodeURIComponent(platformAgentSlug())));
  const model = object(data.model);
  const telephone = object(data.telephony || {});
  const wecom = object(data.wecom || {});
  return {
    model: {
      enabled: model.enabled === true,
      base_url: string(model.base_url),
      api_key: string(model.api_key),
      model: string(model.model),
      timeout_seconds: typeof model.timeout_seconds === 'number' ? Math.max(1, Math.min(120, model.timeout_seconds)) : 30,
    },
    telephony: {
      enabled: telephone.enabled === true,
      provider: string(telephone.provider),
      base_url: string(telephone.base_url),
      api_key: string(telephone.api_key),
      sip_domain: string(telephone.sip_domain),
      sip_username: string(telephone.sip_username),
      sip_password: string(telephone.sip_password),
      caller_id: string(telephone.caller_id),
      tts_provider: string(telephone.tts_provider),
      tts_model: string(telephone.tts_model),
      voice_id: string(telephone.voice_id),
      realtime_model: string(telephone.realtime_model),
      asr_base_url: string(telephone.asr_base_url),
      asr_model: string(telephone.asr_model),
      asr_api_key: string(telephone.asr_api_key),
      bridge_url: string(telephone.bridge_url),
      bridge_token: string(telephone.bridge_token),
      server_ip: string(telephone.server_ip),
      port: typeof telephone.port === 'number' ? telephone.port : 5060,
      transport: string(telephone.transport, 'udp'),
      prefix: string(telephone.prefix),
      concurrency: typeof telephone.concurrency === 'number' ? telephone.concurrency : 1,
      calls_per_second: typeof telephone.calls_per_second === 'number' ? telephone.calls_per_second : 1,
      live_enabled: telephone.live_enabled === true,
      whitelist_confirmed: telephone.whitelist_confirmed === true,
      aliyun_access_key_id: string(telephone.aliyun_access_key_id),
      aliyun_access_key_secret: string(telephone.aliyun_access_key_secret),
      aliyun_region: string(telephone.aliyun_region, 'cn-shanghai'),
      aliyun_application_code: string(telephone.aliyun_application_code),
      aliyun_caller_number: string(telephone.aliyun_caller_number),
      aliyun_gateway_token: string(telephone.aliyun_gateway_token),
      aliyun_receipt_token: string(telephone.aliyun_receipt_token),
    },
    wecom: {
      corp_id: string(wecom.corp_id), agent_id: string(wecom.agent_id), corp_secret: string(wecom.corp_secret),
      token: string(wecom.token), encoding_aes_key: string(wecom.encoding_aes_key), webhook_url: string(wecom.webhook_url),
    },
  };
}

export async function reservePlatformPoints(input: PointRequest): Promise<PlatformHold> {
  const data = object(await request('/api/internal/points/reserve', input));
  if (!string(data.hold_id)) throw new PlatformApiError('平台未返回有效的冻结记录。');
  return { hold_id: string(data.hold_id), held: count(data.held), balance: count(data.balance) };
}

export async function settlePlatformPoints(holdId: string, quantity: number): Promise<void> {
  await request('/api/internal/points/settle', { hold_id: holdId, actual_quantity: quantity });
}

export async function releasePlatformPoints(holdId: string, reason: string): Promise<void> {
  await request('/api/internal/points/release', { hold_id: holdId, reason });
}

export async function platformBalance(mid: string): Promise<{ balance: number; frozen: number }> {
  const data = object(await request('/api/internal/merchant/balance?mid=' + encodeURIComponent(mid)));
  return { balance: count(data.balance), frozen: count(data.frozen) };
}
