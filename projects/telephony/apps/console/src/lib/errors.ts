/*
 * 中文导读：共享基础能力：errors.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { AxiosError, isAxiosError } from "axios";
import { userMessage } from "./locale";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  retryAt?: number;
  originalMessage: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(userMessage(message, code));
    this.originalMessage = message;
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (isAxiosError(err)) {
    const ax = err as AxiosError<{
      success?: boolean;
      code?: string;
      message?: string;
      details?: unknown;
      fieldErrors?: unknown;
      requestId?: unknown;
      error?: { code?: string; message?: string; details?: unknown; fieldErrors?: unknown; requestId?: unknown };
    }>;
    const status = ax.response?.status ?? 0;
    const body = ax.response?.data;
    const message =
      stringValue(body?.error?.message) ??
      stringValue(body?.message) ??
      ax.message ??
      "请求失败";
    const code = body?.error?.code ?? body?.code;
    const details = body?.error?.details ?? body?.details;
    const apiError = new ApiError(message, status, code, details);
    apiError.fieldErrors = fieldErrors(body?.error?.fieldErrors ?? body?.fieldErrors);
    apiError.requestId = safeRequestId(body?.requestId) ?? safeRequestId(body?.error?.requestId)
      ?? safeRequestId(ax.response?.headers?.["x-request-id"]);
    if (/\/telephony\/tasks(?:\/|\?|$)/.test(ax.config?.url ?? "")) {
      if (status === 400 && code === "VALIDATION_ERROR") {
        apiError.message = taskFieldMessage(apiError.fieldErrors, details)
          ?? "外呼填写内容不符合要求，请检查后重试。";
      }
      if (apiError.requestId) apiError.message += `（请求编号：${apiError.requestId}）`;
    }
    if (status === 429) {
      const retryAfter = String(ax.response?.headers?.["retry-after"] ?? "").trim();
      const now = Date.now();
      const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : NaN;
      const deadline = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retryAfter);
      apiError.retryAt = Number.isFinite(deadline) && deadline > now ? deadline : now + 60_000;
    }
    return apiError;
  }

  if (err instanceof Error) return new ApiError(err.message, 0);
  return new ApiError("未知错误", 0);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function safeRequestId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
    ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldErrors(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const fields: Record<string, string[]> = Object.create(null);
  for (const [path, messages] of Object.entries(value).slice(0, 20)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]{0,159}$/.test(path) || !Array.isArray(messages)) continue;
    const bounded = messages.filter((item): item is string => typeof item === "string" && item.length <= 300).slice(0, 3);
    if (bounded.length) fields[path] = bounded;
  }
  return Object.keys(fields).length ? fields : undefined;
}

const taskMessages = new Set([
  "任务名称最多100字。", "请填写1至100字的任务名称。", "请重新选择有效的数字员工。",
  "请重新选择有效的线路和省份。", "请选择1至6倍。", "原外呼倍数无效，请刷新任务后重试。",
  "预约开始时间格式不正确，请重新选择。", "预约结束时间格式不正确，请重新选择。",
  "提交编号无效，请刷新页面后重试。", "请重新确认本次外呼操作。", "请选择1至2000条有效的重拨记录。",
  "重拨范围无效，请重新选择。", "重拨次数应为0至3次。", "重拨间隔应为1至720分钟。",
  "重拨设置格式不正确，请重新填写。", "每次最多2000个号码，请分批导入。", "请至少添加1个客户号码。",
  "客户名单格式不正确，请重新导入。", "结束时间必须晚于开始时间。", "外呼填写内容不符合要求，请检查后重试。",
]);
const recipientMessages = new Set([
  "号码应为国内手机号或带区号的座机。", "客户姓名最多200字，请检查姓名格式。",
  "客户库关联无效，请重新选择客户。", "每位客户最多10个自定义变量。",
  "自定义变量名称最多100字，内容最多1000字。", "请选择联系人所属企业。",
  "客户信息格式不正确，请检查后重新导入。",
]);

function safeTaskMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (taskMessages.has(value)) return value;
  const row = /^第([1-9]\d{0,3})个客户：(.*)$/.exec(value);
  return row && Number(row[1]) <= 2000 && recipientMessages.has(row[2] ?? "") ? value : undefined;
}

function taskFieldMessage(fields: Record<string, string[]> | undefined, details: unknown) {
  const candidates: unknown[] = Object.values(fields ?? {}).flat();
  if (isRecord(details) && Array.isArray(details.issues)) {
    for (const issue of details.issues.slice(0, 20)) {
      if (isRecord(issue)) candidates.push(issue.message);
    }
  }
  // Field data and arbitrary provider text remain available in details for
  // diagnostics, but only fixed application copy may become the UI message.
  const safe = [...new Set(candidates.map(safeTaskMessage).filter((item): item is string => Boolean(item)))];
  return safe.length ? safe.slice(0, 3).join(" ") : undefined;
}

export function retryApiQuery(failureCount: number, error: Error) {
  if (failureCount >= 1) return false;
  return !(error instanceof ApiError) || error.status === 0 || error.status === 429 || error.status >= 500;
}

export function apiQueryRetryDelay(_attempt: number, error: Error) {
  if (error instanceof ApiError && error.status === 429) {
    return Math.max(1000, (error.retryAt ?? Date.now() + 60_000) - Date.now());
  }
  return 1000;
}
