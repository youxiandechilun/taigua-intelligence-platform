/*
 * 中文导读：共享基础能力：account-login.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { normalizeMemberAccount } from "./member-batch";

export function accountLoginEmail(value: string, domain: string) {
  const account = normalizeMemberAccount(value);
  // Existing identities keep their stored email; managed aliases use the same
  // UTF-8 encoding as account creation and account-name editing on the server.
  if (account.includes("@")) return account;
  const alias = /\p{Script=Han}/u.test(account)
    ? "cn-" + Array.from(new TextEncoder().encode(account), byte => byte.toString(16).padStart(2, "0")).join("")
    : account;
  return `${alias}@${domain}`;
}
