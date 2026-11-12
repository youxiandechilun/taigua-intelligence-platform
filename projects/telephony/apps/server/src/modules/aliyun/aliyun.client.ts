/*
 * 中文导读：阿里云连接：aliyun.client.ts。相关类型、配置或辅助实现集中在本文件。
 */
import Outboundbot from "@alicloud/outboundbot20251111";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";
import CustomApiError from "../../common/errors/customApiError.js";

// CJS SDK publishes its constructor as `default` inside the module object.
export const OutboundbotClient = Outboundbot.default;
export const models = Outboundbot;
export const rpcRuntime = () => new RuntimeOptions({
  autoretry: false, maxAttempts: 1, readTimeout: 20000, connectTimeout: 10000,
});

export type CloudCredentials = {
  accessKeyId?: string; accessKeySecret?: string; securityToken?: string; dashscopeApiKey?: string;
};

export function cloudClient(regionId: string, credentials: CloudCredentials) {
  if (!credentials.accessKeyId || !credentials.accessKeySecret) {
    throw new CustomApiError("请先在阿里云配置中保存 AccessKey ID 和 AccessKey Secret。", 409);
  }
  return new OutboundbotClient(new $OpenApiUtil.Config({
    regionId, endpoint: `outboundbot.${regionId}.aliyuncs.com`, protocol: "https",
    accessKeyId: credentials.accessKeyId, accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
  }));
}

export async function cloudData<T>(operation: () => Promise<{ body?: {
  success?: boolean; code?: string; data?: T; requestId?: string;
} }>): Promise<T> {
  try {
    const response = await operation();
    const body = response.body;
    if (!body || body.success !== true || body.data === undefined) {
      throw new CustomApiError("阿里云未确认本次操作成功，请检查产品开通状态、实例和 RAM 权限。", 502, {
        code: body?.code ?? "ALIYUN_UNCONFIRMED",
        details: { requestId: body?.requestId },
      });
    }
    return body.data;
  } catch (error) {
    if (error instanceof CustomApiError) throw error;
    const e = error as { code?: string; data?: { RequestId?: string } };
    // Raw provider errors may contain a canonical signed request. Never expose them.
    throw new CustomApiError("阿里云接口请求失败。请检查密钥权限、地域和实例；超时的外呼操作请先核对云端任务。", 502, {
      code: e.code ?? "ALIYUN_REQUEST_FAILED", details: { requestId: e.data?.RequestId },
    });
  }
}

export async function cloudAction(operation: () => Promise<{ body?: {
  success?: boolean; code?: string; requestId?: string;
} }>) {
  return cloudData(async () => {
    const response = await operation();
    return { body: response.body ? { ...response.body, data: true } : undefined };
  });
}
