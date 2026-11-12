/*
 * 中文导读：知识库的加载状态；由 Next.js 按文件路由约定加载。
 */
import { PageSkeleton } from "@/src/components/common/skeletons";

export default function Loading() {
  return <PageSkeleton />;
}
