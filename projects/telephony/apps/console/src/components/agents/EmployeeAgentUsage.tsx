/*
 * 中文导读：数字员工与话术的 EmployeeAgentUsage 组件，封装该界面的展示与交互。
 */
"use client";
import Link from 'next/link';
import dynamic from 'next/dynamic';
const AgentDemoPanel=dynamic(()=>import('./AgentDemoPanel').then(m=>m.AgentDemoPanel),{ssr:false,loading:()=> <p className="p-5 text-sm text-muted-foreground">正在加载演示设置…</p>});
import {useRouter,useSearchParams} from 'next/navigation';
import {useState} from 'react';
import {useAgents} from '@/src/hooks/queries/agents';
import {Button} from '../ui/button';
import {PageHeader} from '../common/PageHeader';
import {PersonalScriptEditor} from './PersonalScriptEditor';
import {Tabs,TabsList,TabsTrigger} from '../ui/tabs';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '../ui/dialog';
export function EmployeeAgentUsage({agentId,canManageScripts=false}:{agentId:string;canManageScripts?:boolean}){
 const {data,isPending,error}=useAgents(),params=useSearchParams(),router=useRouter();
 const agent=data?.find(a=>a.agentId===agentId),tab=params.get('tab')==='demo'?'demo':params.get('tab')==='script'?'script':'basic';
 const [dirty,setDirty]=useState(false),[pending,setPending]=useState<{kind:'tab'|'link';value:string}|null>(null);
 const navigate=(target:{kind:'tab'|'link';value:string})=>{setDirty(false);setPending(null);if(target.kind==='link'){router.push(target.value);return;}const search=new URLSearchParams(params.toString());search.set('scope','personal');search.set('tab',target.value);router.replace(location.pathname+'?'+search.toString());};
 if(isPending)return <p>正在读取数字员工…</p>;
 if(!agent)return <p role="alert">{error?.message||'数字员工不存在或已暂停。'}</p>;
 return <div className="max-w-5xl space-y-4"><PageHeader title={agent.name} actions={<div className="flex gap-2">{canManageScripts&&<Button asChild variant="outline"><Link href={`/agents/${agentId}?tab=script`} onClick={event=>{if(dirty){event.preventDefault();setPending({kind:'link',value:`/agents/${agentId}?tab=script`});}}}>管理话术</Link></Button>}<Button asChild variant="outline"><Link href="/agents" onClick={event=>{if(dirty){event.preventDefault();setPending({kind:'link',value:'/agents'});}}}>返回数字员工</Link></Button></div>}/>
 <Tabs value={tab} onValueChange={next=>dirty?setPending({kind:'tab',value:next}):navigate({kind:'tab',value:next})}><TabsList><TabsTrigger value="basic">选择声音</TabsTrigger><TabsTrigger value="script">查看话术</TabsTrigger><TabsTrigger value="demo">演示模式</TabsTrigger></TabsList></Tabs>
 <div className="rounded-lg border bg-card">{tab==='demo'?<AgentDemoPanel agentId={agentId} defaultOpening="" onDirtyChange={setDirty}/>:<PersonalScriptEditor key={agentId+tab} agentId={agentId} mode={tab==='basic'?'voice':'questions'} onDirtyChange={setDirty}/>}</div>
 <Dialog open={!!pending} onOpenChange={open=>{if(!open)setPending(null);}}><DialogContent><DialogHeader><DialogTitle>有尚未保存的修改</DialogTitle><DialogDescription>保存后再离开，或放弃本次修改。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setPending(null)}>返回编辑</Button><Button onClick={()=>pending&&navigate(pending)}>放弃修改并离开</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
