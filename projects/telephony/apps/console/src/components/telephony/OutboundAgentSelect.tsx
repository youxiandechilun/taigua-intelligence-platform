/*
 * 中文导读：线路与语音外呼的 OutboundAgentSelect 组件，封装该界面的展示与交互。
 */
'use client';

import type {Agent} from '@/src/lib/api/types';
import {AgentAvatar} from '@/src/components/agents/AgentIdentity';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/src/components/ui/select';

function EmployeeLabel({agent}:{agent:Agent}) {
  return <span className="flex min-w-0 items-center gap-3 text-left">
    <AgentAvatar agent={agent}/>
    <span className="min-w-0 flex-1 space-y-1">
      <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
      <span className="line-clamp-2 whitespace-normal text-xs font-normal leading-5 text-muted-foreground">{agent.studioSummary?.description?.trim()||'暂未填写员工描述'}</span>
    </span>
  </span>;
}

export function OutboundAgentSelect({agents,value,onChange,disabled,loading}:{agents:Agent[];value:string;onChange:(value:string)=>void;disabled:boolean;loading:boolean}) {
  const selected=agents.find(agent=>agent.agentId===value);
  return <div className="grid gap-2 text-sm">
    <label htmlFor="quick-outbound-agent">数字员工</label>
    <Select value={selected?.agentId||''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id="quick-outbound-agent" aria-label="数字员工" className="w-full min-h-16 whitespace-normal py-3 data-[size=default]:h-auto [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1">
        <SelectValue placeholder={loading?'正在读取数字员工…':'请选择数字员工'}>{selected?<EmployeeLabel agent={selected}/>:undefined}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80 w-[var(--radix-select-trigger-width)]">
        {agents.map(agent=><SelectItem key={agent.agentId} value={agent.agentId} textValue={agent.name} className="py-3 [&_[data-slot=select-item-text]]:min-w-0"><EmployeeLabel agent={agent}/></SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}
