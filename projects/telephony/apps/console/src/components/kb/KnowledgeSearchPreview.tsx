/*
 * 中文导读：知识库的 KnowledgeSearchPreview 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Search,BookOpen,Loader2,ArrowUpRight} from 'lucide-react';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import type {KnowledgeItem} from './knowledge-types';
type Result={items:(KnowledgeItem&{match?:string;similarity?:number})[];method:string;semanticState:string;traceId:string|null};
export function KnowledgeSearchPreview({open,org,user,agentId,agents,onClose,onOpen}:{open:boolean;org:string;user:string;agentId?:string;agents:{agentId:string;name:string}[];onClose:()=>void;onOpen:(item:KnowledgeItem)=>void}){
 const [text,setText]=useState(''),[scope,setScope]=useState(agentId||''),[request,setRequest]=useState<{question:string;agentId:string;nonce:number}|null>(null);
 const results=useQuery({queryKey:['knowledge-preview',user,org,request],enabled:open&&!!org&&!!request,retry:false,queryFn:()=>unwrap<Result>(apiClient.get('/workspace-knowledge/retrieve',{headers:{'x-workspace-id':org},params:{question:request!.question,agentId:request!.agentId||undefined},timeout:12000}))});
 return <Dialog open={open} onOpenChange={v=>{if(!v)onClose();}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>检索预览</DialogTitle><DialogDescription>与通话共用检索，只显示已发布且有效的知识。</DialogDescription></DialogHeader>
  {!agentId&&<label className="grid gap-2 text-sm">适用数字员工<NativeSelect aria-label="预览数字员工" className="h-9 rounded-md border bg-background px-3 text-sm" value={scope} onChange={e=>setScope(e.target.value)}><option value="">企业共享知识</option>{agents.map(a=><option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect></label>}
  <form className="flex gap-2" onSubmit={e=>{e.preventDefault();setRequest({question:text.trim(),agentId:scope,nonce:Date.now()});}}><Input autoFocus aria-label="检索关键词" placeholder="输入客户可能提出的问题" minLength={2} maxLength={1200} value={text} onChange={e=>setText(e.target.value)}/><Button disabled={text.trim().length<2||results.isFetching}>{results.isFetching?<Loader2 className="size-4 animate-spin"/>:<Search className="size-4"/>}检索</Button></form>
  {!request?<div className="flex min-h-52 flex-col items-center justify-center gap-3 text-muted-foreground"><BookOpen className="size-10" strokeWidth={1.2}/><p className="text-sm">输入问题，查看可引用的知识和来源</p></div>:results.isPending?<p role="status" className="py-12 text-center text-sm text-muted-foreground">正在检索已发布知识…</p>:results.error?<p role="alert" className="py-6 text-sm text-destructive">{results.error.message}</p>:<div className="space-y-3">
   <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{{hybrid:'关键词 + 语义检索',semantic:'语义检索',keyword:'关键词检索'}[results.data?.method||'']||'知识检索'} · {results.data?.items.length||0} 项依据</span>{results.data?.semanticState==='INDEXING'&&<span className="text-amber-700">语义索引正在准备</span>}{['UNAVAILABLE','BUSY'].includes(results.data?.semanticState||'')&&<span className="text-amber-700">语义服务暂不可用，已采用关键词检索</span>}</div>
   {!results.data?.items.length&&<div className="rounded-lg border p-5 text-sm"><p className="font-medium">未找到可引用的已发布知识</p><p className="mt-2 leading-6 text-muted-foreground">请核对数字员工范围，或先整理资料并审核发布。实际通话会提示需要核实，不编造答案。</p></div>}
   {results.data?.items.map((item,i)=><article className="rounded-lg border p-4" key={item.id}><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded bg-primary/5 text-xs text-primary">{i+1}</span>{item.title}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{item.content}</p>{item.sourceQuote&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">原文依据</summary><blockquote className="mt-2 border-l-2 pl-3 leading-6">{item.sourceQuote}</blockquote></details>}<footer className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground"><span>{item.sourceTitle||'管理员维护'} · 版本 {item.revision}</span><Button size="sm" variant="ghost" onClick={()=>{onClose();onOpen({...item,kind:'note'});}}>查看知识<ArrowUpRight className="size-3.5"/></Button></footer></article>)}
  </div>}
 </DialogContent></Dialog>;
}
