/*
 * 中文导读：通话转写内容面板。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Hash,
  PhoneIncoming,
  PhoneOutgoing,
  UserRound,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/src/components/ui/sheet";
import { Badge } from "@/src/components/ui/badge";
import { AudioPlayer } from "@/src/components/calls/AudioPlayer";
import { Transcript } from "@/src/components/calls/Transcript";
import { CallReviewPanel } from "@/src/components/calls/CallReviewPanel";
import { useCall } from "@/src/hooks/queries/calls";
import { cn } from "@/src/lib/utils";
import type { CallLog } from "@/src/lib/api/types";

interface Props {
  call: CallLog | null;
  onClose: () => void;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function directionLabel(value: string | null) {
  const direction = value?.trim().toLowerCase();
  if (direction === "inbound") return "呼入";
  if (direction === "outbound") return "呼出";
  return "未知";
}

function DetailInfo({
  icon: Icon,
  label,
  value,
  title,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}
      </dt>
      <dd className="mt-1.5 truncate text-sm font-medium tabular-nums text-foreground" title={title ?? value}>{value}</dd>
    </div>
  );
}

export function CallTranscriptSheet({ call, onClose }: Props) {
  const detail = useCall(call?.callId ?? "");
  const current = detail.data?.callId === call?.callId ? detail.data : call;
  const metadata = current?.metadata as Record<string, unknown> | null;
  const direction = metadata?.demoCall===true?"演示电话":directionLabel(current?.direction ?? (metadata?.toNumber ? "outbound" : null));
  const isInbound = current?.direction?.trim().toLowerCase() === "inbound";
  const DirectionIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  return (
    <Sheet open={!!call} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:w-[min(92vw,960px)] data-[side=right]:sm:max-w-none data-[side=right]:xl:w-[960px]"
      >
        <SheetHeader className="border-b bg-muted/20 py-4 pr-12 pl-5 sm:pr-14 sm:pl-6">
          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
            <div className="min-w-0 space-y-2">
              <SheetDescription className="sr-only">
                录音和文字记录
              </SheetDescription>
              <SheetTitle className="truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                {current?.callerId ?? "未知来电"}
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-0.5">
                  <DirectionIcon className="size-3.5" />
                  {direction}
                </Badge>
                {current?.status ? (
                  <Badge
                    variant={current.status === "COMPLETED" ? "default" : "secondary"}
                    className={cn(
                      "gap-1.5 rounded-full px-2.5 py-0.5",
                      current.status === "COMPLETED" && "bg-blue-600 text-white"
                    )}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {uiLabel(current.status)}
                  </Badge>
                ) : null}
              </div>
            </div>
            <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,.85fr)] md:w-[400px] md:shrink-0 xl:w-[480px]">
              <DetailInfo icon={CalendarClock} label="开始时间" value={formatDate(current?.startTime ?? null)} />
              <DetailInfo icon={UserRound} label="所属员工" value={current?.ownerName || "—"} />
              <DetailInfo icon={Clock3} label="时长" value={formatDuration(current?.durationSeconds ?? null)} />
              <DetailInfo icon={Hash} label="通话编号" value={call?.callId ? `${call.callId.slice(0, 8)}…` : "—"} title={call?.callId} />
            </dl>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col bg-background">
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[400px_minmax(0,1fr)] lg:overflow-hidden">
            <aside className="min-w-0 space-y-4 border-b bg-muted/20 p-4 lg:overflow-y-auto lg:border-r lg:border-b-0">
              <AudioPlayer src={current?.audioRecordingPath ?? null} />
              {current && <CallReviewPanel call={current} loading={detail.isLoading} failed={detail.isError} onRetry={() => { void detail.refetch(); }} />}
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center justify-between border-b px-5 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">转写文本</h3>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {call ? <Transcript callId={call.callId} compact /> : null}
              </div>
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
