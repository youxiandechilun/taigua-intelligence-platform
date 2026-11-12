/*
 * 中文导读：数字员工与话术的 RecordingReview 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {useRouter} from 'next/navigation';
import {BookOpenCheck,Loader2,Volume2} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {toast} from '@/src/lib/toast';
import {learningApi,type LearningRecording,type LearningEvidence,type LearningSuggestion} from '@/src/lib/api/resources/learning';

function Evidence({value,data,onListen}:{value?:LearningEvidence;data:LearningSuggestion;onListen:(seconds:number)=>void}){
 if(!value)return null;
 const source=data.sourceSegments?.find(s=>s.id===value.sourceId);
 return <details className="mt-3 rounded-md bg-muted/25 p-2.5"><summary className="cursor-pointer text-xs text-muted-foreground">原文依据</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{value.quote}</p>{source&&<Button type="button" size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={()=>onListen(source.startSeconds)}><Volume2 className="size-3"/>回听原片段 · {Math.floor(source.startSeconds/60)}:{String(Math.floor(source.startSeconds%60)).padStart(2,'0')}</Button>}</details>;
}
export function RecordingReview({recording,agentId,org,canEdit,onRefresh,onListen}:{recording:LearningRecording;agentId:string;org:string;canEdit:boolean;onRefresh:()=>void;onListen:(seconds:number)=>void}){
 const router=useRouter(),data=recording.analysis!;
 const [view,setView]=useState<'knowledge'|'dialogue'|'removed'>('knowledge');
 const doc=recording.knowledgeDocument;
 const open=(id:string,trash=false)=>router.push('/kb?documentId='+encodeURIComponent(id)+(trash?'&trash=true':''));
 const prepare=useMutation({mutationFn:()=>learningApi.knowledge(agentId,org,recording.id),onSuccess:r=>{onRefresh();open(r.id,!!r.deletedAt);},onError:(e:Error)=>toast.error(e.message)});
 const status=doc?.deletedAt?'资料在回收站':doc?.status==='COMPLETED'?'知识已审核':doc?'知识待审核':'等待整理入库';
 return <div className="space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{status}</h3><p className="mt-1 text-xs text-muted-foreground">公司知识库 · 审核通过后共享使用</p></div>{canEdit&&<Button type="button" size="sm" disabled={prepare.isPending} onClick={()=>doc?open(doc.id,!!doc.deletedAt):prepare.mutate()}>{prepare.isPending?<Loader2 className="size-3.5 animate-spin"/>:<BookOpenCheck className="size-3.5"/>}{doc?.deletedAt?'查看回收站':doc?.status==='COMPLETED'?'查看入库结果':doc?'审核知识':'整理到知识库'}</Button>}</header>
  <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/30 p-1" role="group" aria-label="录音整理内容">{([['knowledge','知识提取'],['dialogue','有效对话'],['removed','已过滤内容']] as const).map(([id,title])=><Button key={id} size="sm" variant="ghost" aria-pressed={view===id} className={view===id?'bg-background text-primary shadow-sm':''} onClick={()=>setView(id)}>{title}{id==='removed'&&data.removed?.length?' · '+data.removed.length:''}</Button>)}</div>
  {view==='knowledge'&&<div className="space-y-5">
   <section className="rounded-lg bg-muted/20 p-4"><h4 className="mb-2 text-sm font-semibold">通话摘要</h4><p className="whitespace-pre-wrap text-sm leading-6">{data.summary}</p></section>
   {!!data.keywords?.length&&<div className="flex flex-wrap gap-2">{data.keywords.map((item,i)=><span key={i} title={item.evidence.quote} className="rounded-md border bg-primary/5 px-2 py-1 text-xs text-primary">{item.word}</span>)}</div>}
   {data.faqs.map((item,i)=><article key={'faq'+i} className="rounded-lg border p-4"><h4 className="text-sm font-semibold">{item.question}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.answer}</p><Evidence value={item.evidence} data={data} onListen={onListen}/></article>)}
   {data.objections.map((item,i)=><article key={'objection'+i} className="rounded-lg border p-4"><h4 className="text-sm font-semibold">{item.trigger}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.response}</p><Evidence value={item.evidence} data={data} onListen={onListen}/></article>)}
   {!data.faqs.length&&!data.objections.length&&<p className="rounded-lg border p-4 text-sm text-muted-foreground">本次没有提取到可靠业务知识。</p>}
   {!!data.unverifiedClaims.length&&<details className="rounded-lg border border-amber-200 p-4"><summary className="cursor-pointer text-sm font-medium text-amber-800">待核实说法 · {data.unverifiedClaims.length}</summary><ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-6">{data.unverifiedClaims.map((text,i)=><li key={i}>{text}</li>)}</ul></details>}
   <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">沟通复盘</summary>{([['有效做法',data.strengths],['建议改进',data.improvements]] as const).map(([title,items])=>!!items.length&&<section key={title} className="mt-4"><h4 className="text-sm font-semibold">{title}</h4><ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{items.map((text,i)=><li key={i}>{text}</li>)}</ul></section>)}{data.openingSuggestion&&<p className="mt-4 text-sm leading-6">开场建议：{data.openingSuggestion}</p>}</details>
  </div>}
  {view==='dialogue'&&<div className="space-y-3">{data.dialogue?.length?data.dialogue.map((item,i)=><article key={i} className={`rounded-lg border p-3 ${item.speaker==='员工'?'bg-primary/[0.025]':''}`}><span className="text-xs font-medium text-muted-foreground">{item.speaker}</span><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.text}</p><Evidence value={item.evidence} data={data} onListen={onListen}/></article>):<p className="text-sm text-muted-foreground">暂无分段整理结果</p>}</div>}
  {view==='removed'&&<div className="space-y-3">{data.removed?.length?data.removed.map((item,i)=><article key={i} className="rounded-lg border p-3"><span className="text-xs font-medium text-muted-foreground">{item.reason}</span><Evidence value={item.evidence} data={data} onListen={onListen}/></article>):<p className="text-sm text-muted-foreground">未发现需要过滤的内容</p>}</div>}
 </div>;
}
