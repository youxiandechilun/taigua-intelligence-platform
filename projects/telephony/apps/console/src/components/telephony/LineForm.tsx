/*
 * 中文导读：线路配置表单，负责收集线路和呼叫参数。
 */
"use client";

import {useState,type ReactNode} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Save} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type Line,type CarrierPolicy} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {NativeSelect} from '@/src/components/ui/native-select';
import {toast} from '@/src/lib/toast';
import {useServiceProviders,NewServiceProviderButton} from './ServiceProviders';

const dialDays=[['MONDAY','一'],['TUESDAY','二'],['WEDNESDAY','三'],['THURSDAY','四'],['FRIDAY','五'],['SATURDAY','六'],['SUNDAY','日']];
const carrierDefaults:CarrierPolicy={start:'08:00',end:'21:00',maxCallsPerNumberPerDay:0,blockedProvinces:[]};
const provinces=['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆'];

export function LineForm({config,onSave,children}:{config:Line&{revision?:string};onSave?:(line:Line)=>Promise<unknown>;children?:ReactNode}){
 const {org}=useAliyunIdentity(),qc=useQueryClient(),providers=useServiceProviders();
 const [baseRevision,setBaseRevision]=useState(config.revision);
 const [draft,setDraft]=useState<Line>({serviceProvider:config.serviceProvider||'好客呼',callerMode:config.callerMode||'custom',carrierPolicy:config.carrierPolicy||null,name:config.name,trunkKey:config.trunkKey,serverIp:config.serverIp,port:config.port,transport:config.transport,callerNumber:config.callerNumber,prefix:config.prefix,employeePrefix:config.employeePrefix||'',codecs:config.codecs,concurrency:config.concurrency,callsPerSecond:config.callsPerSecond,ringTimeoutSeconds:config.ringTimeoutSeconds??15,costPerMinute:config.costPerMinute,liveEnabled:config.liveEnabled,whitelistConfirmed:config.whitelistConfirmed,dialPolicy:config.dialPolicy});
 const save=useMutation({mutationFn:()=>onSave?onSave(draft):telephonyApi.save(org,draft,baseRevision),onSuccess:result=>{if(!onSave&&result&&typeof result==='object'&&'revision' in result&&typeof result.revision==='string')setBaseRevision(result.revision);void qc.invalidateQueries({queryKey:['telephony']});toast.success('线路设置已保存');},onError:(error:Error)=>toast.error(error.message)});
 const field=(key:keyof Line,label:string,type='text')=><label className="grid gap-1.5 text-sm"><span>{label}</span><Input type={type} min={type==='number'?key==='port'?1:0:undefined} max={key==='port'?65535:undefined} step={key==='costPerMinute'?'0.001':type==='number'?1:undefined} required={key==='name'||key==='serverIp'||key==='port'} placeholder={key==='concurrency'||key==='callsPerSecond'?'0 表示不限':undefined} value={String(draft[key]??'')} onChange={event=>setDraft(value=>({...value,[key]:type==='number'?(key==='costPerMinute'&&!event.target.value?null:Number(event.target.value)):event.target.value}))}/></label>;
 const providerNames=[...new Set([...(providers.data?.providers.map(p=>p.name)||[]),draft.serviceProvider||'好客呼'])];
 const carrier=(patch:Partial<CarrierPolicy>)=>setDraft(value=>({...value,carrierPolicy:{...(value.carrierPolicy||carrierDefaults),...patch}}));
 return <form className="space-y-4" onSubmit={event=>{event.preventDefault();const ringTimeoutSeconds=draft.ringTimeoutSeconds;if(typeof ringTimeoutSeconds!=='number'||!Number.isInteger(ringTimeoutSeconds)||ringTimeoutSeconds<5||ringTimeoutSeconds>120){toast.error('响铃等待请填写5至120秒的整数');return;}if(draft.dialPolicy.timeRestricted!==false&&!draft.dialPolicy.days.length){toast.error('请至少选择一个拨打星期');return;}if(draft.dialPolicy.timeRestricted!==false&&draft.dialPolicy.start>=draft.dialPolicy.end){toast.error('结束时间必须晚于开始时间');return;}save.mutate();}}>
  <section className="space-y-4 rounded-lg border bg-card p-4">
   <div className="grid gap-3 sm:grid-cols-3">
    <label className="grid gap-1.5 text-sm"><span>服务商</span><div className="flex gap-2"><NativeSelect className="w-full" aria-label="线路服务商" value={draft.serviceProvider} onChange={event=>setDraft(value=>({...value,serviceProvider:event.target.value}))}>{providerNames.map(name=><option key={name} value={name}>{name}</option>)}</NativeSelect><NewServiceProviderButton compact onCreated={name=>setDraft(value=>({...value,serviceProvider:name}))}/></div></label>
    {field('name','线路名称')}{field('costPerMinute','资费（元/分钟）','number')}
    {field('serverIp','SIP 服务器 IP')}{field('port','端口','number')}{field('prefix','被叫前缀')}
    <label className="grid gap-1.5 text-sm">主叫方式<NativeSelect aria-label="主叫方式" value={draft.callerMode} onChange={event=>setDraft(value=>({...value,callerMode:event.target.value as Line['callerMode'],callerNumber:event.target.value==='provider'?'':value.callerNumber}))}><option value="custom">指定主叫标识</option><option value="provider">由服务商提供</option></NativeSelect></label>
    {draft.callerMode==='custom'?field('callerNumber','主叫标识'):null}
    <label className="grid gap-1.5 text-sm">传输方式<NativeSelect value={draft.transport} onChange={event=>setDraft(value=>({...value,transport:event.target.value as Line['transport']}))}><option value="udp">UDP</option><option value="tcp">TCP</option></NativeSelect></label>
    <label className="grid gap-1.5 text-sm"><span>响铃等待（秒）</span><Input type="number" min={5} max={120} step={1} required value={draft.ringTimeoutSeconds??''} onChange={event=>setDraft(value=>({...value,ringTimeoutSeconds:event.target.value===''?undefined:Number(event.target.value)}))}/></label>
   </div>
   <p className="text-xs leading-5 text-muted-foreground">默认15秒，可设置5至120秒。从发起客户呼叫开始计时，未接通到时自动挂断；已接通通话不受此设置影响。保存后，等待中的任务和后续新呼叫使用新设置。</p>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.whitelistConfirmed} onChange={event=>setDraft(value=>({...value,whitelistConfirmed:event.target.checked}))}/>服务器公网 IP 已加入服务商白名单</label>
  </section>
  {children}
  <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="线路拨打时段">
   <h3 className="text-sm font-medium">拨打时段 <span className="font-normal text-muted-foreground">· 北京时间</span></h3>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.dialPolicy.timeRestricted!==false} onChange={event=>setDraft(value=>({...value,dialPolicy:{...value.dialPolicy,timeRestricted:event.target.checked}}))}/>限制拨打时间和星期</label>
   {draft.dialPolicy.timeRestricted!==false&&<>
   <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1.5 text-sm">开始时间<Input className="w-32" type="time" required value={draft.dialPolicy.start} onChange={event=>setDraft(value=>({...value,dialPolicy:{...value.dialPolicy,start:event.target.value}}))}/></label><label className="grid gap-1.5 text-sm">结束时间<Input className="w-32" type="time" required value={draft.dialPolicy.end} onChange={event=>setDraft(value=>({...value,dialPolicy:{...value.dialPolicy,end:event.target.value}}))}/></label></div>
   <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2"><legend className="mb-2 text-sm">允许拨打的星期</legend>{dialDays.map(([day,label])=><label key={day} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={draft.dialPolicy.days.includes(day!)} onChange={event=>setDraft(value=>({...value,dialPolicy:{...value.dialPolicy,days:event.target.checked?[...value.dialPolicy.days,day!]:value.dialPolicy.days.filter(item=>item!==day)}}))}/>周{label}</label>)}</fieldset>
   </>}
   <p className="text-xs leading-5 text-muted-foreground">{draft.dialPolicy.timeRestricted===false?'全天可拨，不限制时间和星期。':'保存后，新任务和等待中的任务按此时段拨打；时段外自动等待，到时继续。'}{draft.dialPolicy.holidayRestricted?'当前也会避开已设置的节假日。':''}{draft.carrierPolicy?'同时受下方服务商拨打时段限制。':''}</p>
  </section>
  <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">并发与接入参数</summary><div className="mt-4 grid gap-3 sm:grid-cols-3">
   {field('concurrency','并发上限','number')}{field('callsPerSecond','每秒拨号上限','number')}{field('trunkKey','共用线路标识')}{field('employeePrefix','员工号码前缀')}
   <label className="grid gap-1.5 text-sm">语音编码<NativeSelect value={draft.codecs?.join(',')} onChange={event=>setDraft(value=>({...value,codecs:event.target.value.split(',')}))}><option value="PCMA,PCMU">PCMA / PCMU</option><option value="PCMA">PCMA</option><option value="PCMU">PCMU</option></NativeSelect></label>
  </div></details>
  <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">服务商拨打限制{draft.carrierPolicy?` · ${draft.carrierPolicy.start}–${draft.carrierPolicy.end}`:''}</summary><div className="mt-4 space-y-4">
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.carrierPolicy} onChange={event=>setDraft(value=>({...value,carrierPolicy:event.target.checked?{...carrierDefaults}:null}))}/>按服务商规则限制拨打</label>
   {draft.carrierPolicy&&<><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm">开始时间<Input type="time" required value={draft.carrierPolicy.start} onChange={event=>carrier({start:event.target.value})}/></label><label className="grid gap-1.5 text-sm">结束时间<Input type="time" required value={draft.carrierPolicy.end} onChange={event=>carrier({end:event.target.value})}/></label><label className="grid gap-1.5 text-sm">单个号码每天最多拨打<Input type="number" min={0} max={10000} step={1} required value={draft.carrierPolicy.maxCallsPerNumberPerDay} onChange={event=>carrier({maxCallsPerNumberPerDay:Number(event.target.value)})}/></label></div>
   <details><summary className="cursor-pointer text-sm">不支持的被叫地区{draft.carrierPolicy.blockedProvinces.length?' · '+draft.carrierPolicy.blockedProvinces.join('、'):' · 无'}</summary><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{provinces.map(province=><label key={province} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.carrierPolicy!.blockedProvinces.includes(province)} onChange={event=>carrier({blockedProvinces:event.target.checked?[...draft.carrierPolicy!.blockedProvinces,province]:draft.carrierPolicy!.blockedProvinces.filter(p=>p!==province)})}/>{province}</label>)}</div></details></>}
  </div></details>
  <div className="flex items-center justify-between gap-4 border-t pt-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.liveEnabled} onChange={event=>setDraft(value=>({...value,liveEnabled:event.target.checked}))}/>启用此线路通话</label><Button disabled={save.isPending} type="submit"><Save aria-hidden="true" className="size-4"/>{save.isPending?'保存中…':'保存线路'}</Button></div>
 </form>;
}
