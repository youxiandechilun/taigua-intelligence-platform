/*
 * 中文导读：共享基础能力的 theme-mode-select 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

const modes = [
  { value: "light", label: "亮色", Icon: Sun },
  { value: "dark", label: "暗色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
] as const;

export function ThemeModeSelect() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const selected = modes.find(mode => mode.value === (mounted ? theme : "light")) ?? modes[0];
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="sm" aria-label="切换主题" className="gap-2 bg-background/80 text-muted-foreground hover:text-foreground">
        <selected.Icon aria-hidden="true" className="size-4" />
        <span>主题<span className="hidden sm:inline">：{selected.label}</span></span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-36">
      <DropdownMenuRadioGroup value={selected.value} onValueChange={setTheme}>
        {modes.map(mode => <DropdownMenuRadioItem key={mode.value} value={mode.value} className="gap-2">
          <mode.Icon aria-hidden="true" className="size-4 text-muted-foreground" />{mode.label}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
