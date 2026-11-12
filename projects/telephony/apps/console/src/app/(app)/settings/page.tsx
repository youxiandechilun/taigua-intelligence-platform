/*
 * 中文导读：设置中心的路由页面；由 Next.js 按文件路由约定加载。
 */
import { SettingsCenter } from "@/src/components/settings/SettingsCenter";
import { requireCompanyAccess } from "@/src/lib/server-session";

export default async function SettingsIndex() {
  const access = await requireCompanyAccess();
  return <SettingsCenter access={access} />;
}
