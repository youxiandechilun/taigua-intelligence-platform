/*
 * 中文导读：线路与语音外呼的 VoiceSelect 组件，封装该界面的展示与交互。
 */
"use client";

import {useId, useState} from 'react';
import {ChevronDown, Search} from 'lucide-react';
import {Button} from '../ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '../ui/popover';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from '../ui/command';

export type VoiceSelectOption = {
 value: string;
 label: string;
 group?: string;
 keywords?: string[];
 disabled?: boolean;
};

export function VoiceSelect({value, options, onChange, disabled=false, label='通话音色'}:{
 value:string;
 options:VoiceSelectOption[];
 onChange:(value:string)=>void;
 disabled?:boolean;
 label?:string;
}) {
 const [open,setOpen]=useState(false);
 const listId=useId();
 const selected=options.find(option=>option.value===value);
 const groups=[...new Set(options.map(option=>option.group||''))];
 return <Popover open={open&&!disabled} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
   <Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open&&!disabled} aria-controls={open&&!disabled?listId:undefined} disabled={disabled} className="h-9 w-full min-w-0 justify-start gap-2 px-3 font-normal" title={selected?.label}>
    <Search aria-hidden="true" className="size-3.5 text-muted-foreground"/>
    <span className="min-w-0 flex-1 truncate text-left">{selected?.label||'请选择音色'}</span>
    <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground"/>
   </Button>
  </PopoverTrigger>
  <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)] gap-0 rounded-lg p-0">
   <Command>
    <CommandInput aria-label={'搜索'+label} placeholder="搜索音色名称、姓名或模型…"/>
    <CommandList id={listId} aria-label={label+'选项'}>
     <CommandEmpty>没有找到音色，请换个关键词。</CommandEmpty>
     {groups.map(group=><CommandGroup key={group} heading={group||undefined}>
      {options.filter(option=>(option.group||'')===group).map(option=><CommandItem key={option.value} value={option.value||'inherit-voice'} keywords={[option.label,...(option.keywords||[])]} disabled={option.disabled} data-checked={option.value===value} onSelect={()=>{if(!disabled){onChange(option.value);setOpen(false);}}} className="cursor-pointer rounded-md data-[checked=true]:text-primary">
       <span className="min-w-0 flex-1 break-words">{option.label}</span>
      </CommandItem>)}
     </CommandGroup>)}
    </CommandList>
   </Command>
  </PopoverContent>
 </Popover>;
}
