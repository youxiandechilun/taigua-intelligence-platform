/*
 * 中文导读：数字员工与话术的 CharacterLibraryPicker 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { characterLibrary } from "@/src/lib/agents/character-library";
import { Button } from "@/src/components/ui/button";

const PAGE_SIZE = 32;

export function CharacterLibraryPicker({ value, onChange, disabled = false }: {
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(() => Math.floor(Math.max(0,
    characterLibrary.findIndex(item => item.value === value)) / PAGE_SIZE));
  const pages = Math.ceil(characterLibrary.length / PAGE_SIZE);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{characterLibrary.length} 个系统人物形象</p>
      <div className="grid max-h-[45dvh] grid-cols-4 gap-2 overflow-y-auto p-1 sm:grid-cols-8" aria-label="系统人物形象库">
        {characterLibrary.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => (
          <button
            key={item.value}
            type="button"
            aria-label={`选择${item.label}`}
            aria-pressed={value === item.value}
            disabled={disabled}
            className={`flex flex-col items-center gap-1 rounded-lg border bg-white px-1 py-2 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${value === item.value ? "border-primary ring-1 ring-primary" : "hover:border-primary/60"}`}
            onClick={() => onChange(item.value)}
          >
            <img src={item.src} alt={item.label} width={256} height={256} loading="lazy" decoding="async" className="h-[70px] w-full object-contain" />
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
        <Button type="button" size="sm" variant="outline" disabled={disabled || page === 0} onClick={() => setPage(p => p-1)}>上一页</Button>
        <span>{page + 1} / {pages}</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled || page === pages-1} onClick={() => setPage(p => p+1)}>下一页</Button>
      </div>
    </div>
  );
}
