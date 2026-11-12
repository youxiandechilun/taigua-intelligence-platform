/*
 * 中文导读：工作区与权限的 AnnouncementManager 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, RotateCcw, Pause, RefreshCw , Save } from "lucide-react";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { announcementApi, type AnnouncementInput, type CompanyAnnouncement } from "@/src/lib/api/resources/announcements";
import { AnnouncementMarquee } from "@/src/components/dashboard/DashboardAnnouncement";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/src/components/ui/alert-dialog";
import { toast } from "@/src/lib/toast";
import { authClient } from "@/src/lib/auth-client";

const labels = { ACTIVE: "展示中", SCHEDULED: "待展示", EXPIRED: "已到期", STOPPED: "已下架" };
const time = (value:string) => new Date(value).toLocaleString("zh-CN", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false });
const dateInput = (value:string|number) => new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16);
type Editor = { requestId:string; row?:CompanyAnnouncement; edit:boolean };

export function AnnouncementManager() {
  const context = useCompanyContext();
  const { data: session } = authClient.useSession();
  if (context.isPending) return <p className="text-sm text-muted-foreground">正在加载公告管理…</p>;
  if (!session?.user.id || !context.data?.canManageAnnouncements) return <p role="alert" className="text-sm">公告管理仅限公司管理员和超级管理员。</p>;
  return <AnnouncementBoard key={context.data.organizationId} org={context.data.organizationId} user={session.user.id} />;
}

function AnnouncementBoard({ org, user }: {org:string; user:string}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"current"|"history">("current");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor|null>(null);
  const [removing, setRemoving] = useState<CompanyAnnouncement|null>(null);
  const [busy, setBusy] = useState(false);
  const query = useQuery({queryKey:["company-announcements",org,user,view,page],queryFn:()=>announcementApi.list(org,view,page),retry:false,refetchInterval:30000,refetchIntervalInBackground:false});
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({queryKey:["company-announcements",org]}),
      queryClient.invalidateQueries({queryKey:["company-announcements-active"]}),
    ]);
  }
  async function action(row:CompanyAnnouncement, remove:boolean) {
    setBusy(true);
    try {
      if (remove) await announcementApi.remove(org,row); else await announcementApi.stop(org,row);
      setRemoving(null); setPage(1); await refresh();
      toast.success(remove ? "公告已删除。" : "公告已下架，已移入历史公告。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }
  const total = query.data?.counts[view] ?? 0;
  return <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">公告管理</h2>
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="刷新公告列表" disabled={query.isFetching} onClick={()=>void refresh()}><RefreshCw className="size-4" /></Button>
        <Button size="sm" disabled={Boolean(editor)||busy} onClick={()=>setEditor({requestId:crypto.randomUUID(),edit:false})}><Plus className="size-4" />发布公告</Button>
      </div>
    </div>
    {editor && <AnnouncementEditor key={editor.requestId} editor={editor} org={org} onClose={()=>setEditor(null)} onSaved={async()=>{setEditor(null);setPage(1);await refresh();}} />}
    <div className="flex gap-5 border-b" role="tablist" aria-label="公告记录分类">
      {([['current','当前公告'],['history','历史公告']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={view===key} className={"border-b-2 px-1 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring "+(view===key?"border-primary font-medium text-primary":"border-transparent text-muted-foreground")} onClick={()=>{setView(key);setPage(1);}}>{label}<span className="ml-2 text-xs tabular-nums">{query.data?.counts[key]??0}</span></button>)}
    </div>
    {query.isError ? <div role="alert" className="flex items-center justify-between gap-3 text-sm"><p>{query.error.message}</p><Button size="sm" variant="outline" onClick={()=>void refresh()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div> : query.isPending ? <p className="text-sm text-muted-foreground">正在加载…</p> : query.data?.rows.length ? <div className="divide-y">
      {query.data.rows.map(row=><article key={row.id} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-1">
        <div className="min-w-0 flex-1 basis-64 space-y-2">
          <div className="flex items-center gap-2"><span className={"shrink-0 rounded px-2 py-0.5 text-xs "+(row.status==='ACTIVE'?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-400":row.status==='SCHEDULED'?"bg-blue-500/10 text-blue-700 dark:text-blue-400":"bg-muted text-muted-foreground")}>{labels[row.status]}</span><span className="size-3 shrink-0 rounded-full border" style={{backgroundColor:row.color}} aria-label={'文字颜色 '+row.color} /><span className="text-xs text-muted-foreground">{row.fontSize}px · {{slow:'慢速',normal:'标准',fast:'快速'}[row.speed]}</span></div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{row.text}</p>
          <p className="text-xs text-muted-foreground"><time dateTime={row.startsAt}>{time(row.startsAt)}</time> — {row.endsAt?<time dateTime={row.endsAt}>{time(row.endsAt)}</time>:'长期显示'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {view==='current' ? <><Button size="sm" variant="ghost" disabled={busy||Boolean(editor)} onClick={()=>setEditor({row,requestId:crypto.randomUUID(),edit:true})}><Pencil className="size-3.5" />编辑</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void action(row,false)}><Pause className="size-3.5" />下架</Button></> : <Button size="sm" variant="ghost" disabled={busy||Boolean(editor)} onClick={()=>setEditor({row,requestId:crypto.randomUUID(),edit:false})}><RotateCcw className="size-3.5" />再次发布</Button>}
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} aria-label={'删除公告：'+row.text.slice(0,20)} onClick={()=>setRemoving(row)}><Trash2 className="size-3.5" />删除</Button>
        </div>
      </article>)}
    </div> : <p className="py-8 text-center text-sm text-muted-foreground">{view==='history'?'暂无历史公告':'暂无当前公告'}</p>}
    {total>20 && <div className="flex items-center justify-end gap-3 border-t pt-4 text-sm"><Button size="sm" variant="outline" disabled={page<=1||query.isFetching} onClick={()=>setPage(value=>value-1)}>上一页</Button><span>{page} / {Math.ceil(total/20)}</span><Button size="sm" variant="outline" disabled={page*20>=total||query.isFetching} onClick={()=>setPage(value=>value+1)}>下一页</Button></div>}
    <AlertDialog open={Boolean(removing)} onOpenChange={open=>{if(!open&&!busy)setRemoving(null);}}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这条公告？</AlertDialogTitle><AlertDialogDescription>公告将停止展示，并从当前及历史列表中移除。</AlertDialogDescription></AlertDialogHeader><p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm">{removing?.text}</p><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event=>{event.preventDefault();if(removing)void action(removing,true);}}>{busy?'正在删除…':'删除公告'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}

function AnnouncementEditor({editor,org,onClose,onSaved}:{editor:Editor;org:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const row=editor.row;
  const [text,setText]=useState(row?.text??'');
  const [color,setColor]=useState(row?.color??'#b83240');
  const [speed,setSpeed]=useState<AnnouncementInput['speed']>(row?.speed??'normal');
  const [fontSize,setFontSize]=useState(row?.fontSize??14);
  const [startMode,setStartMode]=useState(editor.edit&&row?.status==='SCHEDULED'?'scheduled':'now');
  const [start,setStart]=useState(()=>dateInput(editor.edit&&row?row.startsAt:Date.now()+3600000));
  const [unlimited,setUnlimited]=useState(editor.edit?!row?.endsAt:true);
  const [end,setEnd]=useState(()=>dateInput(editor.edit&&row?.endsAt?row.endsAt:Date.now()+86400000));
  const [busy,setBusy]=useState(false);
  const preview={text:text.trim(),color,speed,fontSize};
  function iso(value:string) { if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('请填写完整的展示时间。');return new Date(value+':00+08:00').toISOString(); }
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);
    try {
      const startsAt=startMode==='scheduled'?(editor.edit&&row&&dateInput(row.startsAt)===start?row.startsAt:iso(start)):(editor.edit&&row?.status==='ACTIVE'?row.startsAt:null);
      const endsAt=unlimited?null:(editor.edit&&row?.endsAt&&dateInput(row.endsAt)===end?row.endsAt:iso(end));
      const input={...preview,startsAt,endsAt};
      if(editor.edit&&row)await announcementApi.edit(org,row.id,input,row.updatedAt);else await announcementApi.publish(org,input,editor.requestId);
      toast.success(editor.edit?'公告已更新。':startsAt&&Date.parse(startsAt)>Date.now()?'公告已发布，将按设定时间开始展示。':'公告已发布。');
      await onSaved();
    } catch(error){toast.error(error instanceof Error?error.message:'发布失败，请重试。');}
    finally{setBusy(false);}
  }
  return <form onSubmit={event=>void submit(event)} className="space-y-4 rounded-lg border bg-muted/15 p-4">
    <h3 className="text-sm font-semibold">{editor.edit?'编辑公告':'发布公告'}</h3>
    <fieldset disabled={busy} className="space-y-4">
      <label className="grid gap-2 text-sm font-medium">公告内容<Textarea aria-label="公告内容" value={text} onChange={event=>setText(event.target.value)} maxLength={1000} required rows={3}/></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-medium">文字颜色<div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2"><input type="color" aria-label="公告文字颜色" value={color} onChange={event=>setColor(event.target.value)} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"/><span className="text-xs font-normal uppercase text-muted-foreground">{color}</span></div></label>
        <label className="grid gap-2 text-sm font-medium">字体大小<NativeSelect aria-label="公告字体大小" className="h-9 rounded-md border bg-background px-3 text-sm font-normal" value={fontSize} onChange={event=>setFontSize(Number(event.target.value))}>{[12,14,16,18,20,22,24].map(value=><option key={value} value={value}>{value}px</option>)}</NativeSelect></label>
        <label className="grid gap-2 text-sm font-medium">滚动速度<NativeSelect aria-label="公告滚动速度" className="h-9 rounded-md border bg-background px-3 text-sm font-normal" value={speed} onChange={event=>setSpeed(event.target.value as AnnouncementInput['speed'])}><option value="slow">慢速</option><option value="normal">标准</option><option value="fast">快速</option></NativeSelect></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2 text-sm font-medium"><span>开始展示 <span className="font-normal text-muted-foreground">（北京时间）</span></span><NativeSelect aria-label="公告开始方式" className="h-9 rounded-md border bg-background px-3 text-sm font-normal" value={startMode} onChange={event=>setStartMode(event.target.value)}><option value="now">{editor.edit&&row?.status==='ACTIVE'?'保持当前开始时间':'立即展示'}</option><option value="scheduled">指定时间</option></NativeSelect>{startMode==='scheduled'&&<Input type="datetime-local" aria-label="公告开始时间" value={start} onChange={event=>setStart(event.target.value)} required/>}</div>
        <div className="grid content-start gap-2 text-sm font-medium"><span>结束展示 <span className="font-normal text-muted-foreground">（北京时间）</span></span><label className="flex h-9 items-center gap-2 text-sm font-normal"><input type="checkbox" checked={unlimited} onChange={event=>setUnlimited(event.target.checked)}/>长期显示</label>{!unlimited&&<Input type="datetime-local" aria-label="公告结束时间" value={end} onChange={event=>setEnd(event.target.value)} required/>}</div>
      </div>
      <div className="space-y-2"><span className="text-sm font-medium">滚动预览</span><div className="flex h-12 min-w-0 items-center rounded-md border bg-background pr-3">{preview.text&&<AnnouncementMarquee key={`${text}-${speed}-${fontSize}`} announcement={preview}/>}</div></div>
    </fieldset>
    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" size="sm" disabled={busy||!text.trim()}><Save aria-hidden="true" className="size-4" />{busy?'正在保存…':editor.edit?'保存修改':'发布公告'}</Button></div>
  </form>;
}
