/*
 * 中文导读：设置中心 / 员工账号的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/src/lib/server-session";
import { AccountsManager } from "@/src/components/settings/AccountsManager";
export default async function AccountsPage() {
  const session = await requireSession();
  if (!session.userRole.split(",").includes("admin")) redirect("/settings/profile");
  return <AccountsManager />;
}
