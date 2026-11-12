/*
 * 中文导读：通用组件：phoneNumberGuards.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { PhoneNumber } from "../../../prisma/generated/prisma/client.js";

export function isSeedPhoneNumber(existing: Pick<PhoneNumber, "sid">) {
  return existing.sid.startsWith("SEED");
}
