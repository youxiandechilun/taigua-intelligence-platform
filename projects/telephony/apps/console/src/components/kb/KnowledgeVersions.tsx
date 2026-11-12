/*
 * 中文导读：知识库的 KnowledgeVersions 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {History,RotateCcw} from 'lucide-react';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {Button} from '@/src/components/ui/button';
import {toast} from '@/src/lib/toast';
import {knowledgeDate,type KnowledgeItem} from './knowledge-types';
type Version={revision:number;createdAt:string;snapshot:KnowledgeItem};
export function KnowledgeVersions({org,user,item,disabled,onRestored}:{org:string;user:string;item:KnowledgeItem;disabled:boolean;onRestored:()=>Promise<void>}){
 const qc=useQueryClient(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),headers={'x-workspace-id':org};
 const q=useQuery({queryKey:['knowledge-versions',user,org,item.id,item.revision],queryFn:()=>unwrap<Version[]>(apiClient.get('/workspace-knowledge/versions/'+item.id,{headers})),enabled:open,retry:false});
 async function restore(v:Version){if(disabled||busy)return;setBusy(true);try{await unwrap(apiClient.post('/workspace-knowledge/versions/'+item.id+'/restore',{revision:v.revision,expectedRevision:item.revision},{headers}));toast.success('已恢复版本，原内容保留在历史记录中');await qc.invalidateQueries({queryKey:['knowledge-versions']});await onRestored();}catch(e){toast.error(e instanceof Error?e.message:'恢复未完成。');}finally{setBusy(false);}}
 return <details className="rounded-lg border p-3 text-sm" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary className="flex cursor-pointer items-center gap-2 font-medium"><History className="size-4"/>版本记录</summary>{open&&<div className="mt-3 space-y-3">{q.isPending?<p>正在读取版本…</p>:q.error?<p role="alert" className="text-destructive">{q.error.message}</p>:q.data?.map(v=><article className="rounded-md bg-muted/30 p-3" key={v.revision}><div className="flex items-center justify-between gap-3"><strong>版本 {v.revision}{v.revision===item.revision?' · 当前版本':''}</strong><time className="text-xs text-muted-foreground">{knowledgeDate(v.createdAt)}</time></div><h4 className="mt-2 font-medium">{v.snapshot.title}</h4><p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap leading-6 text-muted-foreground">{v.snapshot.content}</p>{v.revision!==item.revision&&<Button type="button" size="sm" variant="outline" className="mt-3" disabled={disabled||busy} onClick={()=>void restore(v)}><RotateCcw className="size-3.5"/>恢复为此版本</Button>}</article>)}</div>}</details>;
}
