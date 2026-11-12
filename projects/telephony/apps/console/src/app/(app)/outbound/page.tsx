/*
 * 中文导读：外呼任务的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import {useState} from 'react';
import {Bot,Headset} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {SipTaskCenter} from '@/src/components/telephony/SipTaskCenter';
import {ManualPhone} from '@/src/components/telephony/ManualPhone';
import {PageHeader} from '@/src/components/common/PageHeader';
import {Button} from '@/src/components/ui/button';

export default function OutboundPage(){
 const [tab,setTab]=useState<'ai'|'manual'>('ai');
 const {org,user}=useAliyunIdentity();
 return <div className="space-y-5">
  <PageHeader title="外呼" className="border-0 pb-0 sm:items-center" actions={
   <div className="flex gap-1 rounded-md border bg-muted/30 p-1" role="group" aria-label="通话方式">
    {([{id:'ai',label:'数字员工外呼',Icon:Bot},{id:'manual',label:'人工通话',Icon:Headset}] as const).map(({id,label,Icon})=><Button key={id} type="button" variant={tab===id?'default':'ghost'} className="h-9 gap-2 rounded px-4 text-sm" aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon className="size-4"/>{label}</Button>)}
   </div>
  }/>
  {tab==='ai'?<SipTaskCenter key={org+user}/>:<ManualPhone key={org+user}/>}
 </div>;
}
