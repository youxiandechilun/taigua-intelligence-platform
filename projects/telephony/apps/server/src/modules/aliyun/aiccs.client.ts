/*
 * 中文导读：阿里云连接：aiccs.client.ts。相关类型、配置或辅助实现集中在本文件。
 */
import Aiccs from "@alicloud/aiccs20191015";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import type { CloudCredentials } from "./aliyun.client.js";
import { BadRequestError } from "../../common/errors/badRequest.js";

export const aiccsModels = Aiccs;
export function aiccsClient(regionId: string, credentials: CloudCredentials) {
  if (!credentials.accessKeyId || !credentials.accessKeySecret)
    throw new BadRequestError("通信智能体参数已准备；还需保存具备 AICCS 权限的服务端 AccessKey。");
  return new Aiccs.default(new $OpenApiUtil.Config({
    regionId, endpoint: "aiccs.aliyuncs.com", protocol: "https",
    accessKeyId: credentials.accessKeyId, accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
  }));
}
