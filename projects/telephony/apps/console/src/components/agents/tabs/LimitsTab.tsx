/*
 * 中文导读：数字员工与话术的 LimitsTab 组件，封装该界面的展示与交互。
 */
"use client";
import Link from "next/link";
import { useAliyunConfig } from "@/src/hooks/queries/aliyun";
import { Button } from "@/src/components/ui/button";
export function LimitsTab(){const config=useAliyunConfig();return <section className="space-y-4 border bg-card p-6"><h2 className="font-semibold">外呼并发与通话限制</h2><p className="text-sm text-muted-foreground">当前工作区任务并发设置：{config.data?.concurrency??'—'}。实际可用并发受阿里云通信服务额度和线路限制。</p><p className="text-sm text-muted-foreground">任务起止时间在外呼任务中设置；单通话最长时长、超时结束和人工转接规则在阿里云通信智能体中配置。云端发布并生效后才影响真实通话。</p><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/settings/aliyun">修改工作区并发</Link></Button><Button asChild variant="outline"><a href="https://aiccs.console.aliyun.com/agentNew/agentManage" target="_blank" rel="noreferrer">配置云端通话规则</a></Button><Button asChild variant="outline"><Link href="/outbound">外呼任务时间设置</Link></Button></div></section>}
