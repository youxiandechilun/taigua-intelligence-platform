/*
 * 中文导读：通话记录的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallFilters } from "@/src/components/calls/CallFilters";
import { CallsTable } from "@/src/components/calls/CallsTable";
import type { CallListParams } from "@/src/lib/api/resources/calls";
import type { CallStatus } from "@/src/lib/api/types";
import { resolveCallDateFilters } from "@/src/lib/calls/date-filters";
import { normalizeCallPhoneSearch } from "@/src/lib/calls/phone-search";
import { resolveCallDurationFilters } from "@/src/lib/calls/duration-filters";

function isStatus(v: string | null): v is CallStatus {
  return (
    v === "COMPLETED" ||
    v === "IN_PROGRESS" ||
    v === "NEEDS_REVIEW" ||
    v === "FAILED" ||
    v === "NOT_ANSWERED" ||
    v === "SCHEDULED" ||
    v === "PROCESSED"
  );
}

function isDirection(v: string | null): v is "inbound" | "outbound" {
  return v === "inbound" || v === "outbound";
}

export default function CallsPage() {
  const sp = useSearchParams();
  const [openedAt] = useState(() => new Date());
  const dates = resolveCallDateFilters(
    {
      from: sp.get("from"),
      to: sp.get("to"),
      range: sp.get("range"),
    },
    openedAt,
  );
  const filters: Omit<CallListParams, "cursor" | "limit"> = {
    ownerId: sp.get('ownerId')||'mine',
    phoneNumber: normalizeCallPhoneSearch(sp.get("phoneNumber") || "") || undefined,
    intent: ["interested","unclear","uninterested","optout"].includes(sp.get("intent")||"") ? sp.get("intent") as CallListParams['intent'] : undefined,
    wechatStage: ["pending","requested","added","sent","deferred","failed","closed"].includes(sp.get("wechatStage")||"") ? sp.get("wechatStage") as CallListParams['wechatStage'] : undefined,
    provider: sp.get("provider") === "aliyun" ? "aliyun" : undefined,
    agentId: sp.get("agentId") ?? undefined,
    status: isStatus(sp.get("status")) ? (sp.get("status") as CallStatus) : undefined,
    direction: isDirection(sp.get("direction")) ? sp.get("direction") as "inbound" | "outbound" : undefined,
    ...resolveCallDurationFilters({ minDuration: sp.get("minDuration"), maxDuration: sp.get("maxDuration") }),
    ...dates,
  };

  return (
    <div className="flex flex-col gap-6">
      <CallsTable filters={filters} renderHeader={actions => (
        <header className="calls-page-header">
          <h1 className="text-2xl font-semibold tracking-tight">通话历史</h1>
          <div className="calls-page-filters"><CallFilters /></div>
          <div className="calls-page-actions">{actions}</div>
        </header>
      )} />
    </div>
  );
}
