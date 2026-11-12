/*
 * 中文导读：共享界面的 DataAccountFilter 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {Search} from 'lucide-react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useQuery} from '@tanstack/react-query';
import {companyApi,useCompanyContext,canViewWorkspaceData} from '@/src/lib/api/resources/company';
import {NativeSelect} from '@/src/components/ui/native-select';
import {Button} from '@/src/components/ui/button';
import {Popover,PopoverContent,PopoverTrigger} from '@/src/components/ui/popover';
import {Command,CommandInput,CommandList,CommandEmpty,CommandGroup,CommandItem} from '@/src/components/ui/command';
export function DataAccountFilter({compact=false}:{compact?:boolean}){
 const company=useCompanyContext(),params=useSearchParams(),router=useRouter(),path=usePathname();
 const [open,setOpen]=useState(false),[search,setSearch]=useState('');
 const org=company.data?.organizationId;
 const canViewAll=canViewWorkspaceData(company.data);
 const members=useQuery({queryKey:['data-accounts',org,company.data?.roleKey],queryFn:()=>companyApi.members(org!),enabled:!!org&&canViewAll,staleTime:30000});
 if(!canViewAll)return null;
 const selected=params.get('ownerId')||'mine';
 const select=(value:string)=>{
  const next=new URLSearchParams(params);next.set('ownerId',value);next.delete('page');next.delete('cursor');
  router.replace(path+'?'+next.toString());setOpen(false);setSearch('');
 };
 if(compact)return <Popover open={open} onOpenChange={value=>{setOpen(value);if(!value)setSearch('');}}>
  <PopoverTrigger asChild><Button type="button" size="icon" variant="outline" aria-label="搜索账号" className={selected==='mine'?'shrink-0 rounded-md':'shrink-0 rounded-md border-primary/40 bg-primary/5 text-primary'}><Search aria-hidden="true" className="size-4"/></Button></PopoverTrigger>
  <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] rounded-lg p-0">
   <Command><CommandInput aria-label="搜索姓名或账号" placeholder="搜索姓名或账号" value={search} onValueChange={setSearch}/><CommandList>
    <CommandEmpty>{members.isPending?'正在读取账号…':members.isError?'账号加载失败，请重试':'没有找到匹配账号'}</CommandEmpty>
    <CommandGroup><CommandItem value="mine" keywords={['我的数据','本人']} data-checked={selected==='mine'} onSelect={()=>select('mine')}>我的数据</CommandItem><CommandItem value="all" keywords={['全部账号','所有']} data-checked={selected==='all'} onSelect={()=>select('all')}>全部账号</CommandItem>
     {members.data?.map(m=><CommandItem key={m.userId} value={m.userId} keywords={[m.name,m.username]} data-checked={selected===m.userId} onSelect={()=>select(m.userId)}><span className="min-w-0"><span className="block truncate">{m.name}{m.enabled?'':' · 已停用'}</span><span className="block truncate text-xs text-muted-foreground">{m.username}</span></span></CommandItem>)}
    </CommandGroup>
   </CommandList></Command>
   {members.isError&&<div role="alert" className="border-t px-3 py-2 text-xs text-destructive">账号列表加载失败<Button size="sm" variant="link" onClick={()=>void members.refetch()}>重试</Button></div>}
  </PopoverContent>
 </Popover>;
 return <label className="flex items-center gap-2 whitespace-nowrap text-sm"><span className="text-muted-foreground">查看账号</span><NativeSelect className="w-[190px]" aria-label="查看账号数据" value={selected} disabled={members.isPending||members.isError} onChange={e=>select(e.target.value)}><option value="mine">我的数据</option><option value="all">全部账号</option>{members.data?.map(m=><option key={m.userId} value={m.userId}>{m.name}（{m.username}）{m.enabled?'':' · 已停用'}</option>)}</NativeSelect>{members.isError&&<span role="alert" className="text-xs text-destructive">账号列表加载失败</span>}</label>;
}
