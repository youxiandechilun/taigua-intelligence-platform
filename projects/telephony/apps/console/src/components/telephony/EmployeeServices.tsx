/*
 * 中文导读：线路与语音外呼的 EmployeeServices 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type VoiceProfile} from '@/src/lib/api/resources/telephony';
import type {CommunicationProfile} from '@/src/lib/api/resources/aliyun';
import {AudioLines} from 'lucide-react';
import {Button} from '../ui/button';

export function EmployeeModel({value,onChange,disabled}:{value:string;onChange:(model:string)=>void;disabled:boolean}){
 const {org,user}=useAliyunIdentity();
 const catalog=useQuery({queryKey:['employee-model-catalog',user,org],queryFn:()=>telephonyApi.models(org),enabled:!!org,retry:false});
 return <section className="space-y-3">
  <label className="grid gap-2 text-sm font-medium">文字演练模型<NativeSelect disabled={disabled||!catalog.data} className="h-9 rounded-md border bg-background px-3 font-normal" value={value} onChange={e=>onChange(e.target.value)}><option value="">沿用公司默认模型</option>{catalog.data?.models.filter(m=>m.kind==='text'&&(m.enabled||m.id===value)).map(m=><option key={m.id} value={m.id}>{m.name}{!m.enabled?'（待授权）':m.configured?'':'（待配置）'}</option>)}</NativeSelect></label>
  {catalog.error&&<p role="alert" className="text-sm text-destructive">{catalog.error.message}</p>}
 </section>;
}

export function EmployeeSipVoice({agentId}:{agentId:string;value:VoiceProfile;onChange:(profile:VoiceProfile)=>void;onGenderChange:(gender:CommunicationProfile['gender'])=>void;disabled:boolean;previewText?:string}){
 return <section className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-3 text-sm"><AudioLines className="size-4 text-muted-foreground"/><span>声音与开场白在话术中一并选择</span><Button asChild variant="outline" size="sm"><Link href={'/agents/'+agentId+'?tab=script'}>选择声音</Link></Button><Link className="ml-auto text-xs text-primary hover:underline" href="/voices">管理声音库</Link></section>;
}
