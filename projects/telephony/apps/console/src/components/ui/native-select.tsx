/*
 * 中文导读：基础界面组件的 native-select 组件，封装该界面的展示与交互。
 */
import type { ComponentProps } from "react";
import { cn } from "@/src/lib/utils";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn(
    "h-9 min-w-0 cursor-pointer rounded-md border border-input bg-background px-3 text-sm text-foreground transition-[border-color,box-shadow] outline-none hover:border-muted-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 dark:[color-scheme:dark]",
    className,
  )} {...props} />;
}
