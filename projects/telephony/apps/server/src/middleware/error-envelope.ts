/*
 * 中文导读：HTTP 请求中间件：error-envelope。在业务处理前后执行本文件定义的公共规则。
 */
import type { Request } from "express";

type FieldErrors = Record<string, string[]>;

export type ErrorEnvelopeArgs = {
  code: string;
  message: string;
  details?: unknown;
  fieldErrors?: FieldErrors;
  requestId?: string | null;
};

export function createErrorEnvelope({
  code,
  message,
  details = null,
  fieldErrors = {},
  requestId = null,
}: ErrorEnvelopeArgs) {
  return {
    success: false,
    code,
    message,
    details,
    fieldErrors,
    requestId,
  };
}

export function getRequestId(req: Request) {
  return (
    getHeaderValue(req.headers["x-request-id"]) ??
    getHeaderValue(req.headers["x-correlation-id"])
  );
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  // Correlation IDs are diagnostic labels, never arbitrary header contents.
  return typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(candidate)
    ? candidate : null;
}
