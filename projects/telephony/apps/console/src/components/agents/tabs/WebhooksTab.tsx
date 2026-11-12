/*
 * 中文导读：数字员工与话术的 WebhooksTab 组件，封装该界面的展示与交互。
 */
"use client";
import Link from "next/link";
import { useAliyunConfig } from "@/src/hooks/queries/aliyun";
import { Button } from "@/src/components/ui/button";
export function WebhooksTab({agentId}:{agentId:string}){const config=useAliyunConfig();return <section className="space-y-4 border bg-card p-6"><h2 className="font-semibold">阿里云通话结果回传</h2><p className="text-sm text-muted-foreground">服务器接收配置：{config.isLoading?'读取中…':config.isError?'读取失败':config.data?.callbackReady?'已配置鉴权':'需要配置回传鉴权'}。通话记录、录音和通话小记由云端回执接收，真实回传情况以通话记录为准。</p><p className="text-sm text-muted-foreground">回执接收地址在阿里云控制台维护；收到通话文字后，自动化流程会整理结果并生成跟进待办。</p><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><a href="https://aiccs.console.aliyun.com/agent/receipt" target="_blank" rel="noreferrer">管理云端回执</a></Button><Button asChild variant="outline"><Link href="/settings/aliyun">查看回传配置</Link></Button><Button asChild variant="outline"><Link href="/automation">管理后续自动化</Link></Button></div></section>}
