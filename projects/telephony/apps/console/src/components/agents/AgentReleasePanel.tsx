/*
 * 中文导读：数字员工与话术的 AgentReleasePanel 组件，封装该界面的展示与交互。
 */
"use client";
import Link from 'next/link';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,Users,Send,MoreHorizontal,Loader2, RefreshCw, Save } from 'lucide-react';
import {agentReleases,useAgentRelease,type ReleaseStatus,type Audience} from '@/src/lib/api/resources/agent-releases';
import {companyApi,useCompanyContext} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {Button} from '../ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '../ui/dialog';
import {toast} from '@/src/lib/toast';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from '../ui/dropdown-menu';

export function AgentReleasePanel({agentId,dirty=false,onSave,publishRequest=0,scopeRequest=0,hidePublishAction=false,hideStatus=false,hideUseAction=false,hideMenu=false,saving=false,savedAt,menuItems,saveAction}:{agentId:string;dirty?:boolean;onSave?:()=>Promise<boolean>;publishRequest?:number;scopeRequest?:number;hidePublishAction?:boolean;hideStatus?:boolean;hideUseAction?:boolean;hideMenu?:boolean;saving?:boolean;savedAt?:string|null;menuItems?:ReactNode;saveAction?:ReactNode}){
 const {org,user}=useAliyunIdentity(),release=useAgentRelease(agentId),company=useCompanyContext(),qc=useQueryClient();
 const [review,setReview]=useState<ReleaseStatus|null>(null),[scopeOpen,setScopeOpen]=useState(false),[audience,setAudience]=useState<Audience>({allEmployees:true,userIds:[],departmentIds:[]}),[busy,setBusy]=useState(false);
 const units=useQuery({queryKey:['release-units',user,org],queryFn:()=>companyApi.departmentOptions(org),enabled:scopeOpen&&!!org,retry:false});
 const refresh=()=>{void qc.invalidateQueries({queryKey:['agent-release']});void qc.invalidateQueries({queryKey:['agents']});};
 const preparing=useRef(false);
 async function prepare(){if(preparing.current||busy)return;preparing.current=true;setBusy(true);try{if(onSave&&!await onSave())return;const status=await agentReleases.status(org,agentId);if(status.draftError)throw new Error(status.draftError);setReview(status);}catch(e){toast.error(e instanceof Error?e.message:'读取失败');}finally{preparing.current=false;setBusy(false);}}
 async function publish(){if(!review)return;setBusy(true);try{await agentReleases.publish(org,agentId,review.draftDigest);toast.success('正式版本已发布');setReview(null);refresh();}catch(e){toast.error(e instanceof Error?e.message:'发布失败');}finally{setBusy(false);}}
 async function saveScope(){setBusy(true);try{await agentReleases.audience(org,agentId,audience);setScopeOpen(false);refresh();toast.success('使用范围已保存');}catch(e){toast.error(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
 const toggle=(key:'userIds'|'departmentIds',id:string)=>setAudience(a=>({...a,[key]:a[key].includes(id)?a[key].filter(v=>v!==id):[...a[key],id]}));
 const handledRequest=useRef(0);
 useEffect(()=>{if(publishRequest>handledRequest.current){handledRequest.current=publishRequest;void prepare();}},[publishRequest]);
 const handledScope=useRef(0);
 useEffect(()=>{if(scopeRequest>handledScope.current&&release.data?.canPublish&&company.data?.allData){handledScope.current=scopeRequest;setAudience(release.data.audience||{allEmployees:true,userIds:[],departmentIds:[]});setScopeOpen(true);}},[scopeRequest,release.data,company.data?.allData]);
 const data=release.data;
 const label=saving?'保存中…':dirty?'有未保存修改':data?.hasUnpublishedChanges?'草稿待发布':data?.version?'已发布':'尚未发布';
 const pending=saving||dirty||data?.hasUnpublishedChanges;
 const detail=[savedAt?'草稿保存于 '+new Date(savedAt).toLocaleString('zh-CN'):'',data?.version?'当前已有正式版本':'尚无正式版本',data?.publishedAt?'发布于 '+new Date(data.publishedAt).toLocaleString('zh-CN'):''].filter(Boolean).join('；');
 return <section aria-label="编辑操作与版本" className="flex flex-wrap items-center gap-2 text-xs">
 {!hideStatus&&<span role="status" aria-live="polite" title={detail} className={'mr-1 inline-flex items-center gap-1.5 '+(pending?'text-amber-700 dark:text-amber-300':'text-muted-foreground')}>
 {saving?<Loader2 aria-hidden="true" className="size-3 animate-spin"/>:<span aria-hidden="true" className={'size-1.5 rounded-full '+(pending?'bg-amber-500':data?.version?'bg-emerald-500':'bg-slate-400')}/>}{release.isPending?'正在读取版本…':label}
 </span>}
 {release.error&&<span role="alert" className="text-destructive">版本读取失败<Button size="xs" variant="ghost" onClick={()=>void release.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重试</Button></span>}
 {!hideUseAction&&data?.usable&&<Button asChild variant="outline" size="sm"><Link href={'/outbound?agentId='+agentId}>使用助手</Link></Button>}
 {!hideMenu&&(menuItems||data?.canPublish&&company.data?.allData)&&<DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label="更多员工操作"><MoreHorizontal className="size-4"/>更多</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-44">{menuItems}{data?.canPublish&&company.data?.allData&&<>{menuItems&&<DropdownMenuSeparator/>}<DropdownMenuItem disabled={busy||saving} onSelect={()=>{setAudience(data.audience||{allEmployees:true,userIds:[],departmentIds:[]});setScopeOpen(true);}}><Users className="size-3.5"/>使用范围</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>}
 {saveAction}
 {data?.canPublish&&!hidePublishAction&&<Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/5" disabled={busy||saving||(!dirty&&!data.hasUnpublishedChanges)} onClick={()=>void prepare()}><Send className="size-3.5"/>{busy?'准备中…':'审核发布'}</Button>}

 <Dialog open={!!review} onOpenChange={open=>{if(!busy&&!open)setReview(null);}}><DialogContent><DialogHeader><DialogTitle>发布正式版本</DialogTitle><DialogDescription>统一发布已保存的话术、知识和声音设置，供授权员工新建任务使用。已有任务继续使用原版本。</DialogDescription></DialogHeader><p className="text-sm">{review?.name} · {review?.version?'更新现有设置':'首次发布'}</p><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setReview(null)}>返回检查</Button><Button disabled={busy} onClick={()=>void publish()}><Check className="size-4"/>{busy?'发布中…':'确认发布'}</Button></div></DialogContent></Dialog>
 <Dialog open={scopeOpen} onOpenChange={open=>{if(!busy)setScopeOpen(open);}}><DialogContent className="max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>助手使用范围</DialogTitle><DialogDescription>员工使用正式版本，每次对话和客户记录独立。</DialogDescription></DialogHeader><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={audience.allEmployees} onChange={e=>setAudience(a=>({...a,allEmployees:e.target.checked}))}/>全公司员工</label>{!audience.allEmployees&&<div className="space-y-4"><div><h3 className="mb-2 text-sm font-medium">指定部门（含下级）</h3>{units.error?<p role="alert" className="text-xs text-destructive">{units.error.message}</p>:units.data?.map(d=><label key={d.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={audience.departmentIds.includes(d.id)} onChange={()=>toggle('departmentIds',d.id)}/>{d.name}</label>)}</div><div><h3 className="mb-2 text-sm font-medium">指定员工</h3>{company.data?.assignees.map(m=><label key={m.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={audience.userIds.includes(m.id)} onChange={()=>toggle('userIds',m.id)}/>{m.name}{m.department?' · '+m.department.name:''}</label>)}</div></div>}<Button disabled={busy||!!units.error} onClick={()=>void saveScope()}><Save aria-hidden="true" className="size-4" />{busy?'保存中…':'保存使用范围'}</Button></DialogContent></Dialog>
 </section>;
}
