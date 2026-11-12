/*
 * 中文导读：共享基础能力：client.ts。相关类型、配置或辅助实现集中在本文件。
 * 请求携带登录凭据；401 会回到登录页，429 会临时抑制后续请求并把错误交给页面。
 * 后端写操作仍负责权限和并发冲突校验，此客户端不代替服务端授权。
 */
import { businessMessage } from "@/src/lib/business-copy";
import axios, { AxiosInstance } from "axios";
import { apiPath } from "@/src/lib/links";
import { ApiError, toApiError } from "@/src/lib/errors";

export const apiBaseUrl = apiPath("");

export const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

let retryAt = 0;
apiClient.interceptors.request.use((config) => {
  // Suppress polling, focus refetches and manual clicks during the server's
  // cooldown. Fail locally; never queue mutations to run unexpectedly later.
  if (typeof window !== "undefined" && Date.now() < retryAt) {
    const error = new ApiError("请求过于频繁，请稍后重试。", 429, "RATE_LIMITED");
    error.retryAt = retryAt;
    throw error;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const apiErr = toApiError(err);
    if (typeof window !== "undefined") apiErr.message = businessMessage(apiErr.message);
    if (apiErr.status === 429 && typeof window !== "undefined") {
      retryAt = Math.max(retryAt, apiErr.retryAt ?? Date.now() + 60_000);
    }
    if (apiErr.status === 401 && typeof window !== "undefined") {
      if (!window.location.pathname.startsWith("/login")) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- This interceptor runs outside React; a full navigation resets stale session state after a 401.
        window.location.href = "/login";
      }
    }
    return Promise.reject(apiErr);
  }
);
/* 中文注释：从后端统一响应封套中取出 data，供资源接口复用。 */


// Unwrap { success, message, data } → data
export async function unwrap<T>(p: Promise<{ data: { data: T } }>): Promise<T> {
  const res = await p;
  return res.data.data;
}
