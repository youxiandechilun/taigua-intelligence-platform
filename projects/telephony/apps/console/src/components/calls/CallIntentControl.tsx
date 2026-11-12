/*
 * 中文导读：通话意向结果的展示与可用操作。
 */
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { MessageCircle } from "lucide-react";
import { useFollowupIdentity } from "@/src/hooks/use-customer-followup";
import { intentLabels, wechatLabels, type FollowupCallState } from "@/src/lib/customer-followup";

const CustomerSheet = dynamic(() => import("@/src/components/crm/CustomerFollowupSheet"), { ssr: false });
export function CallIntentControl({ callId, state, unavailable = false, loading = false }: { callId: string; state?: FollowupCallState; unavailable?: boolean; loading?: boolean }) {
  const { workspace, user } = useFollowupIdentity();
  const [detail, setDetail] = useState<string | null>(null);
  return <div className="flex flex-col items-start gap-1" data-call-intent={callId}>
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs ${state?.intent === "interested" ? "bg-primary/5 text-primary" : "bg-muted/50 text-muted-foreground"}`} title={unavailable ? "意向资料暂未加载，请刷新" : state?.source || (loading ? "正在读取意向" : "暂无分析结果")}>
      {unavailable ? "读取失败" : state ? `${intentLabels[state.intent]}${state.recognitionStatus === "provisional" ? " · 待核验" : state.demo ? " · 演示" : ""}` : loading ? "读取中…" : "暂无分析结果"}
    </span>
    {state?.customerId && <button type="button" className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-primary" onClick={() => setDetail(state.customerId)}><MessageCircle className="size-3" />{state.stage ? wechatLabels[state.stage] : "客户资料"}</button>}
    {detail && <CustomerSheet key={`${workspace}:${user}:${detail}`} customerId={detail} onClose={() => setDetail(null)} />}
  </div>;
}
