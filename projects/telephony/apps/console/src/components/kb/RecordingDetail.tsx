/*
 * 中文导读：知识库的 RecordingDetail 组件，封装该界面的展示与交互。
 */
"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useQuery,useMutation} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {learningApi} from '@/src/lib/api/resources/learning';
import {RecordingReview} from '../agents/studio/RecordingReview';
import {Button} from '../ui/button';
import {toast} from '@/src/lib/toast';
export function RecordingDetail({agentId,recordingId}:{agentId:string;recordingId:string}){
 const {org,user}=useAliyunIdentity(),player=useRef<HTMLAudioElement>(null),[audio,setAudio]=useState(''),url=useRef(''),pendingSeek=useRef<number|null>(null);
 const q=useQuery({queryKey:['recording-detail',org,user,agentId,recordingId],queryFn:async()=>{const [row,cap]=await Promise.all([learningApi.detail(agentId,org,recordingId),learningApi.capabilities(agentId,org)]);return {row,cap};},retry:false,refetchInterval:q=>['QUEUED','PROCESSING'].includes(q.state.data?.row.status||'')?3000:false});
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 const listen=useMutation({mutationFn:()=>learningApi.audio(agentId,org,recordingId),onSuccess:blob=>{if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio(url.current);},onError:(e:Error)=>toast.error(e.message)});
 const retry=useMutation({mutationFn:()=>learningApi.learn(agentId,org,recordingId,true),onSuccess:()=>{void q.refetch();toast.success('已重新排入处理队列');},onError:(e:Error)=>toast.error(e.message)});
 return <main className="mx-auto w-full max-w-4xl space-y-5 p-6"><Link href="/kb" className="text-sm text-muted-foreground">← 返回知识库</Link><h1 className="text-xl font-semibold">录音处理详情</h1>{q.isPending?<p>正在读取…</p>:q.error?<p role="alert">{q.error.message}</p>:<><header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div><h2 className="font-medium">{q.data.row.name}</h2><p className="mt-1 text-sm text-muted-foreground">{q.data.row.durationSeconds} 秒 · {({READY:'已整理',NEEDS_REVIEW:'待核对',UPLOADED:'待处理',QUEUED:'排队中',PROCESSING:'处理中'} as Record<string,string>)[q.data.row.status]||q.data.row.status}</p></div><Button variant="outline" disabled={listen.isPending} onClick={()=>listen.mutate()}>播放原录音</Button></header>{audio&&<audio ref={player} controls src={audio} onLoadedMetadata={()=>{if(player.current&&pendingSeek.current!==null){player.current.currentTime=pendingSeek.current;pendingSeek.current=null;void player.current.play();}}} className="w-full"/>}{q.data.row.error&&<p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm">{q.data.row.error}</p>}{q.data.cap.canManageKnowledge&&['UPLOADED','NEEDS_REVIEW'].includes(q.data.row.status)&&<Button disabled={retry.isPending} onClick={()=>{if(window.confirm('请先核对上次模型请求记录。重新处理可能再次消耗额度，确认继续？'))retry.mutate();}}>核对后重新处理</Button>}{q.data.row.analysis&&Array.isArray(q.data.row.analysis.faqs)&&<RecordingReview recording={q.data.row} agentId={agentId} org={org} canEdit={q.data.cap.canManageKnowledge} onRefresh={()=>void q.refetch()} onListen={seconds=>{if(player.current){player.current.currentTime=seconds;void player.current.play();}else {pendingSeek.current=seconds;listen.mutate();}}}/>}<details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm">已收到的转写原文</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{q.data.row.transcript||'尚无转写结果'}</p></details></>}</main>;
}
