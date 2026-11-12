/*
 * 中文导读：数字员工与话术的 AgentSorting 组件，封装该界面的展示与交互。
 */
"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import type { Agent } from "@/src/lib/api/types";
import { toast } from "@/src/lib/toast";

export function useAgentOrder(agents: Agent[]) {
  const { data: session } = authClient.useSession();
  const key = session?.user.id && session.session.activeOrganizationId
    ? `taigua:agent-order:v1:${session.user.id}:${session.session.activeOrganizationId}` : "";
  const [saved, setSaved] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  useEffect(() => {
    if (!key) return;
    const load = () => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
        setSaved({ key, ids: Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [] });
      } catch { setSaved({ key, ids: [] }); }
    };
    load();
    const sync = (event: StorageEvent) => { if (event.key === key) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  const byId = new Map(agents.map(agent => [agent.agentId, agent]));
  const known = saved.key === key ? saved.ids.filter(id => byId.has(id)) : [];
  const seen = new Set(known);
  const ids = [...known, ...agents.filter(agent => !seen.has(agent.agentId)).map(agent => agent.agentId)];
  const ordered = ids.map(id => byId.get(id)!);
  function move(from: string, to: string, visible: string[]) {
    if (!key || from === to || !visible.includes(from) || !visible.includes(to)) return;
    const projection = [...visible];
    projection.splice(projection.indexOf(from), 1);
    projection.splice(visible.indexOf(to), 0, from);
    const visibleSet = new Set(visible);
    let index = 0;
    const next = ids.map(id => visibleSet.has(id) ? projection[index++]! : id);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setSaved({ key, ids: next });
      toast.success("排序已保存");
    } catch { toast.error("浏览器未能保存排序，请检查本地存储权限。"); }
  }
  return { ordered, move, ready: !!key && saved.key === key };
}

type Drag = { id: string; name: string; target: string; x: number; y: number; started: boolean; keyboard: boolean };
type SortContext = {
  drag: Drag | null;
  disabled: boolean;
  instructionId: string;
  pointerDown(event: PointerEvent<HTMLButtonElement>, id: string, name: string): void;
  pointerMove(event: PointerEvent<HTMLButtonElement>): void;
  finish(cancel?: boolean): void;
  keyDown(event: KeyboardEvent<HTMLButtonElement>, id: string, name: string): void;
};
const Context = createContext<SortContext | null>(null);

export function AgentSortProvider({ ids, disabled, onMove, children }: {
  ids: string[]; disabled: boolean; onMove(from: string, to: string): void; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<Drag | null>(null);
  const frame = useRef<number>(0);
  const point = useRef({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const instructionId = useId();
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    current.current = null;
    setDrag(null);
  }, [ids.join("|"), disabled]);
  function finish(cancel = false) {
    const value = current.current;
    current.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setDrag(null);
    if (value?.started && !cancel) onMove(value.id, value.target);
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string, name: string) {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = { id, name, target: id, x: event.clientX, y: event.clientY, started: false, keyboard: false };
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const value = current.current;
    if (!value || value.keyboard) return;
    point.current = { x: event.clientX, y: event.clientY };
    if (!value.started && Math.hypot(event.clientX - value.x, event.clientY - value.y) < 5) return;
    event.preventDefault();
    value.started = true;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (current.current !== value) return;
      const { x, y } = point.current;
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-agent-sort]");
      const target = hit && root.current?.contains(hit) ? hit.dataset.agentSort : null;
      if (target && ids.includes(target)) value.target = target;
      // Scroll the existing app scroll container while the handle stays captured.
      let parent: HTMLElement | null = root.current?.parentElement || null;
      while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
      if (parent) {
        const bounds = parent.getBoundingClientRect();
        if (y < bounds.top + 48) parent.scrollBy({ top: -18 });
        if (y > bounds.bottom - 48) parent.scrollBy({ top: 18 });
      }
      setDrag({ ...value, x, y });
    });
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, id: string, name: string) {
    if (disabled) return;
    if (event.key === "Escape") { event.preventDefault(); finish(true); return; }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (current.current) finish();
      else { current.current = { id, name, target: id, x: 0, y: 0, started: true, keyboard: true }; setDrag({ ...current.current }); }
      return;
    }
    const value = current.current;
    if (!value?.keyboard || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[data-agent-sort]") || [])].filter(item => item.getClientRects().length);
    const source = items.find(item => item.dataset.agentSort === value.target)?.getBoundingClientRect();
    if (!source) return;
    const cx = source.x + source.width / 2, cy = source.y + source.height / 2;
    const candidates = items.map(item => {
      const rect = item.getBoundingClientRect();
      return { item, dx: rect.x + rect.width / 2 - cx, dy: rect.y + rect.height / 2 - cy };
    }).filter(({ dx, dy }) => event.key === "ArrowUp" ? dy < -4 : event.key === "ArrowDown" ? dy > 4 : event.key === "ArrowLeft" ? dx < -4 : dx > 4)
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    const target = candidates[0]?.item;
    if (target?.dataset.agentSort) { value.target = target.dataset.agentSort; target.scrollIntoView({ block: "nearest" }); setDrag({ ...value }); }
  }
  return <Context.Provider value={{ drag, disabled, instructionId, pointerDown, pointerMove, finish, keyDown }}>
    <div ref={root} className="contents">{children}</div>
    <span id={instructionId} className="sr-only">按住把手拖动排序；也可按空格提起，方向键选择位置，回车确认，Esc 取消。</span>
    <span role="status" className="sr-only">{drag?.started ? `正在移动${drag.name}，目标位置${ids.indexOf(drag.target) + 1}` : ""}</span>
    {drag?.started && !drag.keyboard && createPortal(<div className="pointer-events-none fixed left-0 top-0 z-[100] flex max-w-64 items-center gap-2 rounded-lg border border-primary/30 bg-card px-4 py-3 text-sm font-medium shadow-xl" style={{ transform: `translate3d(${drag.x + 14}px, ${drag.y + 14}px, 0)` }}><GripVertical className="size-4 text-primary" />{drag.name}</div>, document.body)}
  </Context.Provider>;
}

export function useAgentSortItem(id: string) {
  const context = useContext(Context);
  const drag = context?.drag;
  return { "data-agent-sort": id, "data-dragging": drag?.started && drag.id === id ? true : undefined, "data-drop-target": drag?.started && drag.target === id && drag.id !== id ? true : undefined };
}

export function AgentSortHandle({ id, name, subtle = false }: { id: string; name: string; subtle?: boolean }) {
  const context = useContext(Context);
  if (!context || context.disabled) return null;
  return <button type="button" className={`agent-sort-handle inline-flex size-6 shrink-0 touch-none select-none items-center justify-center rounded-sm text-primary/55 hover:text-primary focus-visible:outline-1 focus-visible:outline-primary/30 cursor-grab active:cursor-grabbing ${subtle ? "agent-sort-subtle absolute left-0 top-7 z-10 !w-5 opacity-0 group-hover:opacity-60 focus-visible:opacity-100" : ""}`}
    aria-label={`拖动排序：${name}`} aria-describedby={context.instructionId} aria-pressed={context.drag?.id === id && context.drag.started}
    title="拖动排序" onClick={event => event.stopPropagation()}
    onPointerDown={event => context.pointerDown(event, id, name)} onPointerMove={context.pointerMove}
    onPointerUp={() => context.finish()} onPointerCancel={() => context.finish(true)} onLostPointerCapture={() => context.finish(true)}
    onKeyDown={event => context.keyDown(event, id, name)}><GripVertical className="size-3" strokeWidth={1.2} /></button>;
}
