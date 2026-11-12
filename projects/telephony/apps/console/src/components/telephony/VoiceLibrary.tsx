/*
 * 中文导读：线路与语音外呼的 VoiceLibrary 组件，封装该界面的展示与交互。
 */
"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MoreHorizontal,RefreshCw,Search,Settings2,Trash2,Upload} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {telephonyApi,type Voice} from '@/src/lib/api/resources/telephony';
import {PageHeader} from '../common/PageHeader';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '../ui/dialog';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {VoiceDeliverySettings} from './VoiceDeliverySettings';
import {VoiceLibraryUpload} from './VoiceLibraryUpload';
import {VoiceLibraryRow} from './VoiceLibraryRow';
import {refreshVoiceLibrary} from './voice-library-cache';

export function VoiceLibrary(){
 const {org,user}=useAliyunIdentity(),client=useQueryClient(),company=useCompanyContext();
 const [mounted,setMounted]=useState(false),[adding,setAdding]=useState(false),[uploading,setUploading]=useState(false);
 const [removed,setRemoved]=useState(false),[defaults,setDefaults]=useState(false),[filter,setFilter]=useState<'enabled'|'all'>('enabled');
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[activeVoice,setActiveVoice]=useState('');
 const onUploadBusy=useCallback((value:boolean)=>setUploading(value),[]);
 useEffect(()=>setMounted(true),[]);
 useEffect(()=>{setAdding(false);setRemoved(false);setDefaults(false);setActiveVoice('');setPage(1);setSearch('');},[org,user]);
 const query=useQuery({queryKey:['voice-library',user,org],queryFn:()=>telephonyApi.voices(org),enabled:mounted&&!!org,retry:false,refetchInterval:query=>query.state.data?.voices.some(voice=>voice.status==='SUBMITTING'||['ANALYZING','TRANSCRIBING','ENROLLING'].includes(voice.opening?.status||'')||voice.previewStatus==='GENERATING')?5000:false,refetchIntervalInBackground:false});
 const voices=(query.data?.voices||[]).filter(voice=>voice.provider==='HAOKEHU_SIP');
 const text=search.trim().toLocaleLowerCase(),filtered=voices.filter(voice=>(filter==='all'||voice.enabled!==false)&&(!text||[voice.name,voice.opening?.text||''].some(value=>value.toLocaleLowerCase().includes(text))));
 const pages=Math.max(1,Math.ceil(filtered.length/12)),currentPage=Math.min(page,pages),visible=filtered.slice((currentPage-1)*12,currentPage*12);
 const employeeNames=useMemo(()=>new Map(company.data?.assignees.map(employee=>[employee.id,employee.name])||[]),[company.data?.assignees]);
 const canManage=!!query.data?.canManage,canManageAccess=!!query.data?.canManageAccess;
 function refresh(){void query.refetch();refreshVoiceLibrary(client);}
 function table(rows:Voice[],archived=false){return <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full min-w-[960px] table-fixed text-left text-sm"><caption className="sr-only">{archived?'已删除声音':'声音库'}，员工列展示可选择此声音的员工账号</caption><colgroup><col className="w-[18%]"/><col className="w-[31%]"/><col className="w-[16%]"/><col className="w-[12%]"/><col className="w-[23%]"/></colgroup><thead className="bg-muted/30"><tr>{['声音名称','开场白','可使用员工','状态','操作'].map((label,index)=><th key={label} scope="col" className={'px-5 py-3 text-xs font-medium text-muted-foreground '+(index===4?'text-right':'')}>{label}</th>)}</tr></thead><tbody>{rows.map(voice=><VoiceLibraryRow key={org+user+voice.id} voice={voice} removed={archived} canManage={canManage} canManageAccess={canManageAccess} employeeNames={employeeNames} activeVoiceId={activeVoice} onPlay={setActiveVoice}/>)}</tbody></table>{rows.length===0&&<div role="status" className="py-14 text-center text-sm text-muted-foreground">{archived?'暂无已删除声音':search?'没有符合条件的声音':filter==='enabled'?'暂无已启用声音':'暂无声音'}{!archived&&filter==='enabled'&&!search&&voices.length>0&&<Button variant="link" size="sm" onClick={()=>setFilter('all')}>查看全部声音</Button>}</div>}</div>;}
 return <main className="space-y-5">
  <PageHeader title="声音库" actions={<><Button type="button" size="icon-sm" variant="outline" aria-label="刷新声音库" disabled={query.isFetching} onClick={refresh}><RefreshCw aria-hidden="true" className={query.isFetching?'size-4 animate-spin':'size-4'}/></Button>{canManage&&<><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="outline" aria-label="声音库更多操作"><MoreHorizontal aria-hidden="true" className="size-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40">{company.data?.isSystemAdmin&&<DropdownMenuItem onSelect={()=>setDefaults(true)}><Settings2/>默认声音设置</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>{setActiveVoice('');setRemoved(true);}}><Trash2/>已删除声音</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button type="button" size="sm" onClick={()=>setAdding(true)}><Upload aria-hidden="true" className="size-4"/>上传声音</Button></>}</>}/>
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1" role="group" aria-label="声音筛选">{([['enabled','已启用'],['all','全部声音']] as const).map(([value,label])=><Button key={value} size="sm" variant={filter===value?'secondary':'ghost'} aria-pressed={filter===value} className={filter===value?'text-primary':''} onClick={()=>{setFilter(value);setPage(1);setActiveVoice('');}}>{label}{query.data&&<span className="text-xs tabular-nums text-muted-foreground">{value==='enabled'?voices.filter(voice=>voice.enabled!==false).length:voices.length}</span>}</Button>)}</div><div className="relative w-full sm:w-72"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="搜索声音名称或开场文字" className="pl-9" placeholder="搜索声音名称、开场文字" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);setActiveVoice('');}}/></div></div>
  {query.error&&<div role="alert" className="flex items-center gap-3 rounded-md border p-4 text-sm text-destructive">{query.error.message}<Button size="sm" variant="outline" onClick={()=>void query.refetch()}>重新加载</Button></div>}
  {query.isPending?<p role="status" className="rounded-lg border py-14 text-center text-sm text-muted-foreground">正在读取声音库…</p>:query.data&&table(visible)}
  {query.data&&<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>共 {filtered.length} 个声音</span>{pages>1&&<div className="flex items-center gap-3"><span>第 {currentPage} / {pages} 页</span><Button size="sm" variant="outline" disabled={currentPage===1} onClick={()=>{setActiveVoice('');setPage(currentPage-1);}}>上一页</Button><Button size="sm" variant="outline" disabled={currentPage===pages} onClick={()=>{setActiveVoice('');setPage(currentPage+1);}}>下一页</Button></div>}</div>}
  <Dialog open={adding} onOpenChange={next=>{if(!uploading)setAdding(next);}}><DialogContent><DialogHeader><DialogTitle>上传声音</DialogTitle><DialogDescription>从本人的开场录音建立声音，供数字员工选择使用。</DialogDescription></DialogHeader>{adding&&<VoiceLibraryUpload key={org+user} onDone={()=>setAdding(false)} onBusyChange={onUploadBusy}/>}</DialogContent></Dialog>
  <Dialog open={removed} onOpenChange={next=>{setRemoved(next);setActiveVoice('');}}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>已删除声音</DialogTitle><DialogDescription>恢复后需重新启用，历史通话保留。</DialogDescription></DialogHeader>{removed&&table((query.data?.removedVoices||[]).filter(voice=>voice.provider==='HAOKEHU_SIP'),true)}</DialogContent></Dialog>
  <VoiceDeliverySettings open={defaults} onOpenChange={setDefaults} hideTrigger/>
 </main>;
}
