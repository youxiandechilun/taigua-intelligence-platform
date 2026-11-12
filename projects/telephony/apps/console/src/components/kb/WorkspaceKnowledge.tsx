/*
 * 中文导读：知识库的 WorkspaceKnowledge 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {KnowledgeLibraryView} from './KnowledgeLibraryView';
import {KnowledgeFaqView} from './KnowledgeFaqView';
import {KnowledgeFaqEditor} from './KnowledgeFaqEditor';
import {KnowledgeSearchPreview} from './KnowledgeSearchPreview';
import {KnowledgeVersions} from './KnowledgeVersions';
const KnowledgeRecordingUpload=dynamic(()=>import('./KnowledgeRecordingUpload'));
const KnowledgeOperations=dynamic(()=>import('./KnowledgeOperations'));
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import { Folder, FolderPlus, Upload, Sparkles, Trash2, RotateCcw, Loader2, RefreshCw, Save } from "lucide-react";
import {authClient} from '@/src/lib/auth-client';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {useAgents} from '@/src/hooks/queries/agents';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Textarea} from '@/src/components/ui/textarea';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/src/components/ui/sheet';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/src/components/ui/dialog';
import {PageHeader} from '@/src/components/common/PageHeader';
import {toast} from '@/src/lib/toast';
import {knowledgeTemplate} from './knowledge-template';
import {knowledgeStatus,knowledgeDate,type KnowledgeLibrary,type KnowledgeItem,type KnowledgeCandidate,type KnowledgeCategory} from './knowledge-types';

type AgentOption={agentId:string;name:string};
type Fields={agentId:string|null;categoryId:string|null};
const base='/workspace-knowledge';
const localPreview=process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true';
const toLocal=(v?:string|null)=>v?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)).replace(' ','T'):'';
const toUtc=(v:string)=>v?new Date(v+':00+08:00').toISOString():null;
const usable=(c:KnowledgeCandidate)=>(!c.needsConfirmation||c.confirmed===true)&&(!c.requiresExpiry||!!c.validUntil)&&(!c.validUntil||new Date(c.validUntil).getTime()>Date.now());
const selectClass='h-9 min-w-0 rounded-md border bg-background px-3 text-sm';
const freshNote=(agentId?:string,categoryId?:string|null):KnowledgeItem=>({id:'new',kind:'note',title:'',content:'',agentId:agentId||null,categoryId:categoryId||null,tags:[],enabled:true,status:'ENABLED'});
function ScopeFields({value,onChange,categories,agents,disabled=false}:{value:Fields;onChange:(value:Fields)=>void;categories:KnowledgeCategory[];agents:AgentOption[];disabled?:boolean}){
 return <div className="grid gap-4 sm:grid-cols-2">
  <label className="grid gap-2 text-sm">分类<NativeSelect className={selectClass} disabled={disabled} value={value.categoryId||''} onChange={e=>onChange({...value,categoryId:e.target.value||null})}><option value="">未分类</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></label>
  <label className="grid gap-2 text-sm">适用数字员工<NativeSelect className={selectClass} disabled={disabled} value={value.agentId||''} onChange={e=>onChange({...value,agentId:e.target.value||null})}><option value="">全部数字员工</option>{agents.map(a=><option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect></label>
 </div>;
}
function NoteEditor({item,categories,agents,canEdit,busy,onSave,onDirty}:{item:KnowledgeItem;categories:KnowledgeCategory[];agents:AgentOption[];canEdit:boolean;busy:boolean;onSave:(item:KnowledgeItem)=>void;onDirty:(v:boolean)=>void}){
 const [value,setValue]=useState(item),[tagText,setTagText]=useState(item.tags.join('，'));
 const metadataOnly=item.kind==='source'&&item.organizable===false;
 const patch=(next:KnowledgeItem)=>{setValue(next);onDirty(true);};
 return <form className="space-y-5" onSubmit={e=>{e.preventDefault();onSave(value);}}>
  <fieldset disabled={!canEdit||busy} className="space-y-5">
   <label className="grid gap-2 text-sm">资料标题<Input required maxLength={160} value={value.title} onChange={e=>patch({...value,title:e.target.value})}/></label>
   <ScopeFields value={value} onChange={v=>patch({...value,...v})} categories={categories} agents={agents}/>
   <label className="grid gap-2 text-sm">关键词<Input maxLength={370} value={tagText} onChange={e=>{setTagText(e.target.value);patch({...value,tags:e.target.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});}} placeholder="用逗号分隔"/></label>
   <label className="grid gap-2 text-sm">{metadataOnly?'原始资料登记':'知识正文'}<Textarea required={!metadataOnly} readOnly={metadataOnly} rows={metadataOnly?4:14} maxLength={60000} value={value.content||''} onChange={e=>patch({...value,content:e.target.value})}/></label>
   {!metadataOnly&&<label className="grid gap-2 text-sm">有效期至（北京时间，留空为长期）<Input type="datetime-local" value={toLocal(value.validUntil)} onChange={e=>patch({...value,validUntil:toUtc(e.target.value)})}/></label>}
   <label className="flex items-center gap-2 text-sm"><input className="accent-primary" type="checkbox" checked={value.enabled} onChange={e=>patch({...value,enabled:e.target.checked})}/>启用此知识</label>
  </fieldset>
  {item.sourceQuote&&<details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">来源：{item.sourceTitle}</summary><blockquote className="mt-3 whitespace-pre-wrap border-l-2 pl-3 leading-6 text-muted-foreground">{item.sourceQuote}</blockquote></details>}
  {canEdit&&<div className="sticky bottom-0 flex justify-end border-t bg-background py-3"><Button disabled={busy||!value.title.trim()||!metadataOnly&&!value.content?.trim()}><Save aria-hidden="true" className="size-4" />{busy?'保存中…':'保存知识'}</Button></div>}
 </form>;
}
function KnowledgeReview({item,categories,busy,onSubmit,onDirty}:{item:KnowledgeItem;categories:KnowledgeCategory[];busy:boolean;onSubmit:(entries:KnowledgeCandidate[])=>void;onDirty:(v:boolean)=>void}){
 const analysis=item.analysis||{};
 const [entries,setEntries]=useState(()=>(analysis.candidates||[]).map(original=>{const c=analysis.reviewedEntries?.find(v=>v.id===original.id)||original;return {...c,categoryId:c.categoryId||categories.find(k=>k.name===c.category)?.id||null};}));
 const [selected,setSelected]=useState(()=>new Set(entries.filter(usable).map(c=>c.id)));
 const patch=(id:string,values:Partial<KnowledgeCandidate>)=>{setEntries(all=>all.map(c=>c.id===id?{...c,...values}:c));onDirty(true);};
 const completed=item.status==='COMPLETED';
 return <div className="space-y-5">
  {analysis.summary&&<p className="text-sm leading-6">{analysis.summary}</p>}
  {!!analysis.keywords?.length&&<div className="flex flex-wrap gap-2">{analysis.keywords.map(t=><span key={t} className="rounded-md bg-muted px-2 py-1 text-xs">{t}</span>)}</div>}
  {!!analysis.warnings?.length&&<details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm"><summary className="cursor-pointer font-medium text-amber-800">待确认 {analysis.warnings.length} 项</summary><ul className="mt-3 list-disc space-y-2 pl-4">{analysis.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
  {!!analysis.removed?.length&&<details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer text-muted-foreground">查看过滤内容</summary><ul className="mt-3 list-disc space-y-2 pl-4">{analysis.removed.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
  <div className="flex items-center justify-between"><h3 className="font-semibold">提取知识 <span className="ml-2 text-sm font-normal text-muted-foreground">{entries.length}</span></h3>{!completed&&<Button variant="ghost" size="sm" onClick={()=>{setSelected(selected.size?new Set():new Set(entries.filter(usable).map(c=>c.id)));onDirty(true);}}>{selected.size?'取消全选':'选择可入库项'}</Button>}</div>
  {!entries.length&&<p className="rounded-lg border p-4 text-sm text-muted-foreground">没有提取到有充分依据的知识。</p>}
  {entries.map(c=><section key={c.id} className="space-y-3 rounded-lg border p-4">
   <div className="flex items-center gap-3">
    {!completed&&<input type="checkbox" className="size-4 accent-primary" aria-label={'选择'+c.title} disabled={busy||!usable(c)} checked={selected.has(c.id)} onChange={e=>{setSelected(current=>{const next=new Set(current);if(e.target.checked)next.add(c.id);else next.delete(c.id);return next;});onDirty(true);}}/>}
    <span className="flex-1 text-sm font-semibold">{c.title}</span>
    {c.needsConfirmation&&!c.confirmed&&<span className="text-xs text-amber-700">需人工确认</span>}
    {completed&&<span className="text-xs text-muted-foreground">{analysis.acceptedIds?.includes(c.id)?'已审核采用':'未采用'}</span>}
   </div>
   <fieldset className="space-y-3" disabled={busy||completed}>
    <Input aria-label="知识标题" maxLength={100} value={c.title} onChange={e=>patch(c.id,{title:e.target.value})}/>
    <Textarea aria-label="知识正文" rows={4} maxLength={4000} value={c.content} onChange={e=>patch(c.id,{content:e.target.value})}/>
    <NativeSelect aria-label="知识分类" className={selectClass+' w-full'} value={c.categoryId||''} onChange={e=>patch(c.id,{categoryId:e.target.value||null})}><option value="">未分类</option>{categories.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</NativeSelect>
   </fieldset>
   {!completed&&<div className="grid gap-3 sm:grid-cols-2">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={busy} checked={c.confirmed===true} onChange={e=>{patch(c.id,{confirmed:e.target.checked});if(!e.target.checked&&c.needsConfirmation)setSelected(current=>{const next=new Set(current);next.delete(c.id);return next;});}}/>已核实业务内容</label>
    <label className="grid gap-1.5 text-sm">{c.requiresExpiry?'有效期至（必填，北京时间）':'有效期至（可选，北京时间）'}<Input type="datetime-local" disabled={busy} value={toLocal(c.validUntil)} onChange={e=>patch(c.id,{validUntil:toUtc(e.target.value)})}/></label>
   </div>}
   <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">原文依据</summary><blockquote className="mt-2 whitespace-pre-wrap border-l-2 pl-3 leading-6">{c.quote}</blockquote></details>
  </section>)}
  {completed?<p role="status" className="text-sm text-muted-foreground">已入库 {analysis.inserted||0} 条，跳过重复 {analysis.duplicates||0} 条。</p>:<div className="sticky bottom-0 flex justify-end border-t bg-background py-3"><Button disabled={busy||entries.some(c=>selected.has(c.id)&&(!c.title.trim()||!c.content.trim()||!usable(c)))} onClick={()=>onSubmit(entries.filter(c=>selected.has(c.id)))}>{busy?'正在入库…':selected.size?'审核入库 '+selected.size+' 条':'完成审核，不入库'}</Button></div>}
 </div>;
}
function DocumentView({item,categories,agents,busy,onSave,onAnalyze,onReview,onDirty}:{item:KnowledgeItem;categories:KnowledgeCategory[];agents:AgentOption[];busy:boolean;onSave:(v:KnowledgeItem)=>void;onAnalyze:()=>void;onReview:(entries:KnowledgeCandidate[])=>void;onDirty:(v:boolean)=>void}){
 const [value,setValue]=useState(item);
 const [changed,setChanged]=useState(false);
 const patch=(next:KnowledgeItem)=>{setValue(next);setChanged(true);onDirty(true);};
 const processing=['QUEUED','PROCESSING'].includes(item.status);
 return <div className="space-y-5">
  <fieldset disabled={busy||processing} className="space-y-4">
   <label className="grid gap-2 text-sm">资料名称<Input maxLength={160} value={value.title} onChange={e=>patch({...value,title:e.target.value})}/></label>
   <ScopeFields value={value} onChange={v=>patch({...value,...v})} categories={categories} agents={agents}/>
  </fieldset>
  {changed&&<Button size="sm" disabled={busy||processing||!value.title.trim()} onClick={()=>onSave(value)}><Save aria-hidden="true" className="size-4" />保存资料设置</Button>}
  {item.error&&<p role="alert" className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-amber-800">{item.error}</p>}
  {processing?<div role="status" className="flex items-center gap-2 rounded-lg bg-muted/50 p-4 text-sm"><Loader2 className="size-4 animate-spin"/>{item.status==='QUEUED'?'等待开始整理':'正在整理资料'}{item.analysis?.total?' '+(item.analysis.progress||0)+' / '+item.analysis.total:''}</div>:['AVAILABLE','NEEDS_REVIEW'].includes(item.status)&&<Button disabled={busy||changed} onClick={onAnalyze}><Sparkles className="size-4"/>{item.status==='NEEDS_REVIEW'?'重新整理':'AI 整理'}</Button>}
  <details open={!['REVIEW','COMPLETED'].includes(item.status)} className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">原始资料</summary><p className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-7">{item.content}</p></details>
  {['REVIEW','COMPLETED'].includes(item.status)&&<KnowledgeReview key={item.id+':'+item.revision} item={item} categories={categories} busy={busy||changed} onSubmit={onReview} onDirty={onDirty}/>}
 </div>;
}

export function WorkspaceKnowledge(props:{agentId?:string;compact?:boolean;title?:string;initialDocumentId?:string;initialTrash?:boolean}){
 const {data:session}=authClient.useSession(),org=session?.session.activeOrganizationId||'',user=session?.user.id||'';
 return <KnowledgeCenter key={org+':'+user+':'+(props.agentId||'')+':'+(props.initialDocumentId||'')+':'+!!props.initialTrash} {...props} org={org} user={user}/>;
}
function KnowledgeCenter({agentId,compact=false,title='业务知识',org,user,initialDocumentId,initialTrash=false}:{agentId?:string;compact?:boolean;title?:string;org:string;user:string;initialDocumentId?:string;initialTrash?:boolean}){
 const qc=useQueryClient(),agents=useAgents(),headers={'x-workspace-id':org};
 const [category,setCategory]=useState('all'),[kind,setKind]=useState('all'),[scope,setScope]=useState('all'),[search,setSearch]=useState(''),[trash,setTrash]=useState(initialTrash),[page,setPage]=useState(1);
 const [selected,setSelected]=useState<KnowledgeItem|null>(()=>initialDocumentId?{...freshNote(),id:initialDocumentId,kind:'document',title:'录音学习资料'}:null),[newNote,setNewNote]=useState<KnowledgeItem|null>(null),[upload,setUpload]=useState(false),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
 const [categoriesOpen,setCategoriesOpen]=useState(false),[categoryEdit,setCategoryEdit]=useState({id:'new',name:''});
 const [confirm,setConfirm]=useState<{title:string;description:string;action:()=>Promise<void>}|null>(null);
 const [analysisTarget,setAnalysisTarget]=useState<KnowledgeItem|null>(null);
 const [searchTerm,setSearchTerm]=useState(''),[previewOpen,setPreviewOpen]=useState(false),[recordingUpload,setRecordingUpload]=useState(false);
 const [operations,setOperations]=useState(false),[gapTarget,setGapTarget]=useState<{id:string;revision:number}|null>(null);
 const [sourcesOpen,setSourcesOpen]=useState(compact||!!initialDocumentId||initialTrash),[faqScope,setFaqScope]=useState(agentId||'all');
 useEffect(()=>{const timer=setTimeout(()=>setSearchTerm(search.trim()),250);return()=>clearTimeout(timer);},[search]);
 const key=['workspace-knowledge',user,org,'library',trash];
 const q=useQuery({queryKey:key,queryFn:()=>unwrap<KnowledgeLibrary>(apiClient.get(base+'/library',{headers,params:{trash}})),enabled:!!org,refetchInterval:15000,refetchIntervalInBackground:false,retry:false});
 const activeLibrary=useQuery({queryKey:['workspace-knowledge',user,org,'library',false],queryFn:()=>unwrap<KnowledgeLibrary>(apiClient.get(base+'/library',{headers,params:{trash:false}})),enabled:!!org&&trash,refetchInterval:15000,refetchIntervalInBackground:false,retry:false});
 const searched=useQuery({queryKey:[...key,'search',searchTerm],queryFn:()=>unwrap<KnowledgeLibrary>(apiClient.get(base+'/library',{headers,params:{trash,search:searchTerm}})),enabled:!!org&&!!searchTerm,retry:false});
 const categories=q.data?.categories||[],manage=q.data?.canManage===true,canDelete=q.data?.canDelete===true;
 const details=useQuery({queryKey:['workspace-knowledge-item',user,org,selected?.kind,selected?.id,trash],queryFn:()=>unwrap<KnowledgeItem>(apiClient.get(base+'/items/'+selected!.kind+'/'+encodeURIComponent(selected!.id),{headers,params:{trash,search:searchTerm||undefined}})),enabled:!!org&&!!selected,retry:false,refetchInterval:query=>['QUEUED','PROCESSING'].includes(query.state.data?.status||'')?4000:false});
 const capability=useQuery({queryKey:['knowledge-analysis-capability',user,org,analysisTarget?.agentId],queryFn:()=>unwrap<{available:boolean;model:string}>(apiClient.get(base+'/capability',{headers,params:{agentId:analysisTarget?.agentId||undefined}})),enabled:!!org&&!!analysisTarget,retry:false});
 const all=(q.data?.items||[]).filter(n=>(!agentId||!n.agentId||n.agentId===agentId)&&(!compact||n.kind!=='source'||n.sourceKind!=='AGENT'));
 const visible=(searchTerm?searched.data?.items||[]:all).filter(n=>(!agentId||!n.agentId||n.agentId===agentId)&&(!compact||n.kind!=='source'||n.sourceKind!=='AGENT'));
 const totals=(trash?activeLibrary.data?.items||[]:all).filter(n=>(!agentId||!n.agentId||n.agentId===agentId)&&(!compact||n.kind!=='source'||n.sourceKind!=='AGENT'));
 const resetFilter=(fn:()=>void)=>{fn();setPage(1);};
 async function refresh(){
  await Promise.all([qc.invalidateQueries({queryKey:['workspace-knowledge']}),qc.invalidateQueries({queryKey:['workspace-knowledge-item']}),qc.invalidateQueries({queryKey:['agents']}),qc.invalidateQueries({queryKey:['agent-release']}),qc.invalidateQueries({queryKey:['knowledge-preview']}),qc.invalidateQueries({queryKey:['knowledge-health']}),qc.invalidateQueries({queryKey:['knowledge-gaps']}),qc.invalidateQueries({queryKey:['knowledge-records']})]);
 }
 async function run<T>(action:()=>Promise<T>,message?:string,after?:(result:T)=>void){
  if(busy)return;setBusy(true);
  try{const result=await action();setDirty(false);if(message)toast.success(message);after?.(result);await refresh();}
  catch(e){toast.error(e instanceof Error?e.message:'操作未完成，请重试。');}
  finally{setBusy(false);}
 }
 function close(){if(dirty&&!window.confirm('有未保存修改，是否放弃？'))return;setSelected(null);setNewNote(null);setGapTarget(null);setDirty(false);}
 function saveNote(n:KnowledgeItem){const data={title:n.title,...(n.organizable===false?{}:{content:n.content}),agentId:n.agentId,enabled:n.enabled,categoryId:n.categoryId,tags:n.tags,validUntil:n.validUntil||null};void run(()=>gapTarget?unwrap(apiClient.post(base+'/gaps/'+gapTarget.id+'/answer',{...data,gapRevision:gapTarget.revision},{headers})):unwrap(apiClient.put(base+(n.kind==='source'?'/sources/':'/')+encodeURIComponent(n.id),{...data,revision:n.revision,...(n.kind==='source'?{originStamp:n.originStamp}:{})},{headers})),localPreview?'已保存本地知识草稿':'知识已保存',()=>{setSelected(null);setNewNote(null);setGapTarget(null);});}
 function toggleFaq(item:KnowledgeItem){void run(async()=>{
  const n=await unwrap<KnowledgeItem>(apiClient.get(base+'/items/note/'+encodeURIComponent(item.id),{headers}));
  if(n.revision!==item.revision)throw new Error('问答已被其他人修改，请刷新后重试。');
  return unwrap(apiClient.put(base+'/'+encodeURIComponent(n.id),{title:n.title,content:n.content,agentId:n.agentId,enabled:!n.enabled,categoryId:n.categoryId,tags:n.tags,validUntil:n.validUntil||null,revision:n.revision},{headers}));
 },item.enabled?'问答已停用':'问答已启用');}
 function recycle(item:KnowledgeItem){
  setConfirm({title:trash?'恢复此条目':'移入回收站',description:trash?item.title:'“'+item.title+'”可在回收站恢复。',action:async()=>{await run(()=>unwrap(apiClient.post(base+'/items/'+item.kind+'/'+encodeURIComponent(item.id)+'/recycle',{revision:item.revision,restore:trash,...(item.kind==='source'?{originStamp:item.originStamp}:{})},{headers})),trash?'条目已恢复':'已移入回收站',()=>{setSelected(null);setConfirm(null);});}});
 }
 async function startAnalysis(item:KnowledgeItem){
  await run(async()=>{
   let doc=item;
   if(item.kind==='source'){
    const r=await unwrap<{id:string}>(apiClient.post(base+'/sources/snapshot',{id:item.id,contentHash:item.contentHash},{headers}));
    doc=await unwrap<KnowledgeItem>(apiClient.get(base+'/items/document/'+r.id,{headers}));
   }
   if(!['AVAILABLE','NEEDS_REVIEW'].includes(doc.status)){setSelected(doc);return {existing:true};}
   await unwrap(apiClient.post(base+'/documents/'+doc.id+'/analyze',{revision:doc.revision,retry:doc.status==='NEEDS_REVIEW'},{headers}));
   setSelected(doc);return {existing:false};
  },undefined,r=>{setAnalysisTarget(null);toast.success(r.existing?'已打开现有整理结果':'已加入资料整理队列');});
 }
 async function bulk(items:KnowledgeItem[],action:'move'|'recycle'|'restore',categoryId?:string|null):Promise<boolean>{
  if(busy||!manage||!items.length)return false;
  if(action==='recycle'&&!window.confirm('将所选 '+items.length+' 项资料移入回收站？可随时恢复。'))return false;
  setBusy(true);let saved=0;let failed=false;
  try{
   for(const item of items){
    if(item.kind==='source'&&!item.editable)continue;
    const current=await unwrap<KnowledgeItem>(apiClient.get(base+'/items/'+item.kind+'/'+encodeURIComponent(item.id),{headers,params:{trash}}));
    if(current.revision!==item.revision)throw new Error('资料已被其他人修改，请刷新后重试。');
    if(action==='move'){
     if(current.kind==='note'||current.kind==='source')await unwrap(apiClient.put(base+(current.kind==='source'?'/sources/':'/')+encodeURIComponent(current.id),{title:current.title,...(current.organizable===false?{}:{content:current.content}),agentId:current.agentId,enabled:current.enabled,categoryId:categoryId||null,tags:current.tags,validUntil:current.validUntil||null,revision:current.revision,...(current.kind==='source'?{originStamp:current.originStamp}:{})},{headers}));
     else await unwrap(apiClient.put(base+'/documents/'+current.id,{name:current.title,agentId:current.agentId,categoryId:categoryId||null,revision:current.revision},{headers}));
    }else await unwrap(apiClient.post(base+'/items/'+current.kind+'/'+encodeURIComponent(current.id)+'/recycle',{revision:current.revision,restore:action==='restore',...(current.kind==='source'?{originStamp:current.originStamp}:{})},{headers}));
    saved++;
   }
   toast.success(action==='move'?'已调整 '+saved+' 项分类':action==='restore'?'已恢复 '+saved+' 项资料':'已移入回收站 '+saved+' 项');
  }catch(e){failed=true;toast.error((saved?'已完成 '+saved+' 项，':'')+(e instanceof Error?e.message:'操作失败，请刷新后重试。'));}
  finally{await refresh();setBusy(false);}
  return !failed;
 }
 return <div className={compact?'space-y-4':'flex min-h-0 flex-1 flex-col'}>
  {!sourcesOpen&&!compact&&!trash?<KnowledgeFaqView items={visible} all={totals} agents={agents.data||[]} categories={categories} scope={faqScope} category={category} search={search} manage={manage} canDelete={canDelete} busy={busy} loading={q.isPending||!!search.trim()&&(searchTerm!==search.trim()||searched.isPending)} refreshing={q.isFetching} error={q.error?.message||(searchTerm?searched.error?.message:undefined)}
   onScope={setFaqScope} onCategory={setCategory} onSearch={setSearch} onOpen={item=>{setSelected(item);setDirty(false);}} onNew={()=>{setGapTarget(null);setNewNote(freshNote(faqScope==='all'||faqScope==='shared'?undefined:faqScope,category==='all'||category==='uncategorized'?null:category));}} onPreview={()=>setPreviewOpen(true)} onOperations={()=>setOperations(true)} onCategories={()=>setCategoriesOpen(true)} onTrash={()=>{setSourcesOpen(true);setTrash(true);setSearch('');setCategory('all');}} onRefresh={()=>{void q.refetch();if(searchTerm)void searched.refetch();}} onToggle={toggleFaq} onRecycle={recycle}/>:<>
  {!compact&&<div className="mb-3 flex items-center gap-3 text-sm"><Button variant="ghost" size="sm" onClick={()=>{setSourcesOpen(false);setTrash(false);setCategory('all');setSearch('');}}>返回问答知识库</Button><span className="text-muted-foreground">资料来源与整理</span></div>}
  <KnowledgeLibraryView compact={compact} title={title} agentId={agentId} categories={categories} all={totals} items={visible} agents={agents.data||[]} category={category} trash={trash} search={search} manage={manage} canDelete={canDelete} busy={busy} loading={q.isPending||!!search.trim()&&(searchTerm!==search.trim()||searched.isPending)} refreshing={q.isFetching} error={q.error?.message||(searchTerm?searched.error?.message:undefined)}
   onCategory={(id,nextTrash=false)=>resetFilter(()=>{setCategory(id);setTrash(nextTrash);})} onSearch={setSearch} onOpen={item=>{setSelected(item);setDirty(false);}} onUpload={()=>setUpload(true)} onRecording={()=>setRecordingUpload(true)} onNew={()=>{setGapTarget(null);setNewNote(freshNote(agentId,category==='all'||category==='uncategorized'?null:category));}} onCategories={()=>setCategoriesOpen(true)} onRefresh={()=>{void q.refetch();if(searchTerm)void searched.refetch();}} onPreview={()=>setPreviewOpen(true)} onOperations={()=>setOperations(true)} onBulk={bulk}/>
  </>}
  <KnowledgeSearchPreview key={org+':'+user+':'+agentId} open={previewOpen} org={org} user={user} agentId={agentId} agents={agents.data||[]} onClose={()=>setPreviewOpen(false)} onOpen={item=>{setSelected(item);setDirty(false);}}/>
  {operations&&manage&&<KnowledgeOperations org={org} user={user} onManageSources={()=>{setOperations(false);setSourcesOpen(true);setTrash(false);setCategory('all');setSearch('');}} onClose={()=>{setOperations(false);void refresh();}} onOpen={item=>{setSelected(item);setDirty(false);}} onNew={(question,scope,gapId,revision)=>{setGapTarget({id:gapId,revision});setNewNote({...freshNote(scope||undefined),title:question.slice(0,100)});}}/>}
  {recordingUpload&&manage&&<KnowledgeRecordingUpload org={org} user={user} agents={agents.data||[]} categories={categories} initialAgentId={agentId} categoryId={category==='all'||category==='uncategorized'?null:category} onClose={()=>{setRecordingUpload(false);void refresh();}} onSaved={item=>{setRecordingUpload(false);setSelected(item);void refresh();}}/>}
  <Dialog open={!!newNote||selected?.kind==='note'} onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}><DialogHeader><DialogTitle>{newNote?'新建问答':manage&&!trash?'编辑问答':'查看问答'}</DialogTitle><DialogDescription className="sr-only">标准问题、相似问法和标准答案</DialogDescription></DialogHeader>
   {newNote?<KnowledgeFaqEditor key="new" item={newNote} categories={categories} agents={agents.data||[]} canEdit={manage} busy={busy} onSave={saveNote} onDirty={setDirty} onCancel={close}/>:details.isPending?<p role="status" className="py-10 text-center text-sm text-muted-foreground">正在读取问答…</p>:details.error?<div role="alert"><p className="text-sm text-destructive">{details.error.message}</p><Button variant="outline" size="sm" onClick={()=>void details.refetch()}>重新加载</Button></div>:details.data?.kind==='note'&&<KnowledgeFaqEditor key={details.data.id+':'+details.data.revision} item={details.data} categories={categories} agents={agents.data||[]} canEdit={manage&&!trash} busy={busy} onSave={saveNote} onDirty={setDirty} onCancel={close}>
    {!localPreview&&manage&&!trash&&<details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">修改历史</summary><div className="mt-3"><KnowledgeVersions org={org} user={user} item={details.data} disabled={busy||dirty} onRestored={refresh}/></div></details>}
    {(trash?manage:canDelete)&&<Button type="button" variant="ghost" size="sm" disabled={busy} className={trash?'':'text-destructive'} onClick={()=>recycle(details.data!)}>{trash?<RotateCcw className="size-4"/>:<Trash2 className="size-4"/>}{trash?'恢复问答':'移入回收站'}</Button>}
   </KnowledgeFaqEditor>}
  </DialogContent></Dialog>
  <Sheet open={!!selected&&selected.kind!=='note'} onOpenChange={open=>{if(!open&&!busy)close();}}>
   <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
    <SheetHeader className="border-b p-5"><SheetTitle>{newNote?'新增知识':details.data?.title||selected?.title}</SheetTitle><SheetDescription>{newNote?'业务知识':selected?.kind==='source'?'现有资料':knowledgeStatus[details.data?.status||selected?.status||'']}</SheetDescription></SheetHeader>
    <div className="space-y-5 p-5">
     {newNote?<NoteEditor item={newNote} categories={categories} agents={agents.data||[]} canEdit busy={busy} onSave={saveNote} onDirty={setDirty}/>:details.isPending?<p className="text-sm text-muted-foreground">正在读取内容…</p>:details.error?<div role="alert"><p className="text-sm text-destructive">{details.error.message}</p><Button variant="outline" size="sm" onClick={()=>void details.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>:details.data&&<>
      {details.data.upstreamChanged&&<p role="alert" className="rounded-md border border-amber-200 p-3 text-sm text-amber-800">原资料已更新，当前显示最新内容。保存前请重新核对。</p>}
      {details.data.kind==='note'?<NoteEditor key={details.data.id+':'+details.data.revision} item={details.data} categories={categories} agents={agents.data||[]} canEdit={manage&&!trash} busy={busy} onSave={saveNote} onDirty={setDirty}/>:details.data.kind==='source'?<>
       <div className="flex flex-wrap gap-2">{details.data.sourceLink&&<Button asChild variant="outline" size="sm"><Link href={details.data.sourceLink}>打开原资料</Link></Button>}{manage&&details.data.organizable!==false&&<Button size="sm" onClick={()=>setAnalysisTarget(details.data!)}><Sparkles className="size-4"/>AI 整理</Button>}</div>
       {details.data.editable?<NoteEditor key={details.data.id+':'+details.data.revision} item={details.data} categories={categories} agents={agents.data||[]} canEdit={manage&&!trash} busy={busy} onSave={saveNote} onDirty={setDirty}/>:<p className="whitespace-pre-wrap text-sm leading-7">{details.data.content}</p>}
      </>:<DocumentView key={details.data.id+':'+details.data.status} item={details.data} categories={categories} agents={agents.data||[]} busy={busy||trash} onDirty={setDirty} onSave={v=>void run(()=>unwrap(apiClient.put(base+'/documents/'+v.id,{name:v.title,agentId:v.agentId,categoryId:v.categoryId,revision:v.revision},{headers})),localPreview?'已保存本地资料草稿':'资料设置已保存',()=>setSelected(null))} onAnalyze={()=>setAnalysisTarget(details.data!)} onReview={entries=>void run(()=>unwrap<{inserted:number;duplicates:number}>(apiClient.post(base+'/documents/'+details.data!.id+'/review',{revision:details.data!.revision,entries},{headers})),undefined,r=>{toast.success('已入库 '+r.inserted+' 条，跳过重复 '+r.duplicates+' 条');})}/>}
      {details.data.kind==='note'&&!localPreview&&manage&&!trash&&<KnowledgeVersions org={org} user={user} item={details.data} disabled={busy||dirty} onRestored={refresh}/>}
      {(details.data.kind!=='source'||details.data.editable)&&(trash?manage:canDelete)&&<div className="border-t pt-4"><Button size="sm" variant="ghost" disabled={busy||['QUEUED','PROCESSING'].includes(details.data.status)} className={trash?'':'text-destructive'} onClick={()=>recycle(details.data!)}>{trash?<RotateCcw className="size-4"/>:<Trash2 className="size-4"/>}{trash?'恢复条目':'移入回收站'}</Button></div>}
     </>}
    </div>
   </SheetContent>
  </Sheet>
  <UploadKnowledge open={upload} org={org} categories={categories} agents={agents.data||[]} agentId={agentId} categoryId={category==='all'||category==='uncategorized'?null:category} onClose={()=>setUpload(false)} onSaved={item=>{setUpload(false);setSelected(item);void refresh();}}/>
  <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>管理分类</DialogTitle><DialogDescription className="sr-only">新增、重命名或删除知识分类</DialogDescription></DialogHeader>
   <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void run(()=>unwrap(apiClient.put(base+'/categories/'+categoryEdit.id,{name:categoryEdit.name},{headers})),'分类已保存',()=>setCategoryEdit({id:'new',name:''}));}}><Input aria-label="分类名称" placeholder="分类名称" required maxLength={30} value={categoryEdit.name} onChange={e=>setCategoryEdit({...categoryEdit,name:e.target.value})}/><Button disabled={busy||!categoryEdit.name.trim()}><FolderPlus className="size-4"/>{categoryEdit.id==='new'?'新增':'保存'}</Button></form>
   <div className="max-h-80 divide-y overflow-auto">{categories.map(c=><div key={c.id} className="flex items-center gap-2 py-3 text-sm"><Folder className="size-4 text-primary/60"/><span className="flex-1">{c.name}</span><Button variant="ghost" size="sm" onClick={()=>setCategoryEdit(c)}>重命名</Button>{canDelete&&<Button variant="ghost" size="icon" aria-label={'删除分类'+c.name} className="size-8 text-destructive" onClick={()=>setConfirm({title:'删除分类',description:'资料保留并移到“未分类”。',action:async()=>{await run(()=>unwrap(apiClient.delete(base+'/categories/'+c.id,{headers})),'分类已删除',()=>{setCategory('all');setConfirm(null);});}})}><Trash2 className="size-3.5"/></Button>}</div>)}</div>
  </DialogContent></Dialog>
  <Dialog open={!!confirm} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}}><DialogContent><DialogHeader><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setConfirm(null)}>取消</Button><Button disabled={busy} onClick={()=>void confirm?.action()}>{busy?'处理中…':'确定'}</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={!!analysisTarget} onOpenChange={open=>{if(!open&&!busy)setAnalysisTarget(null);}}><DialogContent><DialogHeader><DialogTitle>AI 整理资料</DialogTitle><DialogDescription>{analysisTarget?.title}</DialogDescription></DialogHeader>
   <div className="space-y-3 text-sm"><p>清洗重复与无效内容，提取分类、关键词和有原文依据的知识，完成后审核入库。</p><p className="text-muted-foreground">使用{capability.data?.model||'已授权文字模型'}，消耗计入平台模型用量。</p>{analysisTarget?.status==='NEEDS_REVIEW'&&<p className="text-amber-800">本次为手动重新提交，可能再次产生模型用量。</p>}{capability.data?.available===false&&<p role="alert" className="text-destructive">请先配置用于资料整理的文字模型。</p>}{capability.error&&<p role="alert" className="text-destructive">{capability.error.message}</p>}</div>
   <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setAnalysisTarget(null)}>取消</Button><Button disabled={busy||!capability.data?.available} onClick={()=>analysisTarget&&void startAnalysis(analysisTarget)}>{busy?'提交中…':'开始整理'}</Button></DialogFooter>
  </DialogContent></Dialog>
 </div>;
}

function UploadKnowledge({open,org,categories,agents,agentId,categoryId,onClose,onSaved}:{open:boolean;org:string;categories:KnowledgeCategory[];agents:AgentOption[];agentId?:string;categoryId:string|null;onClose:()=>void;onSaved:(item:KnowledgeItem)=>void}){
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 return <Sheet open={open} onOpenChange={next=>{if(!next&&!busy){if(dirty&&!window.confirm('资料尚未保存，是否放弃？'))return;setDirty(false);onClose();}}}><SheetContent className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>上传资料</SheetTitle><SheetDescription>PDF、Word、Excel 或文本</SheetDescription></SheetHeader>{open&&<UploadForm key={org} org={org} categories={categories} agents={agents} agentId={agentId} categoryId={categoryId} onSaved={item=>{setDirty(false);onSaved(item);}} onBusy={setBusy} onDirty={setDirty}/>}</SheetContent></Sheet>;
}
function UploadForm({org,categories,agents,agentId,categoryId,onSaved,onBusy,onDirty}:{org:string;categories:KnowledgeCategory[];agents:AgentOption[];agentId?:string;categoryId:string|null;onSaved:(item:KnowledgeItem)=>void;onBusy:(v:boolean)=>void;onDirty:(v:boolean)=>void}){
 const input=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File|null>(null),[textMode,setTextMode]=useState(false),[name,setName]=useState(''),[content,setContent]=useState(''),[fields,setFields]=useState<Fields>({agentId:agentId||null,categoryId}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  if(busy)return;setBusy(true);onBusy(true);setError('');
  try{
   if(file&&file.size>8*1024*1024)throw new Error('文件最大8MB。');
   const headers={'x-workspace-id':org};
   const r=!textMode&&file?await unwrap<{id:string;duplicate:boolean}>(apiClient.post(base+'/upload',file,{headers:{...headers,'Content-Type':'application/octet-stream'},params:{name:file.name,agentId:fields.agentId||undefined,categoryId:fields.categoryId||undefined},timeout:45000})):await unwrap<{id:string;duplicate:boolean}>(apiClient.post(base+'/documents',{name,content,...fields},{headers}));
   const item=await unwrap<KnowledgeItem>(apiClient.get(base+'/items/document/'+r.id,{headers}));
   toast.success(r.duplicate?'相同资料已存在，已打开':'资料已保存');onSaved(item);
  }catch(e){setError(e instanceof Error?e.message:'资料上传未完成。');}
  finally{setBusy(false);onBusy(false);}
 }
 return <form className="space-y-5 p-5" onSubmit={e=>{e.preventDefault();void submit();}}>
  <div className="flex gap-2" role="group" aria-label="资料导入方式"><Button type="button" size="sm" variant={!textMode?'default':'outline'} disabled={busy} onClick={()=>setTextMode(false)}>上传文件</Button><Button type="button" size="sm" variant={textMode?'default':'outline'} disabled={busy} onClick={()=>setTextMode(true)}>粘贴正文</Button></div>
  <fieldset disabled={busy} className="space-y-5">
   {!textMode?<><input ref={input} type="file" className="sr-only" aria-label="选择资料文件" accept=".pdf,.docx,.xlsx,.txt,.md,.csv" onChange={e=>{const selected=e.target.files?.[0];if(selected){setFile(selected);onDirty(true);setName(selected.name.replace(/\.[^.]+$/,''));setError('');}e.target.value='';}}/><button type="button" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';}} onDrop={e=>{e.preventDefault();if(busy)return;if(e.dataTransfer.files.length!==1){setError('请每次选择一份资料。');return;}const next=e.dataTransfer.files[0];if(next){setFile(next);setName(next.name.replace(/\.[^.]+$/,''));onDirty(true);setError('');}}} onClick={()=>input.current?.click()} className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"><Upload className="size-7 text-primary"/><span className="max-w-full truncate text-sm font-medium">{file?file.name:'点击上传资料，或拖入文件'}</span><span className="text-xs text-muted-foreground">{file?(file.size/1024).toFixed(0)+' KB':'PDF / DOCX / XLSX / TXT / MD / CSV，最大8MB'}</span></button><Button type="button" variant="ghost" size="sm" onClick={knowledgeTemplate}>下载 Excel 模板</Button></>:<><label className="grid gap-2 text-sm">资料名称<Input required maxLength={160} value={name} onChange={e=>{setName(e.target.value);onDirty(true);}}/></label><label className="grid gap-2 text-sm">资料正文<Textarea required rows={12} maxLength={60000} value={content} onChange={e=>{setContent(e.target.value);onDirty(true);}}/></label></>}
   <ScopeFields value={fields} onChange={v=>{setFields(v);onDirty(true);}} categories={categories} agents={agents}/>
  </fieldset>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <div className="flex justify-end border-t pt-4"><Button disabled={busy||(textMode?!name.trim()||!content.trim():!file)}>{busy?<><Loader2 className="size-4 animate-spin"/>正在保存…</>:'保存资料'}</Button></div>
 </form>;
}
