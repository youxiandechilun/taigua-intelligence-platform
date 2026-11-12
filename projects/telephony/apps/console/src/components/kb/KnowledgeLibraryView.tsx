/*
 * 中文导读：知识库的 KnowledgeLibraryView 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import {useEffect,useMemo,useState} from 'react';
import {BookOpen,Building2,Layers3,MessagesSquare,Handshake,Headphones,Folder,FileText,FileAudio,Plus,Upload,Search,SlidersHorizontal,Trash2,RotateCcw,ChevronLeft,ChevronRight,ChevronDown,ArrowDownWideNarrow,List,Grid2X2,CheckCircle2,Clock3,Bot,RefreshCw,Loader2,X,CheckCheck,Pencil,Eye} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {knowledgeDate,knowledgeStatus,type KnowledgeCategory,type KnowledgeItem} from './knowledge-types';
import styles from './knowledge-library.module.css';

type Agent={agentId:string;name:string};
type Props={
 compact:boolean;title:string;agentId?:string;categories:KnowledgeCategory[];all:KnowledgeItem[];items:KnowledgeItem[];agents:Agent[];
 category:string;trash:boolean;search:string;manage:boolean;canDelete:boolean;busy:boolean;loading:boolean;refreshing:boolean;error?:string;
 onCategory:(id:string,trash?:boolean)=>void;onSearch:(v:string)=>void;onOpen:(item:KnowledgeItem)=>void;onUpload:()=>void;onRecording:()=>void;onNew:()=>void;onCategories:()=>void;onRefresh:()=>void;onPreview:()=>void;onOperations:()=>void;
 onBulk:(items:KnowledgeItem[],action:'move'|'recycle'|'restore',categoryId?:string|null)=>Promise<boolean>;
};
const themes=[{match:/公司|企业|业务/,Icon:Building2,color:'blue'},{match:/产品|服务/,Icon:Layers3,color:'violet'},{match:/合作|条件/,Icon:Handshake,color:'green'},{match:/问答|问题/,Icon:MessagesSquare,color:'orange'},{match:/异议|拒绝/,Icon:Headphones,color:'red'}];
export function categoryTheme(name:string){return themes.find(t=>t.match.test(name))||{Icon:Folder,color:'cyan'};}
const recording=(item:KnowledgeItem)=>item.sourceKind==='RECORDING';
const typeName=(item:KnowledgeItem)=>recording(item)?'录音资料':item.kind==='note'?'业务知识':item.kind==='source'?'现有资料':'资料文档';
const itemKey=(item:KnowledgeItem)=>item.kind+':'+item.id;
const editable=(item:KnowledgeItem)=>(item.kind!=='source'||item.editable===true)&&!['QUEUED','PROCESSING'].includes(item.status);

export function KnowledgeLibraryView(p:Props){
 const [tab,setTab]=useState('all'),[status,setStatus]=useState('all'),[scope,setScope]=useState('all'),[ascending,setAscending]=useState(false),[view,setView]=useState('list');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[selection,setSelection]=useState<string[]>([]),[uploadMenu,setUploadMenu]=useState(false);
 useEffect(()=>{setPage(1);setSelection([]);},[p.category,p.trash,p.search,tab,status,scope,pageSize]);
 const agentNames=useMemo(()=>new Map(p.agents.map(a=>[a.agentId,a.name])),[p.agents]);
 const categories=useMemo(()=>new Map(p.categories.map(c=>[c.id,c])),[p.categories]);
 const filtered=useMemo(()=>p.items.filter(n=>
  (p.category==='all'||p.category==='uncategorized'&&!n.categoryId||n.categoryId===p.category)&&
  (scope==='all'||scope==='shared'&&!n.agentId||n.agentId===scope)&&
  (status==='all'||n.status===status)&&
  (tab==='all'||tab==='question'&&n.kind==='note'||tab==='document'&&!recording(n)&&n.kind!=='note'||tab==='recording'&&recording(n)||tab==='review'&&n.status==='REVIEW')
 ).sort((a,b)=>{const t=(Date.parse(a.updatedAt||'')||0)-(Date.parse(b.updatedAt||'')||0);return (ascending?1:-1)*t||itemKey(a).localeCompare(itemKey(b));}),[p.items,p.category,scope,status,tab,ascending]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)),current=Math.min(page,totalPages),rows=filtered.slice((current-1)*pageSize,current*pageSize);
 const currentName=p.trash?'回收站':p.category==='all'?'全部内容':p.category==='uncategorized'?'未分类':categories.get(p.category)?.name||'全部内容';
 const selectable=rows.filter(editable),selected=filtered.filter(n=>selection.includes(itemKey(n))),allSelected=selectable.length>0&&selectable.every(n=>selection.includes(itemKey(n)));
 const count=(id:string)=>p.all.filter(n=>id==='all'||id==='uncategorized'&&!n.categoryId||n.categoryId===id).length;
 const toggle=(n:KnowledgeItem)=>setSelection(v=>v.includes(itemKey(n))?v.filter(id=>id!==itemKey(n)):[...v,itemKey(n)]);
 const move=async(action:'move'|'recycle'|'restore',categoryId?:string|null)=>{if(await p.onBulk(selected,action,categoryId))setSelection([]);};
 function categoryButton(id:string,name:string){const {Icon,color}=categoryTheme(name);return <button type="button" key={id} aria-current={!p.trash&&p.category===id?'true':undefined} className={styles.categoryItem} onClick={()=>p.onCategory(id)}><span data-color={color} className={styles.categoryIcon}>{id==='all'?<BookOpen size={17}/>:<Icon size={16}/>}</span><span>{name}</span><em>{count(id)}</em></button>;}
 function open(n:KnowledgeItem){p.onOpen(n);}
 function itemAction(n:KnowledgeItem){
  const review=p.manage&&!p.trash&&n.status==='REVIEW';
  const edit=p.manage&&editable(n)&&!p.trash;
  const label=review?'审核':edit?'编辑':'查看';
  const Icon=review?CheckCircle2:edit?Pencil:Eye;
  return <Button type="button" size="sm" variant="ghost" className={styles.itemAction} aria-label={label+'：'+n.title} onClick={()=>open(n)}><Icon aria-hidden="true" className="size-3.5"/>{label}</Button>;
 }
 function statusBadge(n:KnowledgeItem){return <span className={styles.status} data-status={n.status}><i/>{knowledgeStatus[n.status]||'待确认'}</span>;}
 function nameCell(n:KnowledgeItem){const Icon=recording(n)?FileAudio:n.kind==='note'?MessagesSquare:FileText;return <button type="button" className={styles.documentName} onClick={()=>open(n)}><span className={styles.fileIcon} data-kind={recording(n)?'recording':n.kind}><Icon size={20}/></span><span><strong title={n.title}>{n.title}</strong><span className={styles.documentMeta}>{typeName(n)}{n.tags.length>0&&' · '+n.tags.slice(0,2).join(' / ')}</span></span></button>;}
 return <section className={styles.root+' '+(p.compact?styles.compact:'')} aria-label="企业知识库">
  <header className={styles.heading}><div className={styles.title}>{p.compact?<h2>{p.title}</h2>:<h1>资料来源</h1>}</div><div className={styles.actions}>
   {p.manage&&<Button variant="outline" onClick={p.onOperations}><SlidersHorizontal className="size-4"/>知识管理</Button>}<Button variant="outline" onClick={p.onPreview}><Search className="size-4"/><span>检索预览</span></Button>
   {p.manage&&<><Button variant="outline" onClick={p.onNew}><Plus className="size-4"/>新建问答</Button><div className={styles.uploadSplit}><Button onClick={p.onUpload}><Upload className="size-4"/>上传资料</Button><Button aria-label="选择上传类型" aria-expanded={uploadMenu} onClick={()=>setUploadMenu(!uploadMenu)}><ChevronDown className="size-4"/></Button>{uploadMenu&&<><button type="button" className={styles.backdrop} aria-label="关闭上传菜单" onClick={()=>setUploadMenu(false)}/><div className={styles.uploadMenu}><button onClick={()=>{setUploadMenu(false);p.onUpload();}}><FileText size={16}/>上传文档</button><button onClick={()=>{setUploadMenu(false);p.onRecording();}}><FileAudio size={16}/>上传录音</button></div></>}</div></>}
  </div></header>
  {!p.compact&&<div className={styles.overview}><span><BookOpen size={16}/><b>{p.all.length}</b>全部资料</span><i/><span><CheckCircle2 size={16}/><b>{p.all.filter(n=>n.kind==='note'&&n.status==='ENABLED').length}</b>已启用知识</span>{p.manage&&<><i/><button onClick={()=>{p.onCategory('all');setTab('review');}}><Clock3 size={16}/><b>{p.all.filter(n=>n.status==='REVIEW').length}</b>待审核</button><i/><span><FileAudio size={16}/><b>{p.all.filter(recording).length}</b>录音资料</span></>}<Button size="icon" variant="ghost" aria-label="刷新知识库" disabled={p.refreshing||p.busy} onClick={p.onRefresh}><RefreshCw className={'size-4 '+(p.refreshing?'animate-spin':'')}/></Button></div>}
  <div className={styles.layout}>
   {!p.compact&&<aside className={styles.categoryPanel} aria-label="知识分类"><div className={styles.categoryHeading}><strong>资料目录</strong></div>{categoryButton('all','全部内容')}<div className={styles.categorySubheading}><span>业务分类</span>{p.manage&&<button type="button" aria-label="添加分类" onClick={p.onCategories}><Plus size={15}/></button>}</div><div className={styles.categoryList}>{p.categories.map(c=>categoryButton(c.id,c.name))}{categoryButton('uncategorized','未分类')}</div>{p.manage&&<div className={styles.categoryFoot}><button type="button" aria-current={p.trash?'true':undefined} onClick={()=>p.onCategory('all',true)}><Trash2 size={16}/>回收站</button></div>}</aside>}
   <div className={styles.library}>
    <div className={styles.libraryHeader}>
    <div className={styles.tabs} role="tablist" aria-label="资料类型">{([['all','全部资料',BookOpen],['document','文档',FileText],['question','问答',MessagesSquare],['recording','录音',FileAudio],...(p.manage?[['review','待审核',Clock3] as const]:[])] as const).map(([id,label,Icon])=><button role="tab" aria-selected={tab===id} key={id} onClick={()=>setTab(id)}><Icon size={15}/>{label}{id==='review'&&<em>{p.all.filter(n=>n.status==='REVIEW').length}</em>}</button>)}</div>
     <div className={styles.viewSwitch}><button aria-label="列表视图" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={16}/></button><button aria-label="卡片视图" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><Grid2X2 size={15}/></button></div>
    </div>
    <div className={styles.filters}><label className={styles.search}><Search size={16}/><input aria-label="搜索知识资料" placeholder="搜索标题、正文或关键词" maxLength={100} value={p.search} onChange={e=>p.onSearch(e.target.value)}/>{p.search&&<button aria-label="清空搜索" onClick={()=>p.onSearch('')}><X size={14}/></button>}</label>{p.compact&&<NativeSelect aria-label="按业务分类筛选" value={p.category} onChange={e=>p.onCategory(e.target.value)}><option value="all">全部分类</option>{p.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="uncategorized">未分类</option></NativeSelect>}<NativeSelect aria-label="按状态筛选" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option>{Object.entries(knowledgeStatus).map(([id,label])=><option key={id} value={id}>{label}</option>)}</NativeSelect>{!p.agentId&&<NativeSelect aria-label="按数字员工筛选" value={scope} onChange={e=>setScope(e.target.value)}><option value="all">全部数字员工</option><option value="shared">企业共享</option>{p.agents.map(a=><option key={a.agentId} value={a.agentId}>{a.name}</option>)}</NativeSelect>}<button className={styles.sort} title="切换时间排序" aria-label={ascending?'按更新时间从新到旧':'按更新时间从旧到新'} onClick={()=>setAscending(!ascending)}><ArrowDownWideNarrow size={18}/></button></div>
    {selected.length>0&&p.manage&&<div className={styles.bulk} aria-live="polite"><span><CheckCheck size={16}/>已选 {selected.length} 项</span>{p.trash?<button disabled={p.busy} onClick={()=>void move('restore')}><RotateCcw size={14}/>恢复资料</button>:<><NativeSelect aria-label="批量移动分类" disabled={p.busy} value="" onChange={e=>{if(e.target.value)void move('move',e.target.value==='uncategorized'?null:e.target.value);}}><option value="">移动到分类</option><option value="uncategorized">未分类</option>{p.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>{p.canDelete&&<button disabled={p.busy} onClick={()=>void move('recycle')}><Trash2 size={14}/>移入回收站</button>}</>}<button disabled={p.busy} onClick={()=>setSelection([])}>取消选择</button></div>}
    {p.error?<div className={styles.empty} role="alert"><BookOpen size={34}/><h3>资料暂时无法加载</h3><p>{p.error}</p><Button variant="outline" onClick={p.onRefresh}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>:p.loading?<div className={styles.empty} role="status"><Loader2 size={28} className="animate-spin"/><p>正在读取资料</p></div>:!rows.length?<div className={styles.empty}><Folder size={42} strokeWidth={1.2}/><h3>{p.search?'未找到相关资料':p.trash?'回收站为空':'这个分类还没有资料'}</h3>{p.search?<Button variant="outline" onClick={()=>{p.onSearch('');setTab('all');setStatus('all');setScope('all');}}>清除筛选</Button>:p.manage&&!p.trash&&<Button variant="outline" onClick={p.onUpload}><Upload className="size-4"/>上传资料</Button>}</div>:view==='list'?<div className={styles.tableScroll} role="region" aria-label={currentName+'资料列表'} tabIndex={0}><table><thead><tr>{p.manage&&<th className={styles.checkColumn}><input type="checkbox" aria-label="选择本页可编辑资料" checked={allSelected} disabled={p.busy||!selectable.length} onChange={()=>setSelection(v=>allSelected?v.filter(id=>!selectable.some(n=>itemKey(n)===id)):[...new Set([...v,...selectable.map(itemKey)])])}/></th>}<th className={styles.nameColumn}>资料名称</th><th className={styles.categoryColumn}>分类</th><th className={styles.scopeColumn}>适用数字员工</th><th className={styles.statusColumn}>状态</th><th className={styles.dateColumn}>更新时间</th><th className={styles.operationColumn}>操作</th></tr></thead><tbody>{rows.map(n=>{const c=categories.get(n.categoryId||'');return <tr key={itemKey(n)} data-selected={selection.includes(itemKey(n))}>{p.manage&&<td><input type="checkbox" aria-label={'选择'+n.title} checked={selection.includes(itemKey(n))} disabled={p.busy||!editable(n)} title={!editable(n)?'资料整理中或当前资料只读':undefined} onChange={()=>toggle(n)}/></td>}<td>{nameCell(n)}</td><td className={styles.categoryColumn}><span className={styles.categoryChip} data-color={categoryTheme(c?.name||'').color}>{c?.name||'未分类'}</span></td><td className={styles.scopeColumn}><span className={styles.scope}>{n.agentId?<Bot size={13}/>:<Building2 size={13}/>}<span>{n.agentId?agentNames.get(n.agentId)||'指定数字员工':'企业共享'}</span></span></td><td>{statusBadge(n)}</td><td className={styles.dateColumn}><time>{knowledgeDate(n.updatedAt)}</time></td><td>{itemAction(n)}</td></tr>;})}</tbody></table></div>:<div className={styles.grid}>{rows.map(n=><article key={itemKey(n)} className={styles.card}><div className={styles.cardTop}>{statusBadge(n)}{p.manage&&editable(n)&&<input type="checkbox" aria-label={'选择'+n.title} disabled={p.busy} checked={selection.includes(itemKey(n))} onChange={()=>toggle(n)}/>}</div>{nameCell(n)}<p>{n.preview||'查看完整资料'}</p><footer><span>{categories.get(n.categoryId||'')?.name||'未分类'}</span>{itemAction(n)}</footer></article>)}</div>}
    <footer className={styles.pagination}><span title={currentName}>{currentName} · 共 {filtered.length} 项</span><label>每页<NativeSelect aria-label="每页显示条数" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>{[10,20,50].map(n=><option key={n} value={n}>{n} 条</option>)}</NativeSelect></label><div className={styles.pageButtons}><button aria-label="上一页" disabled={current<=1||p.loading} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button>{Array.from({length:Math.min(totalPages,5)},(_,i)=>{const start=Math.max(1,Math.min(current-2,totalPages-4));const n=start+i;return <button key={n} aria-label={'第'+n+'页'} aria-current={n===current?'page':undefined} disabled={p.loading} onClick={()=>setPage(n)}>{n}</button>;})}<button aria-label="下一页" disabled={current>=totalPages||p.loading} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></div><span>{current} / {totalPages} 页</span></footer>
   </div>
  </div>
 </section>;
}
