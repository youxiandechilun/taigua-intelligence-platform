/*
 * 中文导读：应用根级的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { getSession } from "@/src/lib/server-session";

export default async function Home() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  if (!session.session?.activeOrganizationId) {
    redirect("/orgs");
  }
  redirect("/dashboard");
}
