/*
 * 中文导读：设置中心 / 工具管理的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/src/lib/server-session";
import { AdvancedTools } from "@/src/components/tools/AdvancedTools";
export default async function Page() {
 const session=await requireSession();
 if(!session.userRole.split(",").includes("admin")) redirect("/tools");
 return <AdvancedTools />;
}
