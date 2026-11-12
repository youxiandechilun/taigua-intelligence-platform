/*
 * 中文导读：自动化流程的 WorkflowWorkspace 组件，封装该界面的展示与交互。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { Workflow, ListChecks, KeyRound, Table2, Settings2, Maximize2, Minimize2, Loader2, ChevronDown, Trash2 , RefreshCw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/src/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/src/components/ui/dropdown-menu";

import { useCompanyContext } from "@/src/lib/api/resources/company";

const sections = [
  { label: "工作流", path: "/home/workflows", icon: Workflow },
  { label: "回收站", path: "/home/workflows?showArchived=true", icon: Trash2 },
  { label: "执行记录", path: "/home/executions", icon: ListChecks },
  { label: "流程凭据", path: "/home/credentials", icon: KeyRound },
  { label: "数据表", path: "/home/datatables", icon: Table2 },
] as const;

export function WorkflowWorkspace() {
  const company = useCompanyContext();
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolvedTheme } = useTheme();
  const [path, setPath] = useState<string>(sections[0].path);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);

  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "taigua:n8n:theme", theme: resolvedTheme === "dark" ? "dark" : "light" }, window.location.origin);
  }, [resolvedTheme]);

  const startLoading = useCallback(() => {
    setLoading(true);
    setSlow(false);
    setFailed(false);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setSlow(true), 25000);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "taigua:n8n:confirm-delete" && Number.isInteger(event.data.id)) {
        setDeleting({ id: event.data.id, name: typeof event.data.name === "string" ? event.data.name : "所选工作流" });
      }
      if (event.data?.type === "taigua:n8n:loading") startLoading();
      if (event.data?.type === "taigua:n8n:ready") {
        if (timeout.current) clearTimeout(timeout.current);
        setLoading(false);
        setSlow(false);
        if (typeof event.data.path === "string") setPath(event.data.path);
        sendTheme();
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [sendTheme, startLoading]);

  useEffect(() => {
    sendTheme();
    frame.current?.contentWindow?.postMessage({ type: "taigua:n8n:check" }, window.location.origin);
  }, [sendTheme]);

  useEffect(() => {
    timeout.current = setTimeout(() => setSlow(true), 25000);
    return () => { if (timeout.current) clearTimeout(timeout.current); };
  }, []);

  useEffect(() => {
    const listener = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  function navigate(next: string) {
    setPath(next);
    frame.current?.contentWindow?.postMessage({ type: "taigua:n8n:navigate", path: next }, window.location.origin);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await container.current?.requestFullscreen();
  }

  function retry() {
    startLoading();
    if (frame.current) frame.current.src = "/workflow-editor" + path;
  }

  function loaded() {
    setDeleting(null);
    sendTheme();
    frame.current?.contentWindow?.postMessage({ type: "taigua:n8n:check" }, window.location.origin);
    // A proxy error page is plain text; successful n8n loads contain its app mount.
    const doc = frame.current?.contentDocument;
    if (doc && !doc.getElementById("n8n-app")) {
      if (timeout.current) clearTimeout(timeout.current);
      setFailed(true);
      setLoading(false);
    }
  }

  return (
    <div ref={container} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background fullscreen:h-dvh fullscreen:rounded-none">
      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }}>
        <DialogContent><DialogHeader><DialogTitle>删除工作流</DialogTitle><DialogDescription>“{deleting?.name}”会移入回收站，可以恢复。已发布的流程将停止后续自动执行，历史记录会保留。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" onClick={() => { if (deleting) frame.current?.contentWindow?.postMessage({ type: "taigua:n8n:approve-delete", id: deleting.id }, window.location.origin); setDeleting(null); }}>移入回收站</Button></div></DialogContent>
      </Dialog>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <nav aria-label="流程工作台功能" className="flex flex-wrap gap-1">
          {sections.map((section) => (
            <Button key={section.path} size="sm" variant={(section.path.includes("?") ? path === section.path : path.split("?")[0] === section.path && !path.includes("showArchived=true")) ? "default" : "ghost"} aria-pressed={(section.path.includes("?") ? path === section.path : path.split("?")[0] === section.path && !path.includes("showArchived=true"))} onClick={() => navigate(section.path)} disabled={loading}>
              <section.icon className="size-4" />{section.label}
            </Button>
          ))}
          {company.data?.isSystemAdmin && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant={path.startsWith("/settings/") ? "default" : "ghost"} disabled={loading}><Settings2 className="size-4" />流程管理<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => navigate("/settings/api")}>引擎接口密钥</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings/community-nodes")}>社区节点管理</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings/usage")}>引擎运行与用量</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/settings/members">组织与人员</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/settings/accounts">公司与超级管理员</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </nav>
        <Button size="sm" variant="ghost" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "退出全屏编辑" : "全屏编辑"}>
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}<span className="hidden sm:inline">{fullscreen ? "退出全屏" : "全屏编辑"}</span>
        </Button>
      </div>
      <div className={`relative min-h-0 ${fullscreen ? "flex-1" : "h-[calc(100dvh-16rem)] min-h-[420px]"}`}>
        <iframe ref={frame} title="自动化流程工作台" src="/workflow-editor/home/workflows" onLoad={loaded} onError={() => { setFailed(true); setLoading(false); }} aria-busy={loading} className={`h-full w-full border-0 bg-background ${loading || failed ? "invisible" : "visible"}`} referrerPolicy="same-origin" />
        {loading || failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center" role="status" aria-live="polite">
            {failed ? <Workflow className="size-8 text-primary" /> : <Loader2 className="size-7 motion-safe:animate-spin text-primary" />}
            <p className="text-sm font-medium">{failed ? "流程工作台暂未连接" : "正在加载流程工作台…"}</p>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">{failed ? "请稍后重试。已保存的流程和执行记录会保留。" : slow ? "加载时间较长，请检查网络或重新加载。" : ""}</p>
            {slow || failed ? <Button variant="outline" size="sm" onClick={retry}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
