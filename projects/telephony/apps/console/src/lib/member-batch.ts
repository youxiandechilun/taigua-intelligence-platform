/*
 * 中文导读：共享基础能力：member-batch.ts。相关类型、配置或辅助实现集中在本文件。
 */
export type MemberNameRow = { id: string; name: string; username: string; selected: boolean; warning: string };
export type MemberBatchDraft = {
  id: string; createdAt: string; departmentId: string | null; departmentName: string;
  companyRoleId: string; roleName: string; scopeDepartmentIds: string[];
  rows: { name: string; username: string }[]; removed: boolean;
};
export const normalizeMemberAccount = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export function memberAccountError(value: string) {
  const account = normalizeMemberAccount(value);
  if (!/^[\p{Script=Han}a-z0-9_-]{1,40}$/u.test(account)) return "账号限中文、字母、数字、下划线或短横线，最多40字";
  if (!/\p{Script=Han}/u.test(account) && account.length < 3) return "字母或数字账号至少3位";
  return "";
}
export function memberNames(value: string) {
  return value.split(/[\r\n,，、;；\t]+/).map(name => name.normalize("NFKC").trim()).filter(Boolean);
}
export function proposeMemberRows(names: string[], existing: { name: string; username: string }[], mode: "name" | "number", prefix: string): MemberNameRow[] {
  const used = new Set(existing.map(row => normalizeMemberAccount(row.username)));
  const known = new Set(existing.map(row => row.name.normalize("NFKC").trim()));
  const seen = new Set<string>();
  let number = 1;
  return names.map((name, index) => {
    let base = mode === "name" ? normalizeMemberAccount(name).replace(/\s+/g, "") : "";
    if (!base || memberAccountError(base)) base = "";
    let username = base;
    if (!base) {
      do { username = `${prefix}${String(number++).padStart(3, "0")}`; } while (used.has(username));
    } else {
      for (let suffix = 2; used.has(username); suffix++) username = `${base.slice(0, 35)}_${suffix}`;
    }
    used.add(username);
    const warning = name.length > 80 ? "姓名最多80字" : known.has(name) ? "已有同名员工，请核对" : seen.has(name) ? "名单中姓名重复，请核对" : "";
    seen.add(name);
    return { id: String(index), name, username, selected: !warning, warning };
  });
}
