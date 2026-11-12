/*
 * 中文导读：应用外壳与导航的 FeatureAreaGate 组件，封装该界面的展示与交互。
 */
"use client";
import type {ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {LockKeyhole} from 'lucide-react';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {navigationArea} from '@/src/lib/navigation';
import {Button} from '@/src/components/ui/button';

export function FeatureAreaGate({children}:{children:ReactNode}){
 const path=usePathname(),context=useCompanyContext(),area=navigationArea(path);
 if(context.isPending)return <p role="status" className="p-5 text-sm text-muted-foreground">正在读取功能权限…</p>;
 if(context.isError)return <div role="alert" className="p-5 text-sm">功能权限加载失败<Button variant="link" onClick={()=>void context.refetch()}>重试</Button></div>;
 const item=context.data?.navigation?.items.find(item=>item.id===area);
 if(!context.data?.isSystemAdmin&&item?.enabled===false)return <section className="flex flex-col items-center gap-3 rounded-xl border bg-card px-5 py-16 text-center"><LockKeyhole className="size-6 text-muted-foreground"/><h1 className="text-lg font-semibold">{item.label}已关闭</h1><p className="text-sm text-muted-foreground">此功能由超级管理员管理。</p></section>;
 return children;
}
export function OutboundToolsGate({children}:{children:ReactNode}){
 const context=useCompanyContext();
 if(!context.data||!context.data.isSystemAdmin&&context.data.navigation?.items.find(item=>item.id==='outbound')?.enabled===false)return null;
 return children;
}
