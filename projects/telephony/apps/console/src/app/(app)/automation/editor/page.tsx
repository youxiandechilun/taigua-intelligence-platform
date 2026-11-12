/*
 * 中文导读：自动化流程 / editor的路由页面；由 Next.js 按文件路由约定加载。
 */
import { redirect } from "next/navigation";

export default function EditorPage() {
  redirect("/automation?view=editor");
}
