/*
 * 中文导读：共享基础能力：account-display.ts。相关类型、配置或辅助实现集中在本文件。
 */
export function accountDisplayName(email: string | undefined | null) {
  const username = (email || "").split("@")[0] || "未登录";
  if (!/^cn-(?:[a-f0-9]{2})+$/i.test(username)) return username;
  try {
    const bytes = Uint8Array.from(
      username.slice(3).match(/../g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      decoded === decoded.normalize("NFKC").trim().toLowerCase() &&
      /\p{Script=Han}/u.test(decoded) &&
      /^[\p{Script=Han}a-z0-9_-]{1,40}$/u.test(decoded)
    ) return decoded;
  } catch {
    // Invalid internal aliases remain readable without breaking the account menu.
  }
  return username;
}
