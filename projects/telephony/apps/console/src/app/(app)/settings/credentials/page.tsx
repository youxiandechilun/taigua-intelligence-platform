/*
 * 中文导读：设置中心 / credentials的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { requireCompanyAccess } from "@/src/lib/server-session";
import { IntegrationCredentials } from "@/src/components/settings/IntegrationCredentials";
export default async function Page() {
  const access = await requireCompanyAccess();
  if (!access.isSystemAdmin) redirect("/settings/profile");
  return <IntegrationCredentials key={access.organizationId} />;
}
