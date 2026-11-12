/*
 * 中文导读：设置中心 / seats的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
export default async function Page() {
  redirect("/settings/members");
}
