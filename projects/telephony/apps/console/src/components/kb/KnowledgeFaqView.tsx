/*
 * 中文导读：知识库的 KnowledgeFaqView 组件，封装该界面的展示与交互。
 */
"use client";

import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,Search,Settings2,Trash2,RefreshCw} from 'lucide-react';
import {Button} from '@/src/components/ui/button';
import {NativeSelect} from '@/src/components/ui/native-select';
import {faqPreview} from './knowledge-faq';
import {knowledgeDate,knowledgeStatus,type KnowledgeCategory,type KnowledgeItem} from './knowledge-types';
import styles from './knowledge-faq.module.css';

type Props={items:KnowledgeItem[];all:KnowledgeItem[];agents:{agentId:string;name:string}[];categories:KnowledgeCategory[];scope:string;category:string;search:string;manage:boolean;canDelete:boolean;busy:boolean;loading:boolean;refreshing:boolean;error?:string;onScope:(id:string)=>void;onCategory:(id:string)=>void;onSearch:(text:string)=>void;onOpen:(item:KnowledgeItem)=>void;onNew:()=>void;onPreview:()=>void;onOperations:()=>void;onCategories:()=>void;onTrash:()=>void;onRefresh:()=>void;onToggle:(item:KnowledgeItem)=>void;onRecycle:(item:KnowledgeItem)=>void};

export function KnowledgeFaqView(p:Props) {
 const [status,setStatus]=useState('all'),[page,setPage]=useState(1),[size,setSize]=useState(10);
 useEffect(()=>setPage(1),[p.scope,p.category,p.search,status,size]);
 const notes=p.all.filter(n=>n.kind==='note');
 const scoped=(n:KnowledgeItem)=>p.scope==='all'||p.scope==='shared'&&!n.agentId||n.agentId===p.scope;
 const rows=p.items.filter(n=>n.kind==='note'&&scoped(n)&&(p.category==='all'||p.category==='uncategorized'&&!n.categoryId||n.categoryId===p.category)&&(status==='all'||n.status===status)).sort((a,b)=>(Date.parse(b.updatedAt||'')||0)-(Date.parse(a.updatedAt||'')||0)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),visible=rows.slice((current-1)*size,current*size);
 const scopes=[{id:'all',name:'全部问答'},{id:'shared',name:'企业共享'},...p.agents.map(a=>({id:a.agentId,name:a.name})),...Array.from(new Set(notes.map(n=>n.agentId).filter((id):id is string=>!!id&&!p.agents.some(a=>a.agentId===id)))).map(id=>({id,name:'已关联数字员工'}))];
 const name=scopes.find(s=>s.id===p.scope)?.name||'全部问答';
 const categoryNames=new Map(p.categories.map(c=>[c.id,c.name]));
 return <section className={styles.root} aria-label="问答知识库">
  <header className={styles.heading}><h1>知识库</h1><div className={styles.actions}>{p.manage&&<Button variant="outline" onClick={p.onOperations}>导入导出与管理</Button>}<Button variant="outline" onClick={p.onPreview}><Search className="size-4"/>试问</Button>{p.manage&&<Button disabled={p.busy} onClick={p.onNew}><Plus className="size-4"/>新建问答</Button>}</div></header>
  <div className={styles.layout}>
   <aside className={styles.sidebar} aria-label="业务知识库"><div className={styles.sidebarHeading}>业务知识库</div><div className={styles.scopes}>{scopes.map(s=><button key={s.id} type="button" aria-current={p.scope===s.id?'true':undefined} className={styles.scope} onClick={()=>p.onScope(s.id)}><span>{s.name}</span><span>{notes.filter(n=>s.id==='all'||s.id==='shared'&&!n.agentId||n.agentId===s.id).length}</span></button>)}</div><div className={styles.sideFoot}>{p.manage&&<><button type="button" onClick={p.onCategories}><Settings2 size={15}/>管理分类</button><button type="button" onClick={p.onTrash}><Trash2 size={15}/>回收站</button></>}</div></aside>
   <div className={styles.main}>
    <div className={styles.listHeading}><div className={styles.listTitle}><h2>{name}</h2><span>{rows.length} 条</span></div>
     <div className={styles.filters}><label className={styles.search}><Search size={16}/><input aria-label="搜索问答" placeholder="搜索问题或答案" maxLength={100} value={p.search} onChange={e=>p.onSearch(e.target.value)}/></label><NativeSelect aria-label="问答分类" value={p.category} onChange={e=>p.onCategory(e.target.value)}><option value="all">全部分类</option>{p.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="uncategorized">未分类</option></NativeSelect><NativeSelect aria-label="问答状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="ENABLED">已启用</option><option value="DISABLED">已停用</option><option value="EXPIRED">已过期</option></NativeSelect><Button size="icon-sm" variant="ghost" aria-label="刷新问答知识库" disabled={p.refreshing||p.busy} onClick={p.onRefresh}><RefreshCw className={'size-4 '+(p.refreshing?'animate-spin':'')}/></Button></div>
    </div>
    {p.error?<div className={styles.empty} role="alert"><strong>问答暂时无法加载</strong><p>{p.error}</p><Button variant="outline" onClick={p.onRefresh}>重新加载</Button></div>:p.loading?<div className={styles.empty} role="status">正在读取问答…</div>:!rows.length?<div className={styles.empty}><strong>{p.search||status!=='all'||p.category!=='all'?'未找到符合条件的问答':'还没有问答'}</strong><p>{p.search||status!=='all'||p.category!=='all'?'可以调整搜索词或筛选条件。':'上传资料整理后入库，或直接新建一条问答。'}</p>{p.manage&&<Button variant="outline" onClick={p.onNew}>新建问答</Button>}</div>:<div className={styles.tableScroll} role="region" aria-label="问答列表" tabIndex={0}><table><thead><tr><th className={styles.questionColumn}>标准问题</th><th className={styles.answerColumn}>标准答案</th><th className={styles.categoryColumn}>分类</th><th className={styles.statusColumn}>状态</th><th className={styles.dateColumn}>更新时间</th><th className={styles.actionColumn}>操作</th></tr></thead><tbody>{visible.map(n=><tr key={n.id}><td><button className={styles.question} onClick={()=>p.onOpen(n)}>{n.title}</button>{p.scope==='all'&&<span className={styles.scopeLabel}>{n.agentId?p.agents.find(a=>a.agentId===n.agentId)?.name||'已关联数字员工':'企业共享'}</span>}</td><td><button className={styles.answer} onClick={()=>p.onOpen(n)}>{faqPreview(n.preview)||'查看完整答案'}</button></td><td><span className={styles.category}>{categoryNames.get(n.categoryId||'')||'未分类'}</span></td><td><button type="button" className={styles.status} data-status={n.status} disabled={!p.manage||p.busy||n.status==='EXPIRED'} aria-label={knowledgeStatus[n.status]+'：'+n.title+'，'+(n.enabled?'点击停用':'点击启用')} title={n.status==='EXPIRED'?'修改有效期后可启用':!p.manage?'':n.enabled?'点击停用':'点击启用'} onClick={()=>p.onToggle(n)}>{knowledgeStatus[n.status]||'待确认'}</button></td><td><time>{knowledgeDate(n.updatedAt)}</time></td><td><div className={styles.rowActions}><button onClick={()=>p.onOpen(n)}>{p.manage?'编辑':'查看'}</button>{p.canDelete&&<button aria-label={'回收问答：'+n.title} onClick={()=>p.onRecycle(n)} disabled={p.busy}><Trash2 size={14}/></button>}</div></td></tr>)}</tbody></table></div>}
    <footer className={styles.pagination}><span>共 {rows.length} 条</span><label>每页<NativeSelect aria-label="每页问答条数" value={size} onChange={e=>setSize(Number(e.target.value))}>{[10,20,50].map(n=><option key={n} value={n}>{n} 条</option>)}</NativeSelect></label><div className={styles.pages}><button aria-label="问答上一页" disabled={current===1||p.loading} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/></button>{Array.from({length:Math.min(5,pages)},(_,i)=>{const n=Math.max(1,Math.min(current-2,pages-4))+i;return <button key={n} aria-label={'问答第'+n+'页'} aria-current={n===current?'page':undefined} disabled={p.loading} onClick={()=>setPage(n)}>{n}</button>;})}<button aria-label="问答下一页" disabled={current===pages||p.loading} onClick={()=>setPage(current+1)}><ChevronRight size={16}/></button></div><span>{current} / {pages} 页</span></footer>
   </div>
  </div>
 </section>;
}
