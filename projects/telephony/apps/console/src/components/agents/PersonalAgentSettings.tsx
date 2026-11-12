/*
 * 中文导读：数字员工与话术的 PersonalAgentSettings 组件，封装该界面的展示与交互。
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save, Settings2, PhoneCall, Download } from 'lucide-react';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import { personalPlaybookApi, type PersonalPlaybookView, type PersonalAgentConfiguration } from '@/src/lib/api/resources/playbook';
import { toast } from '@/src/lib/toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';
import { BasicFields, Field, AIInstructionFields, aiWorkInstructions } from './employee-editor-forms';
import { EmployeeCallingAccess } from './EmployeeCallingAccess';
import { EmployeeModel } from '../telephony/EmployeeServices';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';

export function PersonalAgentSettings({agentId,onDirtyChange}:{agentId:string;onDirtyChange:(value:boolean)=>void}) {
  const {user,org}=useAliyunIdentity();
  const query=useQuery({queryKey:['my-playbook',user,org,agentId],queryFn:()=>personalPlaybookApi.get(agentId,org),enabled:!!user&&!!org,refetchOnWindowFocus:false,retry:false});
  if(query.isPending)return <p role="status" className="p-5 text-sm text-muted-foreground">正在读取我的设置…</p>;
  if(!query.data)return <div role="alert" className="space-y-3 p-5 text-sm"><p className="text-destructive">{query.error?.message||'设置读取失败'}</p><Button variant="outline" onClick={()=>void query.refetch()}><RefreshCw className="size-4"/>重新加载</Button></div>;
  return <SettingsForm key={user+org+agentId} agentId={agentId} initial={query.data} onDirtyChange={onDirtyChange}/>;
}
function SettingsForm({agentId,initial,onDirtyChange}:{agentId:string;initial:PersonalPlaybookView;onDirtyChange:(value:boolean)=>void}) {
  const {user,org}=useAliyunIdentity(),qc=useQueryClient(),lock=useRef(false);
  const [saved,setSaved]=useState(initial),[value,setValue]=useState(initial.configuration),[metadata,setMetadata]=useState(initial.playbook.employee||{description:'',business:'',tags:[]});
  const [instructions,setInstructions]=useState(()=>aiWorkInstructions(initial.playbook));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reloadOpen,setReloadOpen]=useState(false);
  const dirty=instructions!==aiWorkInstructions(saved.playbook)||JSON.stringify(value)!==JSON.stringify(saved.configuration)||JSON.stringify(metadata)!==JSON.stringify(saved.playbook.employee||{description:'',business:'',tags:[]});
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const patch=(next:Partial<PersonalAgentConfiguration>)=>setValue(previous=>({...previous,...next}));
  function exportChanges(){const url=URL.createObjectURL(new Blob([JSON.stringify({configuration:value,employee:metadata,aiInstructions:instructions},null,2)],{type:'application/json;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=value.agentName+'-我的设置.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function reload(){if(lock.current)return;lock.current=true;setBusy(true);try{const next=await personalPlaybookApi.get(agentId,org);setSaved(next);setValue(next.configuration);setMetadata(next.playbook.employee||{description:'',business:'',tags:[]});setInstructions(aiWorkInstructions(next.playbook));setError('');setReloadOpen(false);qc.setQueryData(['my-playbook',user,org,agentId],next);}catch(e){setError(e instanceof Error?e.message:'读取失败，请重试');}finally{lock.current=false;setBusy(false);}}
  async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
    const next=await personalPlaybookApi.saveConfiguration(agentId,{configuration:value,employee:metadata,aiInstructions:instructions,expectedRevision:saved.revision,baseReleaseId:saved.baseReleaseId},org);
    setSaved(next);setValue(next.configuration);setMetadata(next.playbook.employee||{description:'',business:'',tags:[]});setInstructions(aiWorkInstructions(next.playbook));qc.setQueryData(['my-playbook',user,org,agentId],next);
    void qc.invalidateQueries({queryKey:['agents']});void qc.invalidateQueries({queryKey:['my-voice']});
    toast.success(process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true'?'我的设置已保存在本地':'我的设置已保存，新建外呼时使用');
  }catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{lock.current=false;setBusy(false);}}
  return <form onSubmit={event=>{event.preventDefault();void save();}} className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Settings2 aria-hidden="true" className="size-4 text-primary"/>我的设置</h2><p className="mt-1.5 text-xs leading-5 text-muted-foreground">保存后用于本账号的新外呼任务。</p></div><Button type="submit" size="sm" disabled={!dirty||busy}><Save className="size-4"/>{busy?'保存中…':'保存我的设置'}</Button></div>
    {error&&<div role="alert" className="m-5 flex flex-wrap items-center gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm"><span className="flex-1 text-destructive">{error}</span><Button type="button" size="sm" variant="outline" onClick={exportChanges}><Download className="size-3.5"/>导出当前修改</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setReloadOpen(true)}><RefreshCw className="size-3.5"/>读取最新内容</Button></div>}
    <fieldset disabled={busy} className="grid min-w-0 gap-6 p-5 xl:grid-cols-2">
      <section className="min-w-0 space-y-4"><h3 className="text-sm font-semibold">基础资料</h3><Field label="数字员工名称"><Input required maxLength={100} value={value.agentName} onChange={event=>patch({agentName:event.target.value})}/></Field><BasicFields metadata={metadata} onChange={setMetadata} active={value.enabled} onActiveChange={enabled=>patch({enabled})} activeBusy={busy}/><AIInstructionFields draft={{...saved.playbook,aiInstructions:instructions}} patch={next=>{if(next.aiInstructions!==undefined)setInstructions(next.aiInstructions);}}/></section>
      <section className="min-w-0 space-y-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><PhoneCall aria-hidden="true" className="size-4 text-primary"/>通话设置</h3><div className="grid gap-4 sm:grid-cols-2">
        <Field label="回答语言"><NativeSelect value={value.profile.language} onChange={event=>patch({profile:{...value.profile,language:event.target.value},communication:{...value.communication,language:event.target.value as PersonalAgentConfiguration['communication']['language']}})}><option value="zh-CN">普通话</option><option value="zh-HK">粤语</option><option value="en">英语</option><option value="auto">跟随客户语言</option></NativeSelect></Field>
        <Field label="最长通话（秒）"><Input type="number" min={60} max={900} required value={value.maxDurationSeconds} onChange={event=>patch({maxDurationSeconds:Number(event.target.value)})}/></Field>
      </div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={value.record} onChange={event=>patch({record:event.target.checked})}/>保存通话录音</label></div><div className="border-t pt-4"><EmployeeCallingAccess value={value.communication.dialPolicyOverride} onChange={dialPolicyOverride=>patch({communication:{...value.communication,dialPolicyOverride}})} disabled={busy}/></div></section>
    </fieldset>
    <Dialog open={reloadOpen} onOpenChange={open=>{if(!busy)setReloadOpen(open);}}><DialogContent><DialogHeader><DialogTitle>读取最新保存内容？</DialogTitle><DialogDescription>未保存的修改会被替换，可以先导出当前内容。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={exportChanges}>导出当前修改</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setReloadOpen(false)}>取消</Button><Button type="button" disabled={busy} onClick={()=>void reload()}>{busy?'读取中…':'读取最新内容'}</Button></DialogFooter></DialogContent></Dialog>
  </form>;
}
