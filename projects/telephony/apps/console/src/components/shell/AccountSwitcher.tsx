/*
 * 中文导读：应用外壳与导航的 AccountSwitcher 组件，封装该界面的展示与交互。
 */
"use client";

import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,ArrowRight,Loader2,Search,UserRound} from 'lucide-react';
import {authClient} from '@/src/lib/auth-client';
import {accountsApi} from '@/src/lib/api/resources/accounts';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {accountDisplayName} from '@/src/lib/account-display';
import {clearIdentityCache} from '@/src/lib/query-cache';
import {toast} from '@/src/lib/toast';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/src/components/ui/dialog';

export function AccountSwitchDialog({open,onOpenChange,activeOrgId}:{open:boolean;onOpenChange:(open:boolean)=>void;activeOrgId:string}){
 const context=useCompanyContext(),cache=useQueryClient();
 const {data:session}=authClient.useSession();
 const [search,setSearch]=useState(''),[busy,setBusy]=useState<string|null>(null);
 const allowed=context.data?.isSystemAdmin===true&&!session?.session.impersonatedBy;
 const query=useQuery({queryKey:['account-switch-options',session?.user.id,activeOrgId],queryFn:accountsApi.switchOptions,enabled:open&&allowed,staleTime:0});
 const rows=(query.data||[]).filter(row=>`${row.name} ${row.username}`.toLowerCase().includes(search.trim().toLowerCase()));
 async function switchAccount(id:string){
  if(busy||!allowed)return;
  setBusy(id);
  let switched=false;
  try{
   const {error}=await authClient.admin.impersonateUser({userId:id});
   if(error)throw new Error(error.message||'账号切换失败');
   switched=true;
   const workspace=await authClient.organization.setActive({organizationId:activeOrgId});
   if(workspace.error)toast.error('账号已切换，将进入该账号可用的工作区。');
  }catch(error){toast.error(error instanceof Error?error.message:'账号切换失败，请重试');}
  finally{
   if(switched){clearIdentityCache(cache);window.location.assign('/dashboard');}
   else setBusy(null);
  }
 }
 if(!allowed)return null;
 return <Dialog open={open} onOpenChange={value=>{if(!busy){onOpenChange(value);if(!value)setSearch('');}}}><DialogContent showCloseButton={!busy} className="gap-4 sm:max-w-md"><DialogHeader><DialogTitle>切换账号</DialogTitle><DialogDescription>选择当前工作区的员工，进入后按该账号权限操作，可随时返回超级管理员。</DialogDescription></DialogHeader><div className="relative"><Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input aria-label="搜索切换账号" autoComplete="off" placeholder="搜索姓名或账号" className="h-9 pl-9" value={search} onChange={e=>setSearch(e.target.value)} disabled={!!busy}/></div><div className="max-h-80 space-y-1 overflow-y-auto">{query.isPending?<p role="status" className="py-8 text-center text-sm text-muted-foreground">正在读取账号…</p>:query.isError?<div role="alert" className="py-5 text-center text-sm"><p>{query.error.message}</p><Button variant="link" onClick={()=>void query.refetch()}>重新读取</Button></div>:!rows.length?<p className="py-8 text-center text-sm text-muted-foreground">{search?'没有匹配的账号':'当前工作区没有可切换的员工账号'}</p>:rows.map(row=><div key={row.id} className="flex items-center gap-3 rounded-lg border px-3 py-2"><UserRound aria-hidden="true" className="size-4 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.name}</p><p className="truncate text-xs text-muted-foreground">{accountDisplayName(row.username)}</p></div><Button size="sm" variant="ghost" disabled={!!busy} aria-label={`切换到${row.name}（${accountDisplayName(row.username)}）`} onClick={()=>void switchAccount(row.id)}>{busy===row.id?<Loader2 className="size-3.5 animate-spin"/>:<ArrowRight className="size-3.5"/>}切换</Button></div>)}</div></DialogContent></Dialog>;
}

export function useReturnToAdministrator(){
 const cache=useQueryClient(),[busy,setBusy]=useState(false);
 async function restore(){
  if(busy)return;setBusy(true);
  try{const {error}=await authClient.admin.stopImpersonating();if(error)throw new Error(error.message);clearIdentityCache(cache);window.location.assign('/dashboard');}
  catch(error){toast.error(error instanceof Error?error.message:'返回失败，请重新登录。');setBusy(false);}
 }
 return {restore,busy};
}

export function ImpersonationBanner(){
 const {data:session}=authClient.useSession(),{restore,busy}=useReturnToAdministrator();
 if(!session?.session.impersonatedBy)return null;
 return <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-1.5 text-xs"><span>当前账号：<strong>{session.user.name}</strong>（{accountDisplayName(session.user.email)}）</span><Button size="xs" variant="ghost" onClick={()=>void restore()} disabled={busy}>{busy?<Loader2 className="size-3 animate-spin"/>:<ArrowLeft className="size-3"/>}返回超级管理员</Button></div>;
}
