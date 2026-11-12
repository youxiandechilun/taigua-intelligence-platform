/*
 * 中文导读：线路与语音外呼的 ServiceProviders 组件，封装该界面的展示与交互。
 */
'use client';

import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';

export function useServiceProviders(){
 const {org,user}=useAliyunIdentity();
 return useQuery({queryKey:['telephony',user,org,'service-providers'],queryFn:()=>telephonyApi.serviceProviders(org),enabled:!!org&&!!user,staleTime:30000,retry:false});
}

export function NewServiceProviderButton({onCreated,compact=false}:{onCreated?:(name:string)=>void;compact?:boolean}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const [open,setOpen]=useState(false),[name,setName]=useState('');
 const save=useMutation({mutationFn:()=>telephonyApi.createServiceProvider(org,name),onSuccess:provider=>{void qc.invalidateQueries({queryKey:['telephony']});setOpen(false);setName('');onCreated?.(provider.name);toast.success('服务商已新增');},onError:(error:Error)=>toast.error(error.message)});
 return <>
  <Button type="button" size="sm" variant="outline" onClick={()=>setOpen(true)}><Plus aria-hidden="true" className="size-3.5"/>{compact?'新增':'新增服务商'}</Button>
  <Dialog open={open} onOpenChange={value=>{if(!save.isPending)setOpen(value);}}><DialogContent className="sm:max-w-sm" onClick={event=>event.stopPropagation()}>
   <DialogHeader><DialogTitle>新增服务商</DialogTitle><DialogDescription>SIP 线路服务商</DialogDescription></DialogHeader>
   <label className="grid gap-2 text-sm">服务商名称<Input autoFocus maxLength={80} placeholder="例如：南星通信" value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(name.trim()&&!save.isPending)save.mutate();}}}/></label>
   <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={()=>setOpen(false)}>取消</Button><Button type="button" disabled={!name.trim()||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'保存中…':'新增服务商'}</Button></div>
  </DialogContent></Dialog>
 </>;
}
