/*
 * 中文导读：员工账号：account-password.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
export const generateAccountPassword = () => {
  const letters = "abcdefghjkmnpqrstuvwxyz", digits = "23456789", alphabet = letters + digits;
  const chars = [letters[randomInt(letters.length)]!, digits[randomInt(digits.length)]!];
  while (chars.length < 10) chars.push(alphabet[randomInt(alphabet.length)]!);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
};
export const optionalAccountPassword = z.object({ password: z.string().min(8, "密码至少 8 位").max(72).refine(v => Buffer.byteLength(v, "utf8") <= 72, "密码最多 72 字节").optional() }).strict();
