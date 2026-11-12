/*
 * 中文导读：共享基础能力的前端接口封装，将页面调用连接到后端资源。
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient, unwrap } from "../client";
export const DEFAULT_LOGIN_SLOGAN = "让国货之光在全球市场绽放";
export interface PlatformBranding { loginSlogan: string }
export const platformBrandingApi = {
  get: () => unwrap<PlatformBranding>(apiClient.get("/platform-branding")),
  save: (data: PlatformBranding) => unwrap<PlatformBranding>(apiClient.put("/platform-branding", data)),
};
export function usePlatformBranding() {
  return useQuery({ queryKey: ["platform-branding"], queryFn: platformBrandingApi.get, staleTime: 0, retry: false, refetchOnMount: "always" });
}
