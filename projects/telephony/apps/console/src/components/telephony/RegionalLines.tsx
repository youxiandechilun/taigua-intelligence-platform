/*
 * 中文导读：按地区展示和配置可用线路。
 */
"use client";
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus,MapPin} from 'lucide-react';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type RegionalLine,type Line,useTelephony} from '@/src/lib/api/resources/telephony';
import {LineForm} from './LineForm';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';

function RouteForm({route,provinces,base,onDone}:{route:RegionalLine|null;provinces:string[];base:Line;onDone:()=>void}){
 const {org}=useAliyunIdentity();
 const [baseRoute]=useState(route);
 const [selected,setSelected]=useState(route?.provinces||[]),[note,setNote]=useState(route?.note||''),[enabled,setEnabled]=useState(route?.enabled??true);
 return <LineForm config={route?.line||{...base,name:'',trunkKey:'regional-'+crypto.randomUUID().slice(0,8),serverIp:'',callerNumber:'',liveEnabled:false,whitelistConfirmed:false}} onSave={async line=>{
  await telephonyApi.saveLine(org,route?.id||null,{line,provinces:selected,note,enabled,assignedUserIds:baseRoute?.assignedUserIds||[],expectedRevision:baseRoute?.revision});onDone();
 }}><section className="space-y-4 rounded-xl border bg-card p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">适用省份 <span className="text-primary">*</span></h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用省份匹配</label></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{provinces.map(p=><label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(p)} onChange={e=>setSelected(v=>e.target.checked?[...v,p]:v.filter(x=>x!==p))}/>{p}</label>)}</div><label className="grid gap-2 text-sm">备注<Input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：华东客户专用线路"/></label></section></LineForm>;
}
function Assignment({route,onDone}:{route:RegionalLine;onDone:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const context=useCompanyContext();
 const seats={data:context.data?.assignees?.map(m=>({...m,userId:m.id})),error:context.error,isPending:context.isPending,isError:context.isError};
 const [ids,setIds]=useState(route.assignedUserIds||[]);
 const [assignmentRevision]=useState(route.assignmentRevision);
 const save=useMutation({mutationFn:()=>telephonyApi.assignLine(org,route.id,ids,assignmentRevision),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('线路分配已保存');onDone();},onError:(e:Error)=>toast.error(e.message)});
 return <div className="space-y-4">{seats.error?<p className="text-sm text-destructive">{seats.error.message}</p>:<div className="grid gap-3 sm:grid-cols-2">{seats.data?.map(s=><label key={s.userId} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={ids.includes(s.userId)} onChange={e=>setIds(v=>e.target.checked?[...v,s.userId]:v.filter(id=>id!==s.userId))}/>{s.name}</label>)}</div>}<Button disabled={save.isPending||seats.isPending||seats.isError} onClick={()=>save.mutate()}>保存分配</Button></div>;
}
export function RegionalLines(){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient(),base=useTelephony();
 const q=useQuery({queryKey:['telephony',user,org,'lines'],queryFn:()=>telephonyApi.lines(org),enabled:!!org,retry:false});
 const [editing,setEditing]=useState<RegionalLine|null|undefined>(),[assigning,setAssigning]=useState<RegionalLine|null>(null);
 const remove=useMutation({mutationFn:(id:string)=>telephonyApi.removeLine(org,id),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('线路已移除，原通话记录保留');},onError:(e:Error)=>toast.error(e.message)});
 if(q.isPending)return <p className="text-sm text-muted-foreground">正在读取省份线路…</p>;
 if(q.error)return <p role="alert" className="text-sm text-destructive">{q.error.message}</p>;
 return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">省份线路</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">未匹配到省份时使用默认线路。</p></div>{q.data?.canConfigure&&<Button size="sm" onClick={()=>setEditing(null)}><Plus className="size-4"/>新增线路</Button>}</div><div className="overflow-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted/20"><tr>{['线路名称','适用省份','状态','使用范围','操作'].map(h=><th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-medium">{h}</th>)}</tr></thead><tbody>{q.data?.lines.map(line=><tr key={line.id} className="border-t"><td className="min-w-36 px-4 py-4"><p className="font-medium">{line.name}</p>{line.note&&<p className="mt-1 text-xs text-muted-foreground">{line.note}</p>}</td><td className="max-w-72 px-4 py-4 text-xs leading-6">{line.provinces.join('、')}</td><td className="whitespace-nowrap px-4 py-4">{!line.enabled?'已停用':line.liveEnabled?'允许通话':'待开通'}</td><td className="whitespace-nowrap px-4 py-4 text-xs">{line.publicLine?'全公司':line.assignedUserIds?.length?`授权范围内 ${line.assignedUserIds.length} 人`:'指定员工'}</td><td className="whitespace-nowrap px-4 py-4">{q.data?.canConfigure&&<Button size="sm" variant="ghost" onClick={()=>setEditing(line)}>编辑</Button>}{q.data?.canManage&&line.canAssign!==false&&<Button size="sm" variant="ghost" onClick={()=>setAssigning(line)}>分配员工</Button>}{q.data?.canConfigure&&<Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={()=>{if(window.confirm(`移除“${line.name}”？其省份将改用默认线路；正在通话或待核对时无法移除。`))remove.mutate(line.id);}}>移除</Button>}</td></tr>)}</tbody></table>{!q.data?.lines.length&&<div className="py-10 text-center"><MapPin className="mx-auto size-6 text-muted-foreground"/><p className="mt-3 text-sm">还没有省份线路</p></div>}</div><Dialog open={editing!==undefined} onOpenChange={v=>{if(!v)setEditing(undefined);}}><DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-4xl"><DialogTitle>{editing?'编辑省份线路':'新增省份线路'}</DialogTitle><DialogDescription>省份规则与线路参数属于当前公司。保存不会发起电话。</DialogDescription>{editing!==undefined&&base.data&&<RouteForm key={editing?.id||'new'} route={editing} provinces={q.data?.provinces||[]} base={base.data} onDone={()=>setEditing(undefined)}/>}</DialogContent></Dialog><Dialog open={!!assigning} onOpenChange={v=>{if(!v)setAssigning(null);}}><DialogContent><DialogTitle>分配线路：{assigning?.name}</DialogTitle><DialogDescription>员工同时需要获得客户库中的客户授权。</DialogDescription>{assigning&&<Assignment key={assigning.id} route={assigning} onDone={()=>setAssigning(null)}/>}</DialogContent></Dialog></div>;
}
