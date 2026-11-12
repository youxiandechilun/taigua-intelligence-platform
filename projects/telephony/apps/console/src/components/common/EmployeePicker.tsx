/*
 * 中文导读：通用组件的 EmployeePicker 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { Search, UserRound } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/src/components/ui/command";

export function EmployeePicker({ id, value, onChange, employees, currentName, disabled = false }: {
  id: string;
  value: string;
  onChange(value: string): void;
  employees: { id: string; name: string }[];
  currentName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = employees.find(employee => employee.id === value)?.name || currentName;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" variant="outline" className="w-full justify-between gap-3 font-normal" disabled={disabled}>
        <span className={`min-w-0 truncate ${name ? "" : "text-muted-foreground"}`}>{name || "选择客户负责人"}</span>
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-(--radix-popover-trigger-width) overflow-hidden rounded-lg p-0">
      <Command>
        <CommandInput aria-label="搜索员工姓名" placeholder="搜索员工姓名…" />
        <CommandList id={`${id}-list`} aria-label="可选员工" className="max-h-64 overscroll-contain">
          <CommandEmpty className="text-muted-foreground">没有找到匹配的员工</CommandEmpty>
          <CommandGroup>
            {employees.map(employee => <CommandItem key={employee.id} value={employee.id} keywords={[employee.name]} data-checked={value === employee.id} className="cursor-pointer rounded-md py-2.5" onSelect={() => { onChange(employee.id); setOpen(false); }}>
              <UserRound aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{employee.name}</span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
