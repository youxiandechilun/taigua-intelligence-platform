/*
 * 中文导读：应用外壳与导航的 IdentityWatermark 组件，封装该界面的展示与交互。
 */
"use client";

import { authClient } from "@/src/lib/auth-client";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import styles from "./identity-watermark.module.css";

const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function IdentityWatermark() {
  const { data: session } = authClient.useSession();
  const company = useCompanyContext();
  const context = company.data;
  if (!session?.user || !context || context.organizationId !== session.session.activeOrganizationId) return null;
  const member = context.currentMember;
  const self = context.assignees.find(person => person.id === session.user.id);
  const name = member?.name || session.user.name;
  if (!name) return null;
  const department = member?.department?.name || self?.department?.name || (context.departmentId ? "部门待同步" : "公司直属");
  const position = member?.position || context.roleName;
  const heading = `${department} · ${position}`;
  const width = Math.max(350, Math.min(640, Math.max(heading.length, name.length) * 13 + 130));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="230"><g transform="translate(${width / 2} 115) rotate(-24)" fill="#64748b" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="13" font-weight="400" text-anchor="middle" letter-spacing="1.2"><text y="-7">${escapeXml(heading)}</text><text y="17">${escapeXml(name)}</text></g></svg>`;
  return <div aria-hidden="true" className={styles.watermark} data-identity-watermark style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundSize: `${width}px 230px` }} />;
}
