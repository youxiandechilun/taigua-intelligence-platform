/*
 * 中文导读：设置中心 / platform的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/src/lib/server-session";

export default async function PlatformSettingsPage() {
  const session = await requireSession();
  if (!session.userRole.split(",").includes("admin")) redirect("/settings/profile");
  redirect("/settings/organization?section=login");
}
