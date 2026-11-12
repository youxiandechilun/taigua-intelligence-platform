/*
 * 中文导读：基础界面组件的 skeleton 组件，封装该界面的展示与交互。
 */
import { cn } from "@/src/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
 return (
 <div
 data-slot="skeleton"
 aria-hidden="true"
 className={cn("bg-muted motion-safe:animate-pulse", className)}
 {...props}
 />
 )
}

export { Skeleton }
