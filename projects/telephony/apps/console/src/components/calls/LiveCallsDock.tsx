/*
 * 中文导读：通话记录的 LiveCallsDock 组件，封装该界面的展示与交互。
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import {
  ArrowDown,
  ChevronRight,
  Clock3,
  Loader2,
  PhoneCall,
  PhoneOff,
  Radio,
  RefreshCw,
  Users,
  WifiOff,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import { Button } from "@/src/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import { Skeleton } from "@/src/components/ui/skeleton";
import { useCanEndLiveCalls } from "@/src/hooks/use-call-permissions";
import { useEndLiveCall, useLiveCalls } from "@/src/hooks/queries/calls";
import { useLiveTranscript } from "@/src/hooks/use-live-transcript";
import type { LiveCallRoom } from "@/src/lib/api/resources/calls";
import type { LiveTranscriptMessage } from "@/src/lib/live-calls/types";
import { cn } from "@/src/lib/utils";

function directionLabel(direction: LiveCallRoom["direction"]) {
  if (direction === "outbound") return "呼出";
  if (direction === "inbound") return "呼入";
  return "实时通话";
}

function phoneDetails(call: LiveCallRoom) {
  return {
    from: call.fromNumber ?? call.callerId ?? null,
    to: call.toNumber ?? call.calleeId ?? null,
  };
}

function isWidgetCall(call: LiveCallRoom) {
  return call.roomName.startsWith("widget_") || call.callId.startsWith("widget_");
}

function callTitle(call: LiveCallRoom) {
  if (isWidgetCall(call)) return "网站访客";
  const phone = phoneDetails(call);
  const primary = call.direction === "outbound" ? phone.to : phone.from;
  return primary ?? `${directionLabel(call.direction)} ${call.callId.slice(0, 8)}`;
}

function formatElapsed(startedAt: string | null, now: number | null) {
  if (!startedAt || now === null) return "—";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "—";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function transcriptTime(timestamp: string) {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("zh-CN", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function useClock(active: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

function TranscriptRow({ message }: { message: LiveTranscriptMessage }) {
  const isAgent = message.speaker === "agent";
  const intentLabels: Record<string, string> = { interested: "有意向", unclear: "未明确", uninterested: "无意向", optout: "拒绝联系" };
  return (
    <article
      className={cn(
        "border-t border-[#D9D9DD] py-5",
        !isAgent && "ml-[12%]"
      )}
    >
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p
            className={cn(
              "border px-2 py-1 text-xs font-semibold",
              isAgent
                ? "border-[#002FA7] bg-[#002FA7] text-white"
                : "border-[#D9D9DD] bg-[#F7F7F8] text-[#111111]"
            )}
          >
            {isAgent ? "数字员工" : "客户"}
          </p>
          <time className="shrink-0 text-xs tabular-nums text-[#77777F]">
            {transcriptTime(message.timestamp)}
          </time>
        </div>
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-[#111111]">
          {message.text}
        </p>
        {message.matchedIntent || message.provisionalIntent || message.matchedRules?.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#65656D]">
            {message.matchedIntent || message.provisionalIntent ? <span className="border border-[#B8B8BE] bg-[#F7F7F8] px-2 py-1">实时意向：{intentLabels[message.matchedIntent || message.provisionalIntent || ""] ?? message.matchedIntent ?? message.provisionalIntent}</span> : null}
            {message.matchedRules?.map((rule) => <span key={rule.id} className="border border-[#D9D9DD] px-2 py-1">命中：{rule.name}</span>)}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ConnectionStatus({
  state,
  ended,
}: {
  state: ReturnType<typeof useLiveTranscript>["connectionState"];
  ended: boolean;
}) {
  const label = ended
    ? "通话已结束"
    : state === "connected"
      ? "实时连接"
      : state === "reconnecting"
        ? "正在重连"
        : state === "connecting"
          ? "正在连接"
          : "已离线";

  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-[#4B4B52]">
      <span
        className={cn(
          "size-2 border border-[#77777F] bg-[#F7F7F8]",
          !ended && state === "connected" && "border-[#002FA7] bg-[#002FA7]"
        )}
      />
      {label}
    </span>
  );
}

function LiveTranscriptDrawer({
  call,
  canEndCall,
  now,
  onClose,
}: {
  call: LiveCallRoom | null;
  canEndCall: boolean;
  now: number | null;
  onClose: () => void;
}) {
  const transcript = useLiveTranscript(call?.callId ?? null);
  const endCall = useEndLiveCall();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [lastSeenMessageCount, setLastSeenMessageCount] = useState(0);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!transcript.messages.length || !nearBottom) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollContainer.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nearBottom, transcript.messages]);

  const unseenMessages = nearBottom
    ? 0
    : Math.max(0, transcript.messages.length - lastSeenMessageCount);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    const isNearBottom = distanceFromBottom < 96;
    if (isNearBottom !== nearBottom) {
      setNearBottom(isNearBottom);
      setLastSeenMessageCount(transcript.messages.length);
    }
  }

  function scrollToLatest() {
    const node = scrollContainer.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setNearBottom(true);
    setLastSeenMessageCount(transcript.messages.length);
  }

  async function confirmEndCall() {
    if (!call || transcript.isEnded) return;
    try {
      await endCall.mutateAsync(call.roomName);
      transcript.markEnded();
      setConfirmEnd(false);
    } catch {
      // The mutation renders the server error through the shared toast handler.
    }
  }

  const phone = call ? phoneDetails(call) : { from: null, to: null };
  const widgetCall = call ? isWidgetCall(call) : false;

  return (
    <>
      <Sheet open={call !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full gap-0 border-l border-[#B8B8BE] bg-[#FFFFFF] p-0 text-[#111111] shadow-none sm:max-w-[42rem]"
        >
          {call ? (
            <>
              <SheetHeader className="gap-0 border-b border-[#B8B8BE] p-0 text-left">
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)]">
                  <div className="border-r border-[#D9D9DD] bg-[#F7F7F8] px-4 py-5">
                    <p className="text-2xl font-semibold tabular-nums text-[#002FA7]">01</p>
                  </div>
                  <div className="min-w-0 px-5 py-5 pr-14">
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <ConnectionStatus
                        state={transcript.connectionState}
                        ended={transcript.isEnded}
                      />
                      <span className="text-xs text-[#77777F]">
                        {directionLabel(call.direction)}
                      </span>
                    </div>
                    <SheetTitle className="truncate text-xl font-semibold tracking-[-0.02em] text-[#111111]">
                      {callTitle(call)}
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-sm text-[#65656D]">
                      {call.agentName
                        ? `数字员工：${call.agentName}`
                        : `通话${call.callId.slice(0, 8)}`}
                    </SheetDescription>
                  </div>
                </div>
                <div className="grid grid-cols-2 border-t border-[#D9D9DD] sm:grid-cols-4">
                  <div className="border-r border-b border-[#D9D9DD] px-4 py-3 sm:border-b-0">
                    <p className="text-xs text-[#77777F]">已用时长</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-[#111111]">
                      {transcript.isEnded ? "已结束" : formatElapsed(call.startedAt, now)}
                    </p>
                  </div>
                  <div className="border-b border-[#D9D9DD] px-4 py-3 sm:border-r sm:border-b-0">
                    <p className="text-xs text-[#77777F]">参与者</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-[#111111]">
                      {call.participantCount}
                    </p>
                  </div>
                  <div className="border-r border-[#D9D9DD] px-4 py-3">
                    <p className="text-xs text-[#77777F]">主叫号码</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[#111111]">
                      {widgetCall ? "网站访客" : phone.from ?? "暂无号码"}
                    </p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-[#77777F]">到</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[#111111]">
                      {widgetCall ? "语音数字员工" : phone.to ?? "暂无号码"}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="relative min-h-0 flex-1 bg-[#FFFFFF]">
                <div
                  ref={scrollContainer}
                  onScroll={handleScroll}
                  className="absolute inset-0 overflow-y-auto px-5 pb-8 pt-5"
                  aria-live="polite"
                >
                  <div className="mb-5 flex items-baseline justify-between gap-4">
                    <h2 className="text-sm font-semibold text-[#111111]">实时转写</h2>
                    <p className="text-xs tabular-nums text-[#77777F]">
                      {transcript.messages.length} 条已确认消息
                    </p>
                  </div>

                  {transcript.error ? (
                    <div className="mb-4 flex items-start gap-2 border border-[#B8B8BE] bg-[#F7F7F8] p-3 text-sm text-[#4B4B52]">
                      <WifiOff className="mt-0.5 size-4 shrink-0" />
                      <p>{transcript.error}</p>
                    </div>
                  ) : null}

                  {transcript.replayState !== "ready" &&
                  transcript.messages.length === 0 ? (
                    <div className="border-t border-[#D9D9DD] py-8 text-sm text-[#65656D]">
                      <Loader2 className="mb-3 size-4 animate-spin text-[#002FA7]" />
                      正在加载完整文字记录…
                    </div>
                  ) : transcript.messages.length === 0 ? (
                    <div className="border-t border-[#D9D9DD] py-8">
                      <p className="text-sm font-medium text-[#111111]">
                        等待第一条完整消息
                      </p>
                      
                    </div>
                  ) : (
                    <div>
                      {transcript.messages.map((message) => (
                        <TranscriptRow
                          key={message.messageId}
                          message={message}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {unseenMessages > 0 ? (
                  <Button
                    type="button"
                    onClick={scrollToLatest}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-none border border-[#002FA7] bg-[#002FA7] text-white hover:bg-[#002785]"
                  >
                    <ArrowDown className="size-4" />
                    {unseenMessages} 条新消息 {unseenMessages === 1 ? "条消息" : "条消息"}
                  </Button>
                ) : null}
              </div>

              <SheetFooter className="border-t border-[#B8B8BE] bg-[#F7F7F8] p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-[#65656D]">
                    {transcript.isEnded
                      ? "此文字记录已停止接收新消息。"
                      : "实时通话中的完整对话会保存在这里。"}
                  </p>
                  {canEndCall && !transcript.isEnded ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 rounded-none border-[#111111] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-white"
                      onClick={() => setConfirmEnd(true)}
                      disabled={endCall.isPending}
                    >
                      {endCall.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PhoneOff className="size-4" />
                      )}
                      结束通话
                    </Button>
                  ) : null}
                </div>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent className="rounded-none border-[#B8B8BE] bg-[#FFFFFF] text-[#111111]">
          <AlertDialogHeader>
            <AlertDialogTitle>结束这通实时通话？</AlertDialogTitle>
            <AlertDialogDescription className="text-[#65656D]">
              以下通话中的客户和数字员工： {call ? callTitle(call) : "此通话"} 将立即断开连接。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={endCall.isPending} className="rounded-none">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmEndCall();
              }}
              disabled={endCall.isPending}
              className="rounded-none bg-[#111111] text-white hover:bg-[#333333]"
            >
              {endCall.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              结束通话
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function LiveCallsDock({ organizationId }: { organizationId: string }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedCall, setSelectedCall] = useState<LiveCallRoom | null>(null);
  const [restoreCallId, setRestoreCallId] = useState<string | null>(null);
  const liveCalls = useLiveCalls(true);
  const canEndCall = useCanEndLiveCalls(organizationId);
  const now = useClock(true);
  const storageKey = `quickvoice:live-call:${organizationId}`;

  const sortedCalls = useMemo(
    () =>
      dedupeLiveCalls(liveCalls.data ?? []).sort((left, right) =>
        (right.startedAt ?? "").localeCompare(left.startedAt ?? "")
      ),
    [liveCalls.data]
  );

  useEffect(() => {
    setRestoreCallId(window.localStorage.getItem(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!restoreCallId) return;
    const restored = sortedCalls.find((call) => call.callId === restoreCallId);
    if (restored) {
      setSelectedCall(restored);
      setRestoreCallId(null);
      return;
    }
    if (!liveCalls.isLoading && !liveCalls.isFetching) {
      window.localStorage.removeItem(storageKey);
      setRestoreCallId(null);
    }
  }, [liveCalls.isFetching, liveCalls.isLoading, restoreCallId, sortedCalls, storageKey]);

  useEffect(() => {
    if (!selectedCall) return;
    const updated = sortedCalls.find(
      (call) =>
        call.callId === selectedCall.callId ||
        call.roomName === selectedCall.roomName
    );
    if (updated && updated !== selectedCall) setSelectedCall(updated);
    // Updating metadata should follow query-cache changes without closing an ended call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCall?.callId, sortedCalls]);

  function openCall(call: LiveCallRoom) {
    setSelectedCall(call);
    setPanelOpen(false);
    window.localStorage.setItem(storageKey, call.callId);
  }

  function closeCall() {
    setSelectedCall(null);
    window.localStorage.removeItem(storageKey);
  }

  return (
    <>
      <div data-live-call-dock className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 font-sans">
        {panelOpen ? (
          <section
            id="live-call-list"
            className="w-[min(25rem,calc(100vw-2rem))] border border-[#B8B8BE] bg-[#FFFFFF] text-[#111111]"
          >
            <header className="grid grid-cols-[4rem_minmax(0,1fr)_auto] border-b border-[#B8B8BE]">
              <div className="flex items-center justify-center border-r border-[#D9D9DD] bg-[#F7F7F8] text-2xl font-semibold tabular-nums text-[#002FA7]">
                {String(sortedCalls.length).padStart(2, "0")}
              </div>
              <div className="min-w-0 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Radio className="size-4 text-[#002FA7]" />
                  <h2 className="text-sm font-semibold">实时通话</h2>
                </div>
                <p className="mt-1 text-xs text-[#65656D]">
                  {sortedCalls.length === 1
                    ? "1 个正在进行的通话"
                    : `${sortedCalls.length}个正在进行的通话`}
                </p>
              </div>
              <div className="flex items-center border-l border-[#D9D9DD]">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-none text-[#111111] hover:bg-[#F7F7F8]"
                  onClick={() => liveCalls.refetch()}
                  disabled={liveCalls.isFetching}
                  aria-label="刷新实时通话"
                >
                  <RefreshCw
                    className={cn("size-4", liveCalls.isFetching && "animate-spin")}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-none border-l border-[#D9D9DD] text-[#111111] hover:bg-[#F7F7F8]"
                  onClick={() => setPanelOpen(false)}
                  aria-label="关闭实时通话列表"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </header>

            <div className="max-h-[min(31rem,calc(100vh-9rem))] overflow-y-auto">
              {liveCalls.isError ? (
                <div className="m-3 border border-[#B8B8BE] bg-[#F7F7F8] p-4">
                  <p className="text-sm font-medium">实时通话不可用</p>
                  <p className="mt-1 text-xs text-[#65656D]">
                    请检查网络连接并刷新列表。
                  </p>
                </div>
              ) : liveCalls.isLoading ? (
                <div className="space-y-px bg-[#D9D9DD]">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="bg-[#FFFFFF] p-4">
                      <Skeleton className="h-4 w-2/3 rounded-none bg-[#F0F0F2]" />
                      <Skeleton className="mt-3 h-3 w-1/2 rounded-none bg-[#F0F0F2]" />
                    </div>
                  ))}
                </div>
              ) : sortedCalls.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <PhoneCall className="mx-auto size-5 text-[#77777F]" />
                  <p className="mt-3 text-sm font-medium">没有进行中的通话</p>
                  <p className="mt-1 text-xs text-[#65656D]">
                    新通话将自动显示在这里。
                  </p>
                </div>
              ) : (
                <ol>
                  {sortedCalls.map((call, index) => (
                    <li key={call.callId} className="border-b border-[#D9D9DD] last:border-b-0">
                      <button
                        type="button"
                        onClick={() => openCall(call)}
                        className="group grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center text-left transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#002FA7]"
                      >
                        <span className="self-stretch border-r border-[#D9D9DD] px-3 py-4 text-xs font-semibold tabular-nums text-[#002FA7]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 px-4 py-4">
                          <span className="block truncate text-sm font-semibold">
                            {callTitle(call)}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#65656D]">
                            <span>{directionLabel(call.direction)}</span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock3 className="size-3" />
                              {formatElapsed(call.startedAt, now)}
                            </span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Users className="size-3" />
                              {call.participantCount}
                            </span>
                          </span>
                          {call.agentName ? (
                            <span className="mt-1 block truncate text-xs text-[#65656D]">
                              数字员工： {call.agentName}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight className="mr-4 size-4 text-[#77777F] transition-transform group-hover:translate-x-0.5 group-hover:text-[#002FA7]" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        ) : null}

        <Button
          type="button"
          onClick={() => setPanelOpen((current) => !current)}
          aria-expanded={panelOpen}
          aria-controls="live-call-list"
          className="h-12 rounded-none border border-[#002FA7] bg-[#002FA7] px-4 text-white shadow-none hover:bg-[#002785]"
        >
          {liveCalls.isFetching && !liveCalls.data ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Radio className="size-4" />
          )}
          实时通话
          <span className="ml-1 border-l border-white/40 pl-3 tabular-nums">
            {String(sortedCalls.length).padStart(2, "0")}
          </span>
        </Button>
      </div>

      <LiveTranscriptDrawer
        key={selectedCall?.callId ?? "no-live-call"}
        call={selectedCall}
        canEndCall={canEndCall}
        now={now}
        onClose={closeCall}
      />
    </>
  );
}

function dedupeLiveCalls(calls: LiveCallRoom[]) {
  const merged: LiveCallRoom[] = [];
  for (const call of calls) {
    const existingIndex = merged.findIndex(
      (existing) =>
        existing.callId === call.callId || existing.roomName === call.roomName
    );
    if (existingIndex === -1) {
      merged.push(call);
      continue;
    }
    const existing = merged[existingIndex]!;
    merged[existingIndex] = {
      ...existing,
      participantCount: Math.max(existing.participantCount, call.participantCount),
      direction: existing.direction === "unknown" ? call.direction : existing.direction,
      startedAt: existing.startedAt ?? call.startedAt,
      agentId: existing.agentId ?? call.agentId,
      agentName: existing.agentName ?? call.agentName,
      callerId: existing.callerId ?? call.callerId,
      calleeId: existing.calleeId ?? call.calleeId,
      fromNumber: existing.fromNumber ?? call.fromNumber,
      toNumber: existing.toNumber ?? call.toNumber,
    };
  }
  return merged;
}
