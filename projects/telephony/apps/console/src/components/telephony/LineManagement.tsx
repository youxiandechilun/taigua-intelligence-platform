/*
 * 中文导读：线路与语音外呼的 LineManagement 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import dynamic from 'next/dynamic';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Cloud,Phone,Plus,RefreshCw,Search, RotateCcw, UserRoundPlus, Settings2 } from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type CallerRow,type RegionalLine} from '@/src/lib/api/resources/telephony';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';
import {toast} from '@/src/lib/toast';
import {NativeSelect} from '@/src/components/ui/native-select';
import {NewServiceProviderButton,useServiceProviders} from './ServiceProviders';
import {VoiceOperationsPanel} from './VoiceOperationsPanel';
import {LineFailureHistory} from './LineFailureHistory';
import {TestNumberWhitelistPanel} from './TestNumberWhitelistPanel';
import {OutboundParallelismSettings} from './OutboundParallelismSettings';

const loading=()=> <p className="py-4 text-sm text-muted-foreground">正在读取配置…</p>;
const LineSettings=dynamic(()=>import('./LineSettings').then(m=>m.LineSettings),{loading});
const DefaultScopeForm=dynamic(()=>import('./LineEditors').then(m=>m.DefaultScopeForm),{loading});
const RegionalLineEditor=dynamic(()=>import('./LineEditors').then(m=>m.RegionalLineEditor),{loading});
const LineAssignment=dynamic(()=>import('./LineEditors').then(m=>m.LineAssignment),{loading});
const SharedCallSettings=dynamic(()=>import('./SharedCallSettings').then(m=>m.SharedCallSettings),{loading});
const AliyunLegacySettings=dynamic(()=>import('./AliyunLegacySettings'),{loading});
type Panel='details'|'configure'|'assign'|'remove'|'new';

function providerName(row:CallerRow){
 return row.provider==='HAOKEHU_SIP'?(row.serviceProvider||'好客呼'):row.provider==='ALIYUN_LEGACY'?'阿里云历史接入':'阿里云通信线路';
}
function usageScope(route?:RegionalLine){
 return !route||route.publicLine?'全公司':route.assignedUserIds?.length?`指定 ${route.assignedUserIds.length} 人`:'指定员工';
}
function LineDetails({row,route,scope}:{row:CallerRow;route?:RegionalLine;scope:string}){
 const config=route?.line;
 const fields=[
  {name:row.identifierLabel,value:row.identifier||'尚未配置'},
  {name:'服务商',value:providerName(row)},
  {name:'适用省份',value:scope},
  {name:'使用范围',value:usageScope(route)},
  {name:'客户来电显示',value:row.displayNumber||'待线路方确认'},
  {name:'通话开关',value:row.enabled?'已开启':'未开启'},
  ...row.usages.map(usage=>({name:usage.label,value:usage.ready?'配置就绪':'待完善'})),
  ...(config?[
   {name:'线路服务器',value:(config.serverIp||'待配置')+':'+(config.port||5060)},
   {name:'被叫前缀',value:config.prefix||'无'},
   {name:'线路白名单',value:config.whitelistConfirmed?'已确认加入':'待确认'},
   {name:'线路并发数',value:config.concurrency?String(config.concurrency):'不限'},
   {name:'每秒拨号数',value:config.callsPerSecond?String(config.callsPerSecond):'不限'},
   {name:'响铃等待',value:`${config.ringTimeoutSeconds??15} 秒`},
   {name:'资费',value:config.costPerMinute==null?'未填写':`${config.costPerMinute} 元/分钟`},
   ...(config.carrierPolicy?[{name:'服务商外呼时段',value:`${config.carrierPolicy.start}–${config.carrierPolicy.end}`},{name:'单个号码每日上限',value:config.carrierPolicy.maxCallsPerNumberPerDay?`${config.carrierPolicy.maxCallsPerNumberPerDay} 次`:'不限'},{name:'不支持的被叫地区',value:config.carrierPolicy.blockedProvinces.join('、')||'无'}]:[]),
  ]:[]),
 ];
 return <div className="space-y-5">
  <dl className="divide-y text-sm">{fields.map(field=><div key={field.name} className="grid grid-cols-[130px_minmax(0,1fr)] gap-4 py-3"><dt className="text-muted-foreground">{field.name}</dt><dd className="break-all font-medium">{field.value}</dd></div>)}</dl>
  {!!row.missing.length&&<div className="rounded-lg border p-4 text-sm"><h3 className="font-medium">待完善项目</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{row.missing.map(item=><li key={item}>{item}</li>)}</ul></div>}
 </div>;
}

export function LineManagement({provider,initialConfigure}:{provider:'HAOKEHU_SIP'|'ALIYUN';initialConfigure?:string}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [search,setSearch]=useState('');
 const [supplier,setSupplier]=useState('');
 const providers=useServiceProviders();
 const [selectedId,setSelectedId]=useState(initialConfigure||'');
 const [panel,setPanel]=useState<Panel|null>(initialConfigure?'configure':null);
 const [removed,setRemoved]=useState(false);
 const q=useQuery({
  queryKey:['telephony',user,org,'line-management'],
  queryFn:async()=>{
   const [callers,regional]=await Promise.all([telephonyApi.callers(org),telephonyApi.lines(org)]);
   return {...callers,regional};
  },
  enabled:!!org,retry:false,refetchInterval:30000,refetchIntervalInBackground:false,
 });
 const canConfigure=!!q.data?.canConfigure&&!!q.data?.regional.canConfigure;
 const routeFor=(row:CallerRow)=>q.data?.regional.lines.find(line=>line.id===row.id);
 const scopeFor=(row:CallerRow)=>routeFor(row)?.provinces.join('、')||(row.provider==='HAOKEHU_SIP'?(row.identifier?'未分省':'待设置'):'—');
 const providerRows=(q.data?.rows||[]).filter(row=>provider==='ALIYUN'?row.provider.startsWith('ALIYUN'):row.provider===provider);
 const selected=providerRows.find(row=>selectedId==='aliyun'?row.provider==='ALIYUN_ENGINE':row.id===selectedId);
 const selectedRoute=selected?routeFor(selected):undefined;
 const selectedRemoved=q.data?.regional.removedLines?.find(route=>route.id===selectedId);
 const selectedDefault=selected?.id==='haokehu-default'||selectedRoute?.defaultLine===true;
 const selectedName=selected?.name||selectedRemoved?.name||'线路';
 const term=search.trim().toLowerCase();
 const rows=providerRows.filter(row=>(!supplier||(row.serviceProvider||'好客呼')===supplier)&&(!term||[row.name,row.identifier,row.serviceProvider,scopeFor(row)].join(' ').toLowerCase().includes(term)));
 const removedRows=(q.data?.regional.removedLines||[]).filter(row=>provider==='HAOKEHU_SIP'&&(!supplier||(row.serviceProvider||row.line?.serviceProvider||'好客呼')===supplier)&&(!term||[row.name,row.line?.callerNumber,row.provinces.join('、')].join(' ').toLowerCase().includes(term)));
 const close=()=>setPanel(null);
 const open=(row:CallerRow,action:Panel)=>{setSelectedId(row.id);setPanel(action);};
 const refresh=()=>void qc.invalidateQueries({queryKey:['telephony']});
 const remove=useMutation({mutationFn:(id:string)=>telephonyApi.removeLine(org,id),onSuccess:()=>{refresh();close();toast.success('线路已移除，原通话记录保留');},onError:(error:Error)=>toast.error(error.message)});
 const restore=useMutation({mutationFn:(id:string)=>telephonyApi.restoreLine(org,id),onSuccess:async()=>{await qc.invalidateQueries({queryKey:['telephony']});toast.success('线路已恢复，仍处于停用状态，请在配置中重新开启');},onError:(error:Error)=>toast.error(error.message)});
 const provinces=q.data?.regional.provinces||[];
 const panelTitle=panel==='new'?'新增 SIP 线路':panel==='assign'?`分配员工 · ${selectedName}`:panel==='remove'?'移除线路':panel==='configure'?`配置 · ${selectedName}`:selectedName;
 const removeDescription=`移除“${selectedName}”后，这条线路不再供新任务使用。${selectedDefault?'这是默认线路，未匹配到其他线路的呼叫将无法继续使用它。':''}原配置和通话记录保留，可在“已移除”中恢复；恢复后仍处于停用状态，需重新开启。`;

 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex min-w-0 flex-wrap items-center gap-2">
    {provider==='HAOKEHU_SIP'&&<NativeSelect aria-label="筛选服务商" value={supplier} onChange={event=>setSupplier(event.target.value)}><option value="">全部服务商</option>{[...new Set([...(providers.data?.providers.map(p=>p.name)||[]),...providerRows.map(row=>row.serviceProvider||'好客呼')])].map(name=><option key={name} value={name}>{name}</option>)}</NativeSelect>}
    <div className="relative w-56 max-w-full"><Search aria-hidden="true" className="absolute top-2.5 left-3 size-4 text-muted-foreground"/><Input aria-label="搜索线路、号码或省份" className="pl-9" placeholder="搜索线路、号码或省份" value={search} onChange={event=>setSearch(event.target.value)}/></div>
    <Button variant="ghost" size="icon" disabled={q.isPending||q.isFetching} aria-label="刷新线路" onClick={()=>void q.refetch()}><RefreshCw className={'size-4 '+(!q.isPending&&q.isFetching?'animate-spin':'')}/></Button>
   </div>
   <div className="flex items-center gap-2">
    {canConfigure&&provider==='HAOKEHU_SIP'&&(removed||!!q.data?.regional.removedLines?.length)&&<Button size="sm" variant="ghost" aria-pressed={removed} onClick={()=>setRemoved(value=>!value)}>{removed?'返回线路列表':'已移除'}</Button>}
    {canConfigure&&provider==='HAOKEHU_SIP'&&!removed&&<NewServiceProviderButton onCreated={setSupplier}/>}
    {canConfigure&&provider==='HAOKEHU_SIP'&&!removed&&<Button size="sm" onClick={()=>{setSelectedId('');setPanel('new');}}><Plus className="size-4"/>新增线路</Button>}
   </div>
  </div>
  {removed&&<p className="text-sm leading-6 text-muted-foreground">已移除线路的配置和通话记录保留。恢复后仍处于停用状态，请在配置中重新开启。</p>}
  <section aria-label={removed?'已移除的线路':'线路列表'} className="overflow-hidden rounded-xl border bg-card">
   {q.isPending?<p className="p-8 text-sm text-muted-foreground">正在读取线路…</p>:q.error?<div role="alert" className="space-y-3 p-6"><p className="text-sm text-destructive">{q.error.message}</p><Button variant="outline" onClick={()=>void q.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>:<div className="overflow-x-auto">
    <table className="w-full min-w-[860px] text-left text-sm">
     <thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr>{['线路','主叫号码 / 标识','适用省份','状态','使用范围','操作'].map(label=><th key={label} className="whitespace-nowrap px-5 py-3 font-medium">{label}</th>)}</tr></thead>
     <tbody className="divide-y">{removed?removedRows.map(route=><tr key={route.id}><td className="px-5 py-4 font-medium">{route.name}{route.defaultLine&&<span className="mt-0.5 block text-xs font-normal text-muted-foreground">默认线路</span>}</td><td className="px-5 py-4 tabular-nums">{route.line?.callerNumber}</td><td className="px-5 py-4">{route.provinces.join('、')}</td><td className="px-5 py-4 text-muted-foreground">已移除</td><td className="px-5 py-4">{usageScope(route)}</td><td className="px-5 py-4"><Button size="sm" variant="ghost" aria-label={'恢复'+route.name} disabled={restore.isPending} onClick={()=>restore.mutate(route.id)}><RotateCcw aria-hidden="true" className="size-4" />{restore.isPending&&restore.variables===route.id?'恢复中…':'恢复线路'}</Button></td></tr>):rows.map(row=>{
      const route=routeFor(row);
      return <tr key={row.id} className="hover:bg-muted/15">
       <td className="px-5 py-4"><div className="flex items-center gap-3"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">{row.provider==='HAOKEHU_SIP'?<Phone className="size-4"/>:<Cloud className="size-4"/>}</span><button type="button" className="text-left font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>open(row,'details')}>{row.name}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{providerName(row)}</span></button></div></td>
       <td className="px-5 py-4 font-medium tabular-nums">{row.identifier||<span className="font-normal text-muted-foreground">尚未配置</span>}</td>
       <td className="max-w-60 px-5 py-4 leading-6" title={scopeFor(row)}>{(route?.provinces.length||0)>3?`${route!.provinces.length} 个省份`:scopeFor(row)}</td>
       <td className="whitespace-nowrap px-5 py-4"><span className={'inline-flex items-center gap-1.5 text-xs '+(row.ready?'text-emerald-700':row.localPreview?'text-amber-700':'text-muted-foreground')}><span aria-hidden="true" className="size-1.5 rounded-full bg-current"/>{row.localPreview?'未启用':row.ready?'配置就绪':row.identifier?'待完善':'待配置'}</span></td>
       <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{usageScope(route)}</td>
       <td className="whitespace-nowrap px-5 py-4"><div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary" aria-label={(canConfigure?'配置':'查看')+row.name} onClick={()=>open(row,canConfigure?'configure':'details')}><Settings2 aria-hidden="true" className="size-3.5"/>{canConfigure?'配置':'查看'}</Button>
        {q.data?.regional.canManage&&route&&route.canAssign!==false&&<Button variant="ghost" size="sm" aria-label={'分配员工：'+row.name} onClick={()=>open(row,'assign')}><UserRoundPlus aria-hidden="true" className="size-4" />分配员工</Button>}
        {canConfigure&&row.provider==='HAOKEHU_SIP'&&(route||row.id==='haokehu-default')&&<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" aria-label={'移除'+row.name} onClick={()=>open(row,'remove')}>移除</Button>}
       </div></td>
      </tr>;
     })}</tbody>
    </table>
    {!(removed?removedRows:rows).length&&<div className="py-12 text-center text-sm text-muted-foreground">{removed?'没有符合条件的已移除线路':'没有符合条件的线路'}</div>}
   </div>}
  </section>
  {provider==='HAOKEHU_SIP'&&!removed&&<LineFailureHistory/>}
  {provider==='HAOKEHU_SIP'&&<TestNumberWhitelistPanel/>}
  {canConfigure&&provider==='HAOKEHU_SIP'&&<OutboundParallelismSettings key={org}/>}
  {provider==='HAOKEHU_SIP'&&<VoiceOperationsPanel/>}
  <Dialog open={panel!==null} onOpenChange={value=>{if(!value)close();}}><DialogContent className={panel==='remove'?'sm:max-w-md':'max-h-[90dvh] overflow-y-auto sm:max-w-4xl'}>
   <DialogHeader><DialogTitle>{panelTitle}</DialogTitle><DialogDescription>{panel==='new'?'填写线路方提供的接入参数并选择适用省份。':panel==='remove'?removeDescription:selected?providerName(selected):selectedRemoved?'线路配置和历史通话记录已保留。':'正在读取线路'}</DialogDescription></DialogHeader>
   {q.isPending?loading():q.error?<p role="alert" className="text-sm text-destructive">{q.error.message}</p>:panel==='new'?canConfigure?<RegionalLineEditor route={null} provinces={provinces} onDone={close} initialProvider={supplier||undefined}/>:<p role="alert">当前账号不能新增线路。</p>:!selected?selectedRemoved?<div className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">此线路已移除，恢复后仍处于停用状态。请恢复后核对配置并重新开启。</p>{canConfigure&&<Button variant="outline" disabled={restore.isPending} onClick={()=>restore.mutate(selectedRemoved.id)}><RotateCcw aria-hidden="true" className="size-4"/>{restore.isPending?'恢复中…':'恢复线路'}</Button>}</div>:<p role="alert" className="text-sm text-muted-foreground">线路不存在或当前账号无权查看，请关闭后刷新列表。</p>:<>
    {panel==='details'&&<><LineDetails row={selected} route={selectedRoute} scope={scopeFor(selected)}/>{canConfigure&&<Button onClick={()=>setPanel('configure')}><Settings2 aria-hidden="true" className="size-4" />配置线路</Button>}</>}
    {panel==='configure'&&(canConfigure?<div className="space-y-5">
     {selected.provider==='HAOKEHU_SIP'?(selected.id==='haokehu-default'||selectedRoute?.defaultLine?<LineSettings>{selectedRoute&&<DefaultScopeForm key={selected.id} route={selectedRoute} provinces={provinces} onDone={()=>{}}/>}</LineSettings>:selectedRoute?<RegionalLineEditor key={selected.id} route={selectedRoute} provinces={provinces} onDone={close}/>:<p role="alert">未读取到此线路的配置，请刷新列表。</p>):selected.provider==='ALIYUN_LEGACY'?<AliyunLegacySettings/>:<SharedCallSettings mode="engine" expanded/>}
    </div>:<p role="alert">线路参数仅超级管理员可以修改。</p>)}
    {panel==='assign'&&selectedRoute&&(q.data?.regional.canManage&&selectedRoute.canAssign!==false?<LineAssignment key={selected.id} route={selectedRoute} onDone={close}/>:<p role="alert">当前账号不能分配此线路。</p>)}
    {panel==='remove'&&canConfigure&&selected.provider==='HAOKEHU_SIP'&&(selectedRoute||selected.id==='haokehu-default')&&<div className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">如仍有运行中的外呼任务或待核对通话，系统会拒绝移除。请先暂停相关任务并处理通话记录，再重试。</p><div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={close}>取消</Button><Button variant="destructive" disabled={remove.isPending} onClick={()=>remove.mutate(selected.id)}>{remove.isPending?'移除中…':'移除线路'}</Button></div></div>}
   </>}
  </DialogContent></Dialog>
 </div>;
}
