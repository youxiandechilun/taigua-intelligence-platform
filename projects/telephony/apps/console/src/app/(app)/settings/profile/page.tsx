/*
 * 中文导读：设置中心 / profile的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import {useEffect,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {Loader2,Save} from 'lucide-react';
import {toast} from '@/src/lib/toast';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Label} from '@/src/components/ui/label';
import {authClient} from '@/src/lib/auth-client';
import {accountsApi} from '@/src/lib/api/resources/accounts';
import {accountDisplayName} from '@/src/lib/account-display';

export default function ProfilePage(){
 const {data:session,refetch}=authClient.useSession(),router=useRouter();
 const admin=!!session?.user.role?.split(',').includes('admin')&&!session.session.impersonatedBy;
 const [name,setName]=useState(''),[username,setUsername]=useState(''),[accountPassword,setAccountPassword]=useState('');
 const [oldPassword,setOldPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
 const [busy,setBusy]=useState<'name'|'username'|'password'|null>(null);
 const currentUsername=session?.user.email?accountDisplayName(session.user.email):'';
 useEffect(()=>{setName(session?.user.name||'');},[session?.user.name]);
 useEffect(()=>{setUsername(currentUsername);setAccountPassword('');},[currentUsername]);
 async function saveName(event:FormEvent){
  event.preventDefault();if(busy)return;
  if(name.trim().length<2||name.trim().length>80){toast.error('名称需要2至80个字符。');return;}
  setBusy('name');
  try{const {error}=await authClient.updateUser({name:name.trim()});if(error)throw new Error(error.message);await refetch();router.refresh();toast.success('名称已更新');}
  catch(error){toast.error(error instanceof Error?error.message:'名称保存失败');}finally{setBusy(null);}
 }
 async function saveUsername(event:FormEvent){
  event.preventDefault();if(busy||!admin)return;
  if(!/^[a-z0-9_-]{3,40}$/.test(username.trim().toLowerCase())){toast.error('账号须为3至40位字母、数字、下划线或短横线。');return;}
  setBusy('username');
  try{await accountsApi.updateOwnUsername({username:username.trim().toLowerCase(),expectedUsername:currentUsername,currentPassword:accountPassword});setAccountPassword('');await refetch();router.refresh();toast.success('登录账号已更新，下次请用新账号登录');}
  catch(error){toast.error(error instanceof Error?error.message:'账号修改失败');}finally{setBusy(null);}
 }
 async function savePassword(event:FormEvent){
  event.preventDefault();if(busy||!admin)return;
  if(newPassword.length<8||new TextEncoder().encode(newPassword).length>72){toast.error('新密码至少8位，最多72字节。');return;}
  if(newPassword!==confirmPassword){toast.error('两次新密码不一致。');return;}
  setBusy('password');
  try{const {error}=await authClient.changePassword({currentPassword:oldPassword,newPassword,revokeOtherSessions:true});if(error)throw new Error(error.message);setOldPassword('');setNewPassword('');setConfirmPassword('');await refetch();toast.success('密码已更新，其他设备已退出登录');}
  catch(error){toast.error(error instanceof Error?error.message:'密码修改失败');}finally{setBusy(null);}
 }
 return <div className="max-w-3xl space-y-4">
  <section className="rounded-lg border bg-card p-5"><h2 className="mb-4 text-base font-semibold">个人资料</h2><form onSubmit={saveName} className="space-y-4"><div className="space-y-2"><Label htmlFor="profile-name">名称</Label><Input id="profile-name" autoComplete="name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={!!busy} required/></div><div className="flex justify-end"><Button type="submit" size="sm" disabled={!!busy||!session||name.trim()===session.user.name}>{busy==='name'?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}保存名称</Button></div></form></section>
  <section className="rounded-lg border bg-card p-5"><h2 className="mb-4 text-base font-semibold">登录账号</h2>{admin?<form onSubmit={saveUsername} className="space-y-4"><div className="space-y-2"><Label htmlFor="profile-username">账号</Label><Input id="profile-username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={40} disabled={!!busy} required/><p className="text-xs text-muted-foreground">3至40位字母、数字、下划线或短横线。</p></div><div className="space-y-2"><Label htmlFor="account-current-password">当前密码</Label><Input id="account-current-password" type="password" autoComplete="current-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} disabled={!!busy} required/></div><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">修改后其他设备退出登录，当前登录保留。</p><Button type="submit" size="sm" disabled={!!busy||!accountPassword||username.trim().toLowerCase()===currentUsername}>{busy==='username'?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}保存账号</Button></div></form>:<div className="space-y-2"><Input aria-label="登录账号" value={currentUsername} readOnly/><p className="text-sm text-muted-foreground">登录账号由超级管理员分配和修改。</p></div>}</section>
  <section className="rounded-lg border bg-card p-5"><h2 className="mb-4 text-base font-semibold">账号密码</h2>{admin?<form onSubmit={savePassword} className="space-y-4"><div className="space-y-2"><Label htmlFor="password-current">当前密码</Label><Input id="password-current" type="password" autoComplete="current-password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} disabled={!!busy} required/></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="password-new">新密码</Label><Input id="password-new" type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} disabled={!!busy} required/></div><div className="space-y-2"><Label htmlFor="password-confirm">确认新密码</Label><Input id="password-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} disabled={!!busy} required/></div></div><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">至少8位，修改后其他设备退出登录。</p><Button type="submit" size="sm" disabled={!!busy||!oldPassword||!newPassword||!confirmPassword}>{busy==='password'?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}修改密码</Button></div></form>:<p className="text-sm text-muted-foreground">密码由超级管理员生成和重置，请联系超级管理员。</p>}</section>
 </div>;
}
