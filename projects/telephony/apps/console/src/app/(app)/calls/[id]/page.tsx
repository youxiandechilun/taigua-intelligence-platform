/*
 * 中文导读：通话记录 / [id]的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Trash2, Loader2 } from "lucide-react";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
 AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog";
import { AudioPlayer } from "@/src/components/calls/AudioPlayer";
import { Transcript } from "@/src/components/calls/Transcript";
import { ExtractedDataPanel } from "@/src/components/calls/ExtractedDataPanel";
import { CallFailureDetails } from '@/src/components/calls/CallFailureDetails';
import {
 useCall,
 useDeleteCall,
} from "@/src/hooks/queries/calls";
import { useAgents } from "@/src/hooks/queries/agents";
import { useRouter } from "next/navigation";
import type { CallStatus } from "@/src/lib/api/types";

function statusVariant(s: CallStatus): "default" | "secondary" | "destructive" {
 if (s === "COMPLETED") return "default";
 if (s === "FAILED" || s === "NOT_ANSWERED") return "destructive";
 return "secondary";
}

function fmtDuration(s: number | null) {
 if (!s) return "—";
 const m = Math.floor(s / 60);
 const r = s % 60;
 return m ? `${m}分钟${r}秒` : `${r}秒`;
}

export default function CallDetailPage() {
 const params = useParams<{ id: string }>();
 const router = useRouter();
 const { data: call, isLoading } = useCall(params.id);
 const { data: agents } = useAgents();
 const del = useDeleteCall();
 const [confirming, setConfirming] = useState(false);

 const agentName = agents?.find((a) => a.agentId === call?.agentId)?.name;

 async function onDelete() {
   try {
   await del.mutateAsync(params.id);
   router.push("/calls");
   } catch {
     // The mutation hook displays the API error; preserve the current state for retry.
   }
 }

 return (
 <div className="flex flex-col gap-6">
 <div>
 <Link
 href="/calls"
 className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
 >
 <ArrowLeft className="size-3.5" /> 返回通话记录
 </Link>
 </div>

 <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
 <div className="space-y-2">
 {isLoading ? (
 <Skeleton className="h-7 w-64" />
 ) : call ? (
 <>
 <h1 className="text-2xl font-semibold tracking-tight">
 {call.callerId ?? "未知来电"}
 </h1>
 <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
 <Badge variant={statusVariant(call.status)} className="uppercase">
 {uiLabel(call.status)}
 </Badge>
 <span>·</span>
 <span>{call.direction?.toLowerCase() === "outbound" ? "外呼" : call.direction?.toLowerCase() === "inbound" ? "呼入" : "—"}</span>
 <span>·</span>
 <span>{fmtDuration(call.durationSeconds)}</span>
 <span>·</span>
 <span>所属员工：{call.ownerName || "—"}</span>
 {agentName ? (
 <>
 <span>·</span>
 <span>{agentName}</span>
 </>
 ) : null}
 </div>
 </>
 ) : (
 <p className="text-sm text-muted-foreground">未找到通话。</p>
 )}
 </div>
 {call ? (
 <AlertDialog open={confirming} onOpenChange={setConfirming}>
 <AlertDialogTrigger asChild>
 <Button variant="outline">
 <Trash2 /> 删除
 </Button>
 </AlertDialogTrigger>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle>删除此通话？</AlertDialogTitle>
 <AlertDialogDescription>
 删除通话会移除通话信息和文字记录，存储中的录音文件不受影响。
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel>取消</AlertDialogCancel>
 <AlertDialogAction
 onClick={onDelete}
 disabled={del.isPending}
 >
 {del.isPending ? (
 <>
 <Loader2 className="animate-spin" /> 正在删除…
 </>
 ) : (
 "确认删除"
 )}
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 ) : null}
 </div>

 {call ? (
 <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
 <div className="space-y-6">
 <AudioPlayer src={call.audioRecordingPath} />
 <CallFailureDetails metadata={call.metadata} status={call.status} />
 <div className="border bg-card p-5">
 <h2 className="mb-4 text-sm font-semibold">转写文本</h2>
 <Transcript callId={call.callId} />
 </div>
 </div>
 <ExtractedDataPanel
 callId={call.callId}
 analysis={call.analysis}
 metadata={call.metadata}
 data={call.dataExtracted}
 evaluation={call.dataEvaluation}
 matchedIntent={call.matchedIntent}
 provisionalIntent={call.provisionalIntent}
 matchedRules={call.matchedRules}
 matchedEvidence={call.matchedEvidence}
 />
 </div>
 ) : null}
 </div>
 );
}
