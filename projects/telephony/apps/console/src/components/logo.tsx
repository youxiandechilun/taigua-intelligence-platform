/*
 * 中文导读：共享基础能力的 logo 组件，封装该界面的展示与交互。
 */
import Image from "next/image";

export default function Logo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Image src="/brand/taigua-logo.png" alt="泰卦传媒" width={1848} height={266} className="h-auto w-64 max-w-full" />
    </div>
  );
}
