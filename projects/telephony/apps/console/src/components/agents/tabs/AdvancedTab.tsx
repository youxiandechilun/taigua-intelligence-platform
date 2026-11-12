/*
 * 中文导读：数字员工与话术的 AdvancedTab 组件，封装该界面的展示与交互。
 */
"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAgent,useUpdateAgent,useDeleteAgent } from "@/src/hooks/queries/agents";
import { Button } from "@/src/components/ui/button";
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,AlertDialogTrigger } from "@/src/components/ui/alert-dialog";
export function AdvancedTab({agentId}:{agentId:string}){
 const agent=useAgent(agentId);const update=useUpdateAgent(agentId);const remove=useDeleteAgent();const router=useRouter();const [confirming,setConfirming]=useState(false);
 return <div className="space-y-6"><section className="space-y-4 border bg-card p-6"><h2 className="font-semibold">本系统智能体状态</h2><p className="text-sm text-muted-foreground">{agent.isLoading?'读取状态中…':agent.isError?'状态暂时无法读取':agent.data?.isActive?'已启用，可创建新任务':'已暂停，不允许创建或启动新任务'}。暂停不会终止已经提交阿里云的任务；已有任务请在外呼中心单独停止。</p><Button disabled={!agent.data||update.isPending} onClick={()=>update.mutate({isActive:!agent.data?.isActive})}>{update.isPending?'正在保存…':agent.data?.isActive?'暂停智能体':'启用智能体'}</Button></section><section className="space-y-4 border bg-card p-6"><h2 className="font-semibold">云端运行配置</h2><p className="text-sm text-muted-foreground">声音、打断、电话菜单、知识检索、录音和云端保留策略在阿里云通信智能体中管理，发布后生效。</p><Button asChild variant="outline"><a href="https://aiccs.console.aliyun.com/agentNew/agentManage" target="_blank" rel="noreferrer">管理阿里云智能体</a></Button><Button asChild variant="outline"><Link href={`/agents/${agentId}?tab=voice`}>查看当前云端绑定</Link></Button></section><section className="space-y-4 border border-destructive/30 bg-card p-6"><h2 className="font-semibold">删除本系统智能体</h2><p className="text-sm text-muted-foreground">删除本地管理记录及关联，不会删除阿里云智能体或取消已启动的云端任务。</p><AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogTrigger asChild><Button variant="destructive" disabled={remove.isPending}>删除智能体</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除此智能体？</AlertDialogTitle><AlertDialogDescription>删除本系统智能体及关联资料，无法撤销。阿里云中的任务需另外管理。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={async()=>{try{await remove.mutateAsync(agentId);router.push('/agents');}catch{}}}>{remove.isPending?'删除中…':'确认删除'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section></div>;
}
