/*
 * 中文导读：数字员工与话术 / [id]的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmployeeEditor } from "@/src/components/agents/EmployeeEditor";
import { useAgent } from "@/src/hooks/queries/agents";

import {useCompanyContext} from '@/src/lib/api/resources/company';
import {EmployeeAgentUsage} from '@/src/components/agents/EmployeeAgentUsage';
import {useQuery} from '@tanstack/react-query';
import {playbookApi} from '@/src/lib/api/resources/playbook';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
export default function AgentConfigPage() {
  const {id}=useParams<{id:string}>();
  const company=useCompanyContext();
  const params=useSearchParams();
  const {user}=useAliyunIdentity();
  const scriptAccess=useQuery({queryKey:['script-access',user,company.data?.organizationId],queryFn:playbookApi.access,enabled:!!company.data&&!!user,refetchInterval:30000,refetchOnWindowFocus:true,retry:false});
  if(company.isPending)return <Skeleton className="h-64 w-full"/>;
  if(company.error)return <div role="alert"><p>{company.error.message}</p><Button onClick={()=>void company.refetch()}>重新加载</Button></div>;
  if(scriptAccess.isPending)return <Skeleton className="h-64 w-full"/>;
  if(scriptAccess.error)return <div role="alert"><p>{scriptAccess.error.message}</p><Button onClick={()=>void scriptAccess.refetch()}>重新加载</Button></div>;
  const canManage=scriptAccess.data?.canManage===true;
  return canManage&&params.get('scope')!=='personal' ? <TrainingAgentPage scriptOnly={!company.data?.isSystemAdmin}/> : <EmployeeAgentUsage key={id} agentId={id} canManageScripts={canManage}/>;
}
function TrainingAgentPage({scriptOnly}:{scriptOnly:boolean}) {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error, refetch } = useAgent(id);
  if (isLoading) return <div className="space-y-5"><Skeleton className="h-5 w-32" /><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (error) return <div className="space-y-3 rounded-xl border bg-card p-6"><p role="alert" className="text-sm text-destructive">员工资料读取失败：{error.message}</p><Button variant="outline" onClick={() => void refetch()}>重新加载</Button></div>;
  if (!agent) return <div className="rounded-xl border bg-card p-8 text-center"><UserRound className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-4 text-lg font-semibold">未找到数字员工</h1><p className="mt-2 text-sm text-muted-foreground">员工可能已被删除，或你没有访问当前工作区的权限。</p><Button asChild variant="outline" className="mt-5"><Link href="/agents"><ArrowLeft className="size-4" />返回数字员工</Link></Button></div>;
  return <EmployeeEditor agent={agent} scriptOnly={scriptOnly} />;
}
