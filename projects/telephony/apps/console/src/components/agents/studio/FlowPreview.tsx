/*
 * 中文导读：数字员工与话术的 FlowPreview 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import {ArrowLeft,RotateCcw} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/src/components/ui/dialog';
import type {FlowGraph} from '@/src/lib/api/resources/playbook';
import {flowBranches,nodeTitles,previewBranch} from './flow-model';

const outcomes={neutral:'未判定',interested:'有意向',declined:'拒绝沟通',follow_up:'需要跟进'};
type Visit={id:string;branch:string;collected:Record<string,string>;via:string[]};
export function FlowPreview({graph,onClose}:{graph:FlowGraph;onClose:()=>void}){
 const [visits,setVisits]=useState<Visit[]>([{id:graph.entry,branch:'开场',collected:{},via:[]}]);
 const [value,setValue]=useState(''),[error,setError]=useState('');
 const visit=visits[visits.length-1]!,node=graph.nodes.find(n=>n.id===visit.id);
 const ending=node&&['end','handoff'].includes(node.kind);
 function advance(branch:string){
  if(!node)return;
  if(visits.length>=120){setError('已达到 120 步，请检查是否反复回到同一节点。');return;}
  const next=previewBranch(graph,node.id,branch);
  if(next.error){setError(next.error);return;}
  setVisits(v=>[...v,{id:next.nodeId,branch,via:next.via,collected:node.kind==='collect'&&value.trim()&&node.field?{...visit.collected,[node.field]:value.trim()}:visit.collected}]);
  setValue('');setError('');
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
  <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14"><DialogTitle>流程预览</DialogTitle><DialogDescription className="text-xs">使用当前草稿检查分支路径，不拨电话。</DialogDescription></DialogHeader>
  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
   <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground" aria-label="预览路径">{visits.map((v,i)=><span key={i} className="rounded border px-2 py-1">{i+1}. {graph.nodes.find(n=>n.id===v.id)?.title||'节点不存在'}{i>0&&`（${v.branch}）`}</span>)}</div>
   {node?<section className="space-y-4 rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">{node.title}</h3><span className="shrink-0 text-xs text-primary">{nodeTitles[node.kind]}</span></div>
    
    <p className="whitespace-pre-wrap text-sm leading-6">{node.text||'未填写话术'}</p>
    {visit.via.length>0&&<p className="text-xs text-muted-foreground">经过跳转：{visit.via.join(' → ')}</p>}
    {node.kind==='collect'&&<label className="grid gap-2 text-xs">模拟采集：{node.field||'字段未填写'}<Input value={value} maxLength={1000} onChange={e=>setValue(e.target.value)} placeholder="输入客户明确提供的信息"/></label>}
    {ending?<div role="status" className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">流程结束 · {outcomes[node.outcome]}{node.kind==='handoff'&&<p className="mt-1 text-xs text-muted-foreground">将登记人工跟进意向。</p>}</div>:<div className="space-y-2"><p className="text-xs font-medium">{node.kind==='ivr'?'模拟客户按键':'选择客户回应分支'}</p><div className="flex flex-wrap gap-2">{flowBranches(node,graph).map(branch=>{const edge=graph.edges.find(e=>e.source===node.id&&e.branch===branch);return <Button key={branch} size="sm" variant="outline" title={edge?.condition||undefined} onClick={()=>advance(branch)}>{branch}{!edge&&<span className="text-xs text-muted-foreground">未连接</span>}</Button>;})}</div>{graph.edges.filter(e=>e.source===node.id&&e.condition).map(e=><p key={e.id} className="text-xs leading-5 text-muted-foreground">{e.branch}：{e.condition}</p>)}</div>}
   </section>:<p role="alert" className="text-sm text-destructive">开场节点不存在，请先完成流程检查。</p>}
   {Object.keys(visit.collected).length>0&&<section className="rounded border p-3"><h3 className="mb-2 text-xs font-medium">模拟采集结果</h3><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">{Object.entries(visit.collected).map(([key,text])=><div className="contents" key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-words">{text}</dd></div>)}</dl></section>}
   {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
  <div className="flex shrink-0 justify-between gap-2 border-t px-6 py-4"><Button size="sm" variant="outline" disabled={visits.length<=1} onClick={()=>{setVisits(v=>v.slice(0,-1));setError('');setValue('');}}><ArrowLeft className="size-3.5"/>上一步</Button><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={()=>{setVisits([{id:graph.entry,branch:'开场',collected:{},via:[]}]);setValue('');setError('');}}><RotateCcw className="size-3.5"/>重新开始</Button><Button size="sm" onClick={onClose}>返回画布</Button></div></div>
 </DialogContent></Dialog>;
}
