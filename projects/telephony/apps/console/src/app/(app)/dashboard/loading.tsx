/*
 * 中文导读：数据看板的加载状态；由 Next.js 按文件路由约定加载。
 */
import { DashboardLoadingSkeleton } from "@/src/components/common/skeletons";

export default function Loading() {
  return <DashboardLoadingSkeleton />;
}
