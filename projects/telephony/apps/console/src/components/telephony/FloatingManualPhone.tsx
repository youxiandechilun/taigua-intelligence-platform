/*
 * 中文导读：线路与语音外呼的 FloatingManualPhone 组件，封装该界面的展示与交互。
 */
"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, GripVertical, PhoneCall } from "lucide-react";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { telephonyApi, useTelephony, phoneStatus } from "@/src/lib/api/resources/telephony";
import { useManualTasks } from "@/src/lib/api/resources/telephony";
import { Button } from "@/src/components/ui/button";
import { toast } from "@/src/lib/toast";

const PhonePanel = dynamic(() => import("./ManualPhone").then(m => m.ManualPhonePanel), {
  ssr: false,
  loading: () => <p className="p-5 text-center text-sm text-muted-foreground">正在加载拨号器…</p>,
});
type Position = { right: number; bottom: number };

// Mount once in the shared layout, and reset customer state on identity changes.
export function FloatingManualPhone() {
  const { org, user } = useAliyunIdentity();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.body); }, []);
  if (!slot || !org || !user) return null;
  return slot ? createPortal(<PhoneDock key={org + ":" + user} />, slot) : null;
}

function PhoneDock() {
  const { org, user } = useAliyunIdentity();
  const config = useTelephony({ refreshStatus: true });
  const tasks = useManualTasks();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const position = useRef<Position>({ right: 16, bottom: 8 });
  const drag = useRef<(Position & { pointer: number; x: number; y: number }) | null>(null);
  const positionKey = "taigua:phone-position:v1:" + org + ":" + user;
  const seats = useQuery({ queryKey: ["telephony", user, org, "seats"], queryFn: () => telephonyApi.seats(org), enabled: !!org && !!user, retry: false, staleTime: 15000 });
  const seat = seats.data?.find(s => s.userId === user);
  const active = tasks.data?.find(t => t.kind === "MANUAL" && t.createdBy === user && t.attempts.some(a => ["DISPATCHING", "DIALING", "CONNECTED", "NEEDS_REVIEW"].includes(a.status)));
  const attempt = active?.attempts.find(a => ["DISPATCHING", "DIALING", "CONNECTED", "NEEDS_REVIEW"].includes(a.status));
  const availability = useMutation({ mutationFn: () => telephonyApi.saveSeat(org, user, { available: !seat?.available }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["telephony", user, org, "seats"] }); }, onError: (e: Error) => toast.error(e.message) });
  const place = useCallback((right: number, bottom: number) => {
    const el = dock.current;
    if (!el) return;
    position.current = {
      right: Math.max(8, Math.min(right, window.innerWidth - Math.max(el.offsetWidth, el.querySelector<HTMLElement>("#manual-phone-panel:not([hidden])")?.offsetWidth || 0) - 8)),
      bottom: Math.max(8, Math.min(bottom, window.innerHeight - el.offsetHeight - 8)),
    };
    // Pointer movement updates only position; it does not rerender the call UI.
    el.style.right = position.current.right + "px";
    el.style.bottom = position.current.bottom + "px";
    const panel = el.querySelector<HTMLElement>("#manual-phone-panel:not([hidden])");
    if (panel) {
      const above = window.innerHeight - position.current.bottom - el.offsetHeight - 20;
      const below = position.current.bottom - 20;
      const showAbove = above >= below;
      panel.style.top = showAbove ? "auto" : "calc(100% + 12px)";
      panel.style.bottom = showAbove ? "calc(100% + 12px)" : "auto";
      panel.style.maxHeight = Math.max(80, showAbove ? above : below) + "px";
    }
  }, []);
  function persist() {
    // Save tool position only. Customer numbers and call contents stay in memory.
    try { sessionStorage.setItem(positionKey, JSON.stringify(position.current)); } catch { /* Storage may be disabled; the tool still works. */ }
  }
  function show() { setActivated(true); setOpen(true); }
  function toggle() { setActivated(true); setOpen(v => !v); }
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(positionKey) || "null");
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) position.current = saved;
    } catch { /* Storage may be disabled; the tool still works. */ }
    const resize = () => place(position.current.right, position.current.bottom);
    const onShow = () => { setActivated(true); setOpen(true); };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("taigua:open-manual-phone", onShow);
    return () => { window.removeEventListener("resize", resize); window.removeEventListener("taigua:open-manual-phone", onShow); };
  }, [positionKey, place]);
  useEffect(() => {
    place(position.current.right, position.current.bottom);
    const observer = new ResizeObserver(() => place(position.current.right, position.current.bottom));
    if (dock.current) { observer.observe(dock.current); if (dock.current.parentElement) observer.observe(dock.current.parentElement); }
    return () => observer.disconnect();
  }, [open, place]);

  function startDrag(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ...position.current };
  }
  function moveDrag(e: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (start?.pointer === e.pointerId) place(start.right - (e.clientX - start.x), start.bottom - (e.clientY - start.y));
  }
  function stopDrag() { drag.current = null; persist(); }
  function moveWithKeyboard(e: KeyboardEvent<HTMLButtonElement>) {
    const change: Record<string, [number, number]> = { ArrowLeft: [16, 0], ArrowRight: [-16, 0], ArrowUp: [0, 16], ArrowDown: [0, -16] };
    if (!change[e.key]) return;
    e.preventDefault();
    const [x, y] = change[e.key];
    place(position.current.right + x, position.current.bottom + y);
    persist();
  }
  const failed = config.isError || seats.isError || tasks.isError;
  const loading = config.isPending || seats.isPending || tasks.isPending;
  const ready = !!config.data?.manualReady && !!config.data?.liveEnabled;
  const status = failed ? "连接异常" : loading ? "连接中" : attempt ? phoneStatus[attempt.status] || "待核对" : ready ? "已连接" : "待开通";

  return <div ref={dock} data-manual-phone-dock className="pointer-events-auto fixed z-40 flex w-[204px] max-w-[calc(100vw_-_16px)] flex-col items-end" style={{ right: 16, bottom: 8 }}>
    {activated && <div id="manual-phone-panel" role="region" aria-label="人工拨号面板" hidden={!open} onKeyDown={e => { if (e.key === "Escape") setOpen(false); }} className="absolute right-0 bottom-[calc(100%+12px)] w-[310px] max-w-[calc(100vw-24px)] shrink-0 overflow-y-auto rounded-2xl border bg-card shadow-xl">
      <PhonePanel onCollapse={() => setOpen(false)} />
    </div>}
    <div role="group" aria-label="悬浮通话工具" className="flex h-[68px] w-full items-center gap-0.5 rounded-2xl border bg-card px-2 shadow-lg">
      <button type="button" title="拖到屏幕任意位置，也可用上下左右方向键移动" aria-label="移动拨号器" className="flex h-11 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={moveWithKeyboard}><GripVertical className="size-4" /></button>
      <div className="grid min-w-0 flex-1 grid-cols-2">
        <button type="button" onClick={show} aria-label={"通话服务：" + status} className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" className={"size-3 shrink-0 rounded-full " + (ready && !failed && !loading ? "bg-emerald-500 dark:bg-emerald-400" : "bg-slate-400 dark:bg-slate-500")} /><span aria-live="polite" className="whitespace-nowrap">{status}</span></button>
        <button type="button" className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={!seat?.phone || availability.isPending || !!active} aria-pressed={!!seat?.available} aria-label={seat?.available ? "设为离岗" : "设为在岗"} onClick={() => availability.mutate()}><BriefcaseBusiness className={"size-[18px] " + (seat?.available ? "text-primary" : "text-muted-foreground")} />{seat?.available ? "在岗" : "离岗"}</button>
      </div>
      <Button size="icon" className="ml-1 size-[52px] shrink-0 rounded-full shadow-sm" aria-label={open ? "收起人工拨号" : "打开人工拨号"} aria-expanded={open} aria-controls="manual-phone-panel" onClick={toggle}><PhoneCall className="size-[26px]" strokeWidth={1.8} /></Button>
    </div>
  </div>;
}
