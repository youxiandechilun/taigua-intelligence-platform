/*
 * 中文导读：自动化流程的 EmployeeAutomation 组件，封装该界面的展示与交互。
 */
"use client";
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Download,Copy,BookOpen,Play,Save,Trash2,RotateCcw , RefreshCw, Pencil } from 'lucide-react';
import { automationApi,type AutomationRule,type LearningTemplate,type LearningDraft } from '@/src/lib/api/resources/automation';
import { businessApi } from '@/src/lib/api/resources/business';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Switch } from '@/src/components/ui/switch';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/src/components/ui/dialog';
import { toast } from '@/src/lib/toast';
const descriptions:Record<string,string>={LEAD_READY:'你搜索的国内企业达到目标数量后，提醒你下载联系表。',MY_REPORT:'每天汇总你负责或获授权的客户与个人待办。',FOLLOW_UP:'按你设定的时间，提醒你跟进到期客户，不自动打电话或发消息。'};
export function PersonalAutomations({org,user,rules,busy,onSave,onRun}:{org:string;user:string;rules:AutomationRule[];busy:boolean;onSave:(r:AutomationRule)=>void;onRun:(r:AutomationRule)=>void}){
 const [industry,setIndustry]=useState('');const [region,setRegion]=useState('中国大陆');const [target,setTarget]=useState('100');const [searching,setSearching]=useState(false);
 return <section className="space-y-4"><div><h2 className="text-lg font-semibold">我的自动化</h2></div><div className="divide-y rounded-lg border">{rules.map(rule=><PersonalRule key={org+user+rule.kind} rule={rule} busy={busy} onSave={onSave} onRun={onRun}/>)}</div><form className="grid gap-3 rounded-lg border p-5 sm:grid-cols-[1fr_1fr_7rem_auto]" onSubmit={async e=>{e.preventDefault();setSearching(true);try{await businessApi.createJob(org,industry.trim(),region.trim(),Number(target));toast.success('国内企业搜索已开始，完成后可下载表格。');}catch(err){toast.error(err instanceof Error?err.message:'搜索未启动，请重试。');}finally{setSearching(false);}}}><label className="grid gap-2 text-sm">搜索行业<Input required maxLength={80} placeholder="例如 包装印刷" value={industry} onChange={e=>setIndustry(e.target.value)}/></label><label className="grid gap-2 text-sm">国内地区<Input required maxLength={30} value={region} onChange={e=>setRegion(e.target.value)}/></label><label className="grid gap-2 text-sm">电话数量<Input type="number" min={1} max={2000} required value={target} onChange={e=>setTarget(e.target.value)}/></label><Button className="self-end" disabled={searching||busy||!industry.trim()||!Number.isInteger(Number(target))||Number(target)<1||Number(target)>2000}>{searching?'正在提交…':'开始搜索'}</Button></form></section>;
}
function PersonalRule({rule,busy,onSave,onRun}:{rule:AutomationRule;busy:boolean;onSave:(r:AutomationRule)=>void;onRun:(r:AutomationRule)=>void}){
 const [hour,setHour]=useState(String(rule.dailyHour));
 return <article className="flex flex-wrap items-start justify-between gap-4 p-5"><div className="space-y-2"><h3 className="font-medium">{rule.name}</h3><p className="text-sm text-muted-foreground">{descriptions[rule.kind]}</p>{rule.kind!=='LEAD_READY'?<div className="flex flex-wrap items-center gap-2 text-sm"><label htmlFor={'my-hour-'+rule.kind}>每天</label><Input id={'my-hour-'+rule.kind} className="h-8 w-16" type="number" min={0} max={23} value={hour} onChange={e=>setHour(e.target.value)} disabled={busy}/><span>点执行（北京时间）</span><Button size="sm" variant="ghost" disabled={busy||hour===''||!Number.isInteger(Number(hour))||Number(hour)<0||Number(hour)>23||Number(hour)===rule.dailyHour} onClick={()=>onSave({...rule,dailyHour:Number(hour)})}><Save className="size-3"/>保存时间</Button></div>:null}</div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={rule.enabled} disabled={busy} aria-label={'开启'+rule.name} onCheckedChange={enabled=>onSave({...rule,enabled})}/>{rule.enabled?'已开启':'已关闭'}</label><Button size="sm" variant="outline" disabled={busy||!rule.enabled} onClick={()=>onRun(rule)}><Play className="size-3"/>立即执行</Button></div></article>;
}
export function TemplateLibrary({org,user,canManage}:{org:string;user:string;canManage:boolean}) {
  const [recycle,setRecycle]=useState(false);
  const templates=useQuery({queryKey:['learning-templates',org,recycle],queryFn:()=>automationApi.templates(org,recycle),staleTime:30000,retry:false});
  const drafts=useQuery({queryKey:['learning-drafts',org,user,recycle],queryFn:()=>automationApi.learning(org,recycle),retry:false});
  const client=useQueryClient();
  const [busy,setBusy]=useState(false);
  const [templateIds,setTemplateIds]=useState<string[]>([]);
  const [draftIds,setDraftIds]=useState<string[]>([]);
  const [editing,setEditing]=useState<{id?:string;templateId:string;name:string;notes:string}|null>(null);
  const [confirm,setConfirm]=useState<{kind:'templates'|'drafts';ids:string[];restore:boolean}|null>(null);
  const selected=templates.data?.find(t=>t.id===editing?.templateId);
  function toggle(ids:string[],id:string,checked:boolean) { return checked ? [...new Set([...ids,id])].slice(0,100) : ids.filter(i=>i!==id); }
  async function invalidate() { await Promise.all([client.invalidateQueries({queryKey:['learning-templates',org]}),client.invalidateQueries({queryKey:['learning-drafts',org,user]})]); }
  async function download(path:string,name:string) {
    setBusy(true);
    try { await automationApi.file(org,path,name);toast.success('文件已下载。'); }
    catch(e){toast.error(e instanceof Error?e.message:'下载失败，请重试。');}
    finally{setBusy(false);}
  }
  async function change() {
    if(!confirm)return;
    setBusy(true);
    try {
      if(confirm.kind==='templates')await automationApi.changeTemplates(org,confirm.ids,confirm.restore);
      else await automationApi.changeDrafts(org,confirm.ids,confirm.restore);
      setTemplateIds([]);setDraftIds([]);setConfirm(null);await invalidate();
      toast.success(confirm.restore?'已恢复。':'已移入回收站。');
    } catch(e){toast.error(e instanceof Error?e.message:'操作未完成，请重试。');}
    finally{setBusy(false);}
  }
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen className="size-4"/>模板学习库</h2></div>
      <div className="flex gap-1"><Button size="sm" variant={!recycle?'default':'ghost'} aria-pressed={!recycle} onClick={()=>{setRecycle(false);setTemplateIds([]);setDraftIds([]);}}>可用模板</Button><Button size="sm" variant={recycle?'default':'ghost'} aria-pressed={recycle} onClick={()=>{setRecycle(true);setTemplateIds([]);setDraftIds([]);}}><Trash2 className="size-4"/>回收站</Button></div>
    </header>
    {(!recycle||canManage)&&<div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-3">{canManage&&<input type="checkbox" aria-label="选择全部模板" disabled={busy||!templates.data?.length} checked={Boolean(templates.data?.length)&&templates.data!.every(t=>templateIds.includes(t.id))} onChange={e=>setTemplateIds(e.target.checked?(templates.data??[]).map(t=>t.id):[])}/>}<h3 className="text-sm font-medium">{recycle?'已删除的工作区模板':'工作区模板'} <span className="text-xs text-muted-foreground">{templates.data?.length??0}</span></h3></div>
        {canManage&&<Button size="sm" variant="ghost" disabled={busy||!templateIds.length} onClick={()=>setConfirm({kind:'templates',ids:templateIds,restore:recycle})}>{recycle?<RotateCcw className="size-3"/>:<Trash2 className="size-3"/>}{recycle?'恢复所选':'删除所选'}{templateIds.length?`（${templateIds.length}）`:''}</Button>}
      </div>
      {templates.isPending?<p role="status" className="px-4 py-6 text-sm text-muted-foreground">正在加载模板…</p>:templates.isError?<p role="alert" className="p-4 text-sm">模板加载失败。<Button size="sm" variant="ghost" onClick={()=>void templates.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重试</Button></p>:templates.data?.length?<div className="divide-y">{templates.data.map(t=><TemplateRow key={t.id} template={t} busy={busy} recycle={recycle} canManage={canManage} checked={templateIds.includes(t.id)} onCheck={checked=>setTemplateIds(toggle(templateIds,t.id,checked))} onCopy={()=>setEditing({templateId:t.id,name:t.name+' · 我的练习',notes:''})} onDownload={()=>void download('templates/'+t.id+'/download',t.name+'.json')} onRemove={()=>setConfirm({kind:'templates',ids:[t.id],restore:recycle})}/>)}</div>:<p className="px-4 py-6 text-sm text-muted-foreground">{recycle?'没有已删除的模板。':'暂无可用模板，管理员可在回收站恢复。'}</p>}
    </div>}
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-3"><input type="checkbox" aria-label="选择全部学习草稿" disabled={busy||!drafts.data?.length} checked={Boolean(drafts.data?.length)&&drafts.data!.every(d=>draftIds.includes(d.id))} onChange={e=>setDraftIds(e.target.checked?(drafts.data??[]).slice(0,100).map(d=>d.id):[])}/><h3 className="text-sm font-medium">{recycle?'已删除的学习草稿':'我的学习草稿'} <span className="text-xs text-muted-foreground">{drafts.data?.length??0}</span></h3></div>
        <Button size="sm" variant="ghost" disabled={busy||!draftIds.length} onClick={()=>setConfirm({kind:'drafts',ids:draftIds,restore:recycle})}>{recycle?<RotateCcw className="size-3"/>:<Trash2 className="size-3"/>}{recycle?'恢复所选':'删除所选'}{draftIds.length?`（${draftIds.length}）`:''}</Button>
      </div>
      {drafts.isPending?<p role="status" className="p-4 text-sm text-muted-foreground">正在加载草稿…</p>:drafts.isError?<p role="alert" className="p-4 text-sm">草稿加载失败。<Button size="sm" variant="ghost" onClick={()=>void drafts.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重试</Button></p>:drafts.data?.length?<div className="divide-y">{drafts.data.map((d:LearningDraft)=><article key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3"><input type="checkbox" aria-label={'选择草稿'+d.name} checked={draftIds.includes(d.id)} disabled={busy} onChange={e=>setDraftIds(toggle(draftIds,d.id,e.target.checked))}/><div className="min-w-0"><h4 className="text-sm font-medium break-words">{d.name}</h4><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{d.notes||'尚未添加学习笔记'}</p></div></div>
        <div className="flex gap-1">{!recycle&&<><Button size="sm" variant="ghost" disabled={busy} onClick={()=>setEditing({id:d.id,templateId:d.templateId,name:d.name,notes:d.notes})}><Pencil aria-hidden="true" className="size-4" />编辑</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void download('learning/'+d.id+'/download',d.name+'.json')}><Download className="size-3"/>下载</Button></>}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setConfirm({kind:'drafts',ids:[d.id],restore:recycle})}>{recycle?<RotateCcw className="size-3"/>:<Trash2 className="size-3"/>}{recycle?'恢复':'删除'}</Button></div>
      </article>)}</div>:<p className="px-4 py-6 text-sm text-muted-foreground">{recycle?'没有已删除的草稿。':'点击模板的“复制练习”保存你的学习草稿。'}</p>}
    </div>
    <Dialog open={Boolean(confirm)} onOpenChange={open=>{if(!open&&!busy)setConfirm(null);}}><DialogContent><DialogHeader><DialogTitle>{confirm?.restore?'恢复所选内容':'删除所选内容'}</DialogTitle><DialogDescription>{confirm?.kind==='templates'?'操作只影响当前工作区的模板，其他公司和已经创建的草稿、工作流不受影响。':'操作只影响你在当前工作区保存的学习草稿。'}{confirm?.restore?'恢复后可继续使用。':'内容会移入回收站，可以恢复。'}</DialogDescription></DialogHeader><p className="text-sm">已选择 {confirm?.ids.length??0} 项。</p><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setConfirm(null)}>取消</Button><Button variant={confirm?.restore?'default':'destructive'} disabled={busy} onClick={()=>void change()}>{busy?'正在处理…':confirm?.restore?'确认恢复':'移入回收站'}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(editing)} onOpenChange={open=>{if(!open&&!busy)setEditing(null);}}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{editing?.id?'编辑学习草稿':'复制中文模板'}</DialogTitle><DialogDescription>{selected?.description??'记录配置与学习笔记。'}</DialogDescription></DialogHeader>{editing?<form className="space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await automationApi.saveLearning(org,editing);await invalidate();setEditing(null);toast.success('学习草稿已保存。');}catch(err){toast.error(err instanceof Error?err.message:'保存失败。');}finally{setBusy(false);}}}><label className="grid gap-2 text-sm">草稿名称<Input required maxLength={100} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label className="grid gap-2 text-sm">配置与学习笔记<textarea className="min-h-36 rounded-md border bg-background p-3 leading-6" maxLength={6000} value={editing.notes} onChange={e=>setEditing({...editing,notes:e.target.value})} placeholder="记录参数、使用步骤和学习结果，不要填写密码或密钥。"/></label><Button disabled={busy||!editing.name.trim()}><Save aria-hidden="true" className="size-4" />{busy?'正在保存…':'保存我的草稿'}</Button></form>:null}</DialogContent></Dialog>
  </section>;
}
function TemplateRow({template:t,busy,recycle,canManage,checked,onCheck,onCopy,onDownload,onRemove}:{template:LearningTemplate;busy:boolean;recycle:boolean;canManage:boolean;checked:boolean;onCheck:(checked:boolean)=>void;onCopy:()=>void;onDownload:()=>void;onRemove:()=>void}) {
  return <article className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-1 items-start gap-3">{canManage&&<input type="checkbox" className="mt-1" aria-label={'选择模板'+t.name} disabled={busy} checked={checked} onChange={e=>onCheck(e.target.checked)}/>}<div className="min-w-0"><h3 className="text-sm font-medium">{t.name}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t.description}</p></div></div><div className="flex flex-wrap gap-1">{!recycle&&<><Button size="sm" variant="outline" disabled={busy} onClick={onCopy}><Copy className="size-3"/>复制练习</Button><Button size="sm" variant="ghost" disabled={busy} onClick={onDownload}><Download className="size-3"/>下载</Button></>}{canManage&&<Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>{recycle?<RotateCcw className="size-3"/>:<Trash2 className="size-3"/>}{recycle?'恢复':'删除'}</Button>}</div></div>{!recycle&&<details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">操作教程与来源</summary><ol className="mt-2 list-decimal space-y-1 pl-5 leading-5">{t.steps.map(step=><li key={step}>{step}</li>)}</ol><p className="mt-2 text-muted-foreground">原作者：{t.author} · <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">官方来源</a></p></details>}</article>;
}
