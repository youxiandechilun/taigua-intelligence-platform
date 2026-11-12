/*
 * 中文导读：设置中心的页面布局；由 Next.js 按文件路由约定加载。
 */
import type { ReactNode } from "react";
import { requireCompanyAccess } from "@/src/lib/server-session";
import { SettingsLayoutShell } from "@/src/components/settings/SettingsLayoutShell";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const access = await requireCompanyAccess();
  return <SettingsLayoutShell initialAccess={access}>{children}</SettingsLayoutShell>;
}
