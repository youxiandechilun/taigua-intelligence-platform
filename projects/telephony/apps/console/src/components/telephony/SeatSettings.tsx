/*
 * 中文导读：线路与语音外呼的 SeatSettings 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus,Trash2, Save } from 'lucide-react';
import Link from 'next/link';
import {useCompanyContext,hasCompanyPermission} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type Seat} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';
function SeatRow({seat,canManage,onRemove}:{seat:Seat;canManage:boolean;onRemove:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const access=useCompanyContext();
 const [phone,setPhone]=useState(seat.phone),[available,setAvailable]=useState(seat.available),[name,setName]=useState(seat.name),[department,setDepartment]=useState(seat.department);
 const changed=phone!==seat.phone||available!==seat.available||name!==seat.name||department!==seat.department;
 const save=useMutation({mutationFn:()=>telephonyApi.saveSeat(org,seat.userId,{...(canManage?{phone,displayName:name,department}:{}),available}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('坐席设置已保存');},onError:(e:Error)=>toast.error(e.message)});
 return <tr className="border-t"><td className="px-4 py-3"><Input aria-label={seat.accountName+'的坐席名称'} disabled={!canManage} maxLength={60} value={name} onChange={e=>setName(e.target.value)}/><p className="mt-1 text-xs text-muted-foreground">账号：{seat.accountName}</p></td><td className="px-3 py-3"><Input aria-label={seat.accountName+'的部门'} disabled={!canManage} maxLength={60} placeholder="例如：销售部" value={department} onChange={e=>setDepartment(e.target.value)}/></td><td className="px-3 py-3"><Input aria-label={seat.accountName+'的接听号码'} disabled={!canManage} value={phone} placeholder="手机号或带区号座机" onChange={e=>setPhone(e.target.value)}/></td><td className="px-3 py-3"><label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" disabled={!phone||save.isPending} checked={available} onChange={e=>setAvailable(e.target.checked)}/>{available?'在岗':'离岗'}</label></td><td className="whitespace-nowrap px-4 py-3"><Button size="sm" variant="outline" disabled={!changed||save.isPending} onClick={()=>save.mutate()}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':'保存'}</Button>{hasCompanyPermission(access.data,'seats','delete')&&<Button size="icon" variant="ghost" className="ml-1 size-8 text-muted-foreground hover:text-destructive" aria-label={'移除'+seat.name+'的坐席'} disabled={save.isPending} onClick={onRemove}><Trash2 className="size-4"/></Button>}</td></tr>;
}
function NewSeat({seats,onDone}:{seats:Seat[];onDone:()=>void}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const candidates=useQuery({queryKey:['telephony',org,'seat-candidates'],queryFn:()=>telephonyApi.seatCandidates(org),retry:false});
 const [userId,setUserId]=useState(''),[name,setName]=useState(''),[department,setDepartment]=useState(''),[phone,setPhone]=useState('');
 const choices=candidates.data?.filter(m=>!seats.some(s=>s.userId===m.userId))||[];
 const save=useMutation({mutationFn:()=>telephonyApi.saveSeat(org,userId,{phone,displayName:name,department,available:false}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('坐席已新增');onDone();},onError:(e:Error)=>toast.error(e.message)});
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}><label className="grid gap-2 text-sm">关联公司账号<NativeSelect required aria-label="关联公司账号" className="h-9 rounded-md border bg-background px-3" value={userId} onChange={e=>{setUserId(e.target.value);setName(choices.find(m=>m.userId===e.target.value)?.name||'');}}><option value="">请选择员工账号</option>{choices.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}</NativeSelect></label>{candidates.error&&<p role="alert" className="text-xs text-destructive">{candidates.error.message}</p>}{!candidates.isPending&&!candidates.error&&!choices.length&&<p className="text-xs leading-5 text-muted-foreground">现有公司账号均已配置坐席。可先在<Link className="text-primary" href="/settings/members">员工管理</Link>新增账号，再回来配置。</p>}<div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">坐席名称<Input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label><label className="grid gap-2 text-sm">所属部门<Input maxLength={60} placeholder="例如：销售部" value={department} onChange={e=>setDepartment(e.target.value)}/></label></div><label className="grid gap-2 text-sm">接听号码<Input required placeholder="国内手机号或带区号座机" value={phone} onChange={e=>setPhone(e.target.value)}/></label><Button type="submit" disabled={!userId||!name.trim()||!phone.trim()||save.isPending}>{save.isPending?'新增中…':'新增坐席'}</Button></form>;
}
export function SeatSettings({canManage}:{canManage:boolean}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const access=useCompanyContext();
 const q=useQuery({queryKey:['telephony',user,org,'seats'],queryFn:()=>telephonyApi.seats(org),enabled:!!org,retry:false});
 const [adding,setAdding]=useState(false),[removing,setRemoving]=useState<Seat|null>(null);
 const remove=useMutation({mutationFn:()=>telephonyApi.removeSeat(org,removing!.userId),onSuccess:()=>{void qc.invalidateQueries({queryKey:['telephony']});toast.success('坐席已移除，可重新新增');setRemoving(null);},onError:(e:Error)=>toast.error(e.message)});
 return <><section className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between gap-3 px-4 py-4"><div><h2 className="text-sm font-semibold">人工坐席</h2></div>{hasCompanyPermission(access.data,'seats','create')&&<Button size="sm" onClick={()=>setAdding(true)}><Plus className="size-4"/>新增坐席</Button>}</div>{q.isPending?<p className="p-4 text-sm text-muted-foreground">正在加载坐席…</p>:q.error?<p role="alert" className="p-4 text-sm text-destructive">{q.error.message}</p>:<div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-t bg-muted/20 text-xs text-muted-foreground"><tr>{['坐席名称','所属部门','接听号码','工作状态','操作'].map(h=><th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead><tbody>{q.data?.map(s=><SeatRow key={org+s.userId+JSON.stringify(s)} seat={s} canManage={hasCompanyPermission(access.data,'seats','update')} onRemove={()=>setRemoving(s)}/>)}</tbody></table>{!q.data?.length&&<p className="p-8 text-center text-sm text-muted-foreground">{canManage?'尚未添加坐席，点击“新增坐席”开始配置。':'尚未分配人工坐席，请联系公司管理员。'}</p>}</div>}</section><Dialog open={adding} onOpenChange={setAdding}><DialogContent><DialogTitle>新增人工坐席</DialogTitle><DialogDescription>选择公司账号，设置接听号码。新增后默认为离岗。</DialogDescription><NewSeat seats={q.data||[]} onDone={()=>setAdding(false)}/></DialogContent></Dialog><Dialog open={!!removing} onOpenChange={v=>{if(!v&&!remove.isPending)setRemoving(null);}}><DialogContent><DialogTitle>移除人工坐席</DialogTitle><DialogDescription>移除“{removing?.name}”的接听配置，账号和通话记录会保留。之后可重新新增该坐席；有未结束通话时无法移除。</DialogDescription><div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={()=>setRemoving(null)}>取消</Button><Button variant="destructive" disabled={remove.isPending} onClick={()=>remove.mutate()}>{remove.isPending?'移除中…':'确认移除'}</Button></div></DialogContent></Dialog></>;
}
