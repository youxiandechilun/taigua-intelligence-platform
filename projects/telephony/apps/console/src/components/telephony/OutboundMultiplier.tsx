/*
 * 中文导读：线路与语音外呼的 OutboundMultiplier 组件，封装该界面的展示与交互。
 */
'use client';
import { useId } from 'react';
import { UsersRound } from 'lucide-react';
import { Button } from '../ui/button';

const multipliers=[1,2,3,4,5,6];

export function OutboundMultiplier({value,onChange,disabled=false,max=6,ready=true}:{value:number;onChange:(value:number)=>void;disabled?:boolean;max?:number;ready?:boolean}) {
  const helpId=useId();
  const choices=multipliers.filter(number=>number<=max);
  const valid=choices.includes(value);
  return <fieldset disabled={disabled||!ready} className="min-w-0 space-y-2.5" aria-describedby={helpId}>
    <legend className="mb-2 flex items-center gap-2 text-sm font-medium"><UsersRound aria-hidden="true" className="size-4 text-muted-foreground"/>外呼倍数</legend>
    <div className="flex flex-wrap items-center gap-2">
      {choices.map(number=><Button key={number} type="button" size="sm" variant={value===number?'default':'outline'} aria-pressed={value===number} onClick={()=>onChange(number)}>{number}倍</Button>)}
    </div>
    <p id={helpId} role="status" className={valid?'text-xs leading-5 text-muted-foreground':'text-xs text-destructive'}>{!ready?'外呼倍数设置暂未读取，请稍后重试。':valid?`目标同时拨打${value}个不同号码；当前工作区最高 ${max} 倍。`:`请选择 ${choices.join('、')} 倍。`}</p>
  </fieldset>;
}
