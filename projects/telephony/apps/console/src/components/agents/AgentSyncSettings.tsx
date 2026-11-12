/*
 * 中文导读：数字员工与话术的 AgentSyncSettings 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {Copy,Search} from 'lucide-react';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '../ui/dialog';
import {toast} from '@/src/lib/toast';
type Candidate={userId:string;name:string;username:string;roleName:string;revision:number;voiceVersion:string;eligible:boolean;reason:string};
type Catalog={sourceSaved:boolean;sourceRevision:number;sourceVoiceVersion:string;baseReleaseId:string;targets:Candidate[]};
type Section='basic'|'conversation';
const sections:{id:Section;title:string;description:string}[]=[{id:'conversation',title:'声音与补充问答',description:'统一参数发布后自动生效，此处仅复制个人声音和补充问答'}];
export function AgentSyncSettings({agentId,agentName}:{agentId:string;agentName:string}){
 const {data:access}=useCompanyContext();const [open,setOpen]=useState(false);
 if(!access?.isSystemAdmin)return null;
 return <><Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" aria-label={`同步设置：${agentName}`} onClick={event=>{event.stopPropagation();setOpen(true);}}><Copy className="size-3.5"/>同步设置</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl">{open&&<SyncForm key={agentId} agentId={agentId} agentName={agentName} close={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}
function SyncForm({agentId,agentName,close}:{agentId:string;agentName:string;close:()=>void}){
 const {org,user}=useAliyunIdentity();const [search,setSearch]=useState(''),[selected,setSelected]=useState<string[]>([]),[scope,setScope]=useState<Section[]>(['conversation']),[confirm,setConfirm]=useState(false);
 const endpoint=`/agents/${agentId}/sync-settings`,headers={'x-workspace-id':org};
 const catalog=useQuery({queryKey:['agent-sync',org,user,agentId],queryFn:()=>unwrap<Catalog>(apiClient.get(endpoint,{headers})),staleTime:0,refetchOnWindowFocus:false,retry:false});
 const submit=useMutation({mutationFn:()=>unwrap<{count:number}>(apiClient.post(endpoint,{sourceRevision:catalog.data!.sourceRevision,sourceVoiceVersion:catalog.data!.sourceVoiceVersion,baseReleaseId:catalog.data!.baseReleaseId,sections:scope,targets:catalog.data!.targets.filter(p=>selected.includes(p.userId)&&p.eligible).map(p=>({userId:p.userId,revision:p.revision,voiceVersion:p.voiceVersion}))},{headers})),onSuccess:data=>{toast.success(`${process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true'?'本地预览：':''}已同步到 ${data.count} 个账号`);close();}});
 const eligible=catalog.data?.targets.filter(p=>p.eligible)||[],visible=catalog.data?.targets.filter(p=>`${p.name} ${p.username} ${p.roleName}`.toLowerCase().includes(search.trim().toLowerCase()))||[];
 const toggle=(id:string)=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
 return <><DialogHeader><DialogTitle>同步数字员工设置</DialogTitle><DialogDescription>{agentName} · 使用你已保存的设置</DialogDescription></DialogHeader>
 {catalog.isPending?<p role="status" className="py-6 text-sm text-muted-foreground">正在读取可同步账号…</p>:catalog.error?<div role="alert" className="text-sm text-destructive">{catalog.error.message}<Button variant="outline" className="ml-3" onClick={()=>void catalog.refetch()}>重试</Button></div>:<>
 {!catalog.data?.sourceSaved&&<p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">请先在我的声音与补充页面保存一次，再同步给其他账号。</p>}
 {confirm?<div className="space-y-3 py-2 text-sm"><p>将覆盖 <strong>{selected.length}</strong> 个账号的<strong>{sections.filter(s=>scope.includes(s.id)).map(s=>s.title).join('、')}</strong>。</p><p className="max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-3 leading-7">{catalog.data?.targets.filter(p=>selected.includes(p.userId)).map(p=>p.name).join('、')}</p><p className="text-xs text-muted-foreground">各账号仅可修改声音和个人补充问答；统一参数只能由超级管理员修改。</p></div>:<>
 <div className="grid gap-2 sm:grid-cols-2">{sections.map(section=><label key={section.id} className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 ${scope.includes(section.id)?'border-primary/40 bg-primary/5':''}`}><input type="checkbox" className="mt-0.5 accent-primary" checked={scope.includes(section.id)} onChange={()=>setScope(old=>old.includes(section.id)?old.filter(s=>s!==section.id):[...old,section.id])}/><span><strong className="text-sm font-medium">{section.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{section.description}</span></span></label>)}</div>
 <div className="flex items-center justify-between text-sm"><span>接收账号 <span className="text-muted-foreground">已选 {selected.length} / {eligible.length}</span></span><Button size="sm" variant="ghost" disabled={!eligible.length} onClick={()=>setSelected(selected.length===eligible.length?[]:eligible.map(p=>p.userId))}>{selected.length===eligible.length&&eligible.length?'取消全选':'全选可用账号'}</Button></div>
 <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" aria-label="搜索接收账号" placeholder="搜索姓名、账号或职位" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <div className="max-h-64 overflow-y-auto rounded-lg border">{visible.map(person=><label key={person.userId} className={`flex items-center gap-3 border-b px-3 py-2.5 last:border-0 ${person.eligible?'cursor-pointer hover:bg-muted/30':'opacity-50'}`}><input type="checkbox" className="accent-primary" disabled={!person.eligible} checked={selected.includes(person.userId)} onChange={()=>toggle(person.userId)}/><span className="min-w-0 flex-1"><span className="text-sm">{person.name}</span><span className="ml-2 text-xs text-muted-foreground">{person.username}</span>{person.reason&&<span className="block text-xs text-muted-foreground">{person.reason}</span>}</span><span className="text-xs text-muted-foreground">{person.roleName}</span></label>)}{!visible.length&&<p className="p-5 text-center text-sm text-muted-foreground">没有符合条件的账号</p>}</div></>}
 </>}
 {submit.error&&<p role="alert" className="text-sm text-destructive">{submit.error.message}</p>}
 <DialogFooter><Button variant="outline" disabled={submit.isPending} onClick={()=>confirm?setConfirm(false):close()}>{confirm?'返回选择':'取消'}</Button>{confirm?<Button disabled={submit.isPending} onClick={()=>submit.mutate()}>{submit.isPending?'同步中…':'确认同步'}</Button>:<Button disabled={!catalog.data?.sourceSaved||!selected.length||!scope.length} onClick={()=>setConfirm(true)}>下一步 · 确认覆盖</Button>}</DialogFooter></>;
}
