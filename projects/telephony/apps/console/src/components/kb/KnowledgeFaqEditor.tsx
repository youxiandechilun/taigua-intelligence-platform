/*
 * 中文导读：知识库的 KnowledgeFaqEditor 组件，封装该界面的展示与交互。
 */
"use client";

import {useState,type ReactNode} from 'react';
import {Save} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Textarea} from '@/src/components/ui/textarea';
import {NativeSelect} from '@/src/components/ui/native-select';
import {readFaq,writeFaq} from './knowledge-faq';
import type {KnowledgeItem,KnowledgeCategory} from './knowledge-types';

type Props={item:KnowledgeItem;categories:KnowledgeCategory[];agents:{agentId:string;name:string}[];canEdit:boolean;busy:boolean;onSave:(item:KnowledgeItem)=>void;onDirty:(dirty:boolean)=>void;onCancel:()=>void;children?:ReactNode};
const toLocal=(v?:string|null)=>v?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)).replace(' ','T'):'';
const selectClass='h-9 w-full rounded-md border bg-background px-3 text-sm';

export function KnowledgeFaqEditor({item,categories,agents,canEdit,busy,onSave,onDirty,onCancel,children}:Props) {
 const initial=readFaq(item.content);
 const [value,setValue]=useState(item),[answer,setAnswer]=useState(initial.answer);
 const [similar,setSimilar]=useState(initial.similarQuestions.join('\n')),[boundary,setBoundary]=useState(initial.boundary);
 const [tags,setTags]=useState(item.tags.join('，')),[error,setError]=useState('');
 const changed=()=>{setError('');onDirty(true);};
 function submit() {
  const questions=similar.split('\n').map(v=>v.trim()).filter(Boolean);
  const keywords=[...new Set(tags.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean))];
  const content=writeFaq({answer,similarQuestions:questions,boundary});
  if(questions.length>20 || questions.some(q=>q.length>200)){setError('最多填写 20 条相似问法，每条不超过 200 字。');return;}
  if(keywords.length>12 || keywords.some(k=>k.length>30)){setError('关键词最多 12 个，每个不超过 30 字。');return;}
  if(content.length>30000){setError('答案和补充内容合计不能超过 30000 字，请精简后保存。');return;}
  onSave({...value,title:value.title.trim(),content,tags:keywords});
 }
 return <form className="space-y-5" onSubmit={e=>{e.preventDefault();submit();}}>
  <fieldset disabled={!canEdit||busy} className="space-y-5">
   <label className="grid gap-2 text-sm font-medium">标准问题<Input required maxLength={100} value={value.title} placeholder="客户通常会问什么？" onChange={e=>{setValue({...value,title:e.target.value});changed();}}/></label>
   <label className="grid gap-2 text-sm font-medium">相似问法<Textarea rows={3} value={similar} placeholder={'每行一个，例如：\n这个需要收费吗？\n参加活动要交钱吗？'} onChange={e=>{setSimilar(e.target.value);changed();}}/><span className="text-xs font-normal text-muted-foreground">补充同一个问题的不同说法，最多 20 条。</span></label>
   <label className="grid gap-2 text-sm font-medium">标准答案<Textarea required rows={6} maxLength={30000} value={answer} placeholder="填写已经确认的业务答案" onChange={e=>{setAnswer(e.target.value);changed();}}/></label>
   <div className="grid gap-4 sm:grid-cols-2">
    <label className="grid gap-2 text-sm">分类<NativeSelect className={selectClass} value={value.categoryId||''} onChange={e=>{setValue({...value,categoryId:e.target.value||null});changed();}}><option value="">未分类</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></label>
    <label className="grid gap-2 text-sm">适用数字员工<NativeSelect className={selectClass} value={value.agentId||''} onChange={e=>{setValue({...value,agentId:e.target.value||null});changed();}}><option value="">企业共享 · 全部数字员工</option>{value.agentId&&!agents.some(a=>a.agentId===value.agentId)&&<option value={value.agentId}>当前关联的数字员工</option>}{agents.map(a=><option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect></label>
   </div>
   <label className="flex items-center gap-2 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={value.enabled} onChange={e=>{setValue({...value,enabled:e.target.checked});changed();}}/>启用这条问答</label>
   <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">回答边界与更多设置</summary><div className="mt-4 grid gap-4">
    <label className="grid gap-2">回答边界<Textarea rows={3} maxLength={4000} value={boundary} placeholder="例如：仅适用于本次活动；未经确认不能承诺其他服务免费。" onChange={e=>{setBoundary(e.target.value);changed();}}/></label>
    <label className="grid gap-2">关键词<Input value={tags} onChange={e=>{setTags(e.target.value);changed();}} placeholder="用逗号分隔，最多 12 个"/></label>
    <label className="grid gap-2">有效期至（北京时间，留空为长期）<Input type="datetime-local" value={toLocal(value.validUntil)} onChange={e=>{setValue({...value,validUntil:e.target.value?new Date(e.target.value+':00+08:00').toISOString():null});changed();}}/></label>
   </div></details>
  </fieldset>
  {item.sourceQuote&&<details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">原文来源：{item.sourceTitle}</summary><blockquote className="mt-3 whitespace-pre-wrap border-l-2 pl-3 leading-6 text-muted-foreground">{item.sourceQuote}</blockquote></details>}
  {children}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background pt-4 pb-1"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{canEdit?'取消':'关闭'}</Button>{canEdit&&<Button disabled={busy||!value.title.trim()||!answer.trim()}><Save className="size-4"/>{busy?'保存中…':'保存问答'}</Button>}</div>
 </form>;
}
