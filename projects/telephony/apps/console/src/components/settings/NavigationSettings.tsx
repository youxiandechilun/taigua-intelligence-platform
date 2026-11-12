/*
 * 中文导读：设置中心的 NavigationSettings 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {ArrowUp,ArrowDown,RotateCcw,Save,Loader2} from 'lucide-react';
import {companyApi,useCompanyContext} from '@/src/lib/api/resources/company';
import {defaultNavigationPolicy,navigationDefaults,type NavigationPolicy} from '@/src/lib/navigation';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Switch} from '@/src/components/ui/switch';
import {toast} from '@/src/lib/toast';

export function NavigationSettings(){
 const context=useCompanyContext();
 if(context.isPending)return <p className="p-5 text-sm text-muted-foreground">正在读取菜单设置…</p>;
 if(context.isError)return <div role="alert" className="p-5 text-sm">菜单设置加载失败<Button variant="link" onClick={()=>void context.refetch()}>重试</Button></div>;
 if(!context.data?.isSystemAdmin)return null;
 return <MenuEditor key={context.data.organizationId} initial={context.data.navigation||defaultNavigationPolicy()} latestRevision={context.data.navigation?.revision||0}/>;
}
function MenuEditor({initial,latestRevision}:{initial:NavigationPolicy;latestRevision:number}){
 const qc=useQueryClient(),[draft,setDraft]=useState(initial),[saved,setSaved]=useState(initial);
 const dirty=JSON.stringify(draft.items)!==JSON.stringify(saved.items);
 const valid=draft.items.every(item=>item.label.trim().length>0&&item.label.trim().length<=20);
 const changedElsewhere=latestRevision!==saved.revision;
 const save=useMutation({mutationFn:()=>companyApi.saveNavigation({...draft,expectedRevision:saved.revision}),onSuccess:result=>{setDraft(result);setSaved(result);void qc.invalidateQueries({queryKey:['company-context']});toast.success('菜单名称、排序和功能开关已保存');},onError:(error:Error)=>toast.error(error.message)});
 const move=(index:number,direction:number)=>setDraft(prior=>{const items=[...prior.items];[items[index],items[index+direction]]=[items[index+direction],items[index]];return {...prior,items};});
 return <section className="space-y-4 p-5" aria-label="功能区菜单设置">
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">统一设置当前公司账号的菜单。关闭后，其他账号无法查看或使用，超级管理员仍可管理。</p><Button size="sm" variant="ghost" disabled={save.isPending} onClick={()=>setDraft({...defaultNavigationPolicy(),revision:saved.revision})}><RotateCcw className="size-3.5"/>恢复默认</Button></div>
  {changedElsewhere&&<p role="alert" className="text-sm text-amber-700">设置已在其他页面更新，请重新进入此页后修改。</p>}
  <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[440px] text-left text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="w-12 px-3 py-3 font-medium">顺序</th><th className="px-3 py-3 font-medium">菜单名称</th><th className="w-24 px-3 py-3 text-center font-medium">功能开关</th><th className="w-24 px-3 py-3 text-center font-medium">上下排序</th></tr></thead><tbody>{draft.items.map((item,index)=>{const original=navigationDefaults.find(menu=>menu.id===item.id)!;return <tr key={item.id} className="border-t"><td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{index+1}</td><td className="px-3 py-2"><div className="flex items-center gap-3"><Input className="h-8 max-w-52" aria-label={'菜单名称：'+original.label} value={item.label} maxLength={20} disabled={save.isPending} onChange={event=>setDraft(prior=>({...prior,items:prior.items.map(row=>row.id===item.id?{...row,label:event.target.value}:row)}))}/><span className="whitespace-nowrap text-xs text-muted-foreground">{original.label}</span></div></td><td className="px-3 py-2 text-center"><Switch aria-label={'启用功能：'+original.label} checked={item.enabled} disabled={save.isPending} onCheckedChange={enabled=>setDraft(prior=>({...prior,items:prior.items.map(row=>row.id===item.id?{...row,enabled}:row)}))}/></td><td className="px-3 py-2"><div className="flex justify-center gap-1"><Button size="icon-sm" variant="ghost" aria-label={'上移'+original.label} title="上移" disabled={index===0||save.isPending} onClick={()=>move(index,-1)}><ArrowUp className="size-3.5"/></Button><Button size="icon-sm" variant="ghost" aria-label={'下移'+original.label} title="下移" disabled={index===draft.items.length-1||save.isPending} onClick={()=>move(index,1)}><ArrowDown className="size-3.5"/></Button></div></td></tr>;})}</tbody></table></div>
  <div className="flex justify-end"><Button size="sm" disabled={!dirty||!valid||changedElsewhere||save.isPending} onClick={()=>save.mutate()}>{save.isPending?<Loader2 className="size-4 animate-spin"/>:<Save className="size-4"/>}{save.isPending?'正在保存':'保存设置'}</Button></div>
 </section>;
}
