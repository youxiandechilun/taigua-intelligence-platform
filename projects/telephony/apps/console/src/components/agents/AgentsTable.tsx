/*
 * 中文导读：数字员工与话术的 AgentsTable 组件，封装该界面的展示与交互。
 */
"use client";
import {AgentAvailabilityControl} from "./AgentAvailabilityControl";
import { AgentSortHandle, useAgentSortItem } from "./AgentSorting";
import { AgentSyncSettings } from "./AgentSyncSettings";

import { AgentIdentity } from "./AgentIdentity";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  AudioLines,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { TestCallDialog } from "@/src/components/agents/AgentTestCallButton";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Switch } from "@/src/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { useDeleteAgent, useUpdateAgent } from "@/src/hooks/queries/agents";
import type { Agent } from "@/src/lib/api/types";
import { cn } from "@/src/lib/utils";

const PAGE_SIZE = 10;

function SortRow({ id, children, ...props }: React.ComponentProps<typeof TableRow> & { id: string }) {
  const sortProps = useAgentSortItem(id);
  return <TableRow {...props} {...sortProps} className={cn(props.className, "agent-sort-item")}>{children}</TableRow>;
}
function SortMobile({ id, children }: { id: string; children: React.ReactNode }) {
  const sortProps = useAgentSortItem(id);
  return <div {...sortProps} className="agent-sort-item border bg-card p-4">{children}</div>;
}

// ── configured chip ───────────────────────────────────────────────────────────

function ConfiguredChip({ configured }: { configured: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-default items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium",
            configured
              ? "border-primary/20 bg-primary/5 text-primary"
              : "border-muted bg-muted/30 text-muted-foreground",
          )}
        >
          <BadgeCheck className="size-3" />
          {configured ? "已保存草稿" : "未设置话术"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {configured
          ? "话术草稿已保存"
          : "打开数字员工，完善岗位职责和沟通话术"}
      </TooltipContent>
    </Tooltip>
  );
}

// ── status switch row ─────────────────────────────────────────────────────────

function StatusCell({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  return <AgentAvailabilityControl agent={agent}/>;
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  agents: Agent[];
  isLoading: boolean;
  canManage?: boolean;
}

export function AgentsTable({ agents, isLoading, canManage = false }: Props) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [previewTarget, setPreviewTarget] = useState<Agent | null>(null);
  const deleteAgent = useDeleteAgent();

  const totalPages = Math.max(1, Math.ceil(agents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const slice = agents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function confirmDelete() {
    try {
      if (!canManage || !deleteTarget) return;
      await deleteAgent.mutateAsync(deleteTarget.agentId);
      setDeleteTarget(null);
    } catch {
      // The mutation hook displays the API error; preserve the current state for retry.
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {slice.map((agent) => (
          <SortMobile key={agent.agentId} id={agent.agentId}>
            <div className="flex items-start gap-3"><AgentSortHandle id={agent.agentId} name={agent.name} />
              <div
                className="min-w-0 flex-1"
                onClick={() => router.push(`/agents/${agent.agentId}`)}
              >
                <AgentIdentity agent={agent} editable={canManage} />
              </div>
              <StatusCell agent={agent} canManage={canManage} /><AgentSyncSettings agentId={agent.agentId} agentName={agent.name}/>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <ConfiguredChip configured={agent.isConfigured} />
              <div className="flex items-center gap-1">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/agents/${agent.agentId}`}>{canManage ? "配置" : "查看"}</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/agents/${agent.agentId}?tab=voice`} aria-label={`通话设置：${agent.name}`}>通话设置</Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`测试模型：${agent.name}`}
                  onClick={() => setPreviewTarget(agent)}
                >
                  <FlaskConical />
                </Button>
                {canManage && <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除${agent.name}`}
                  onClick={() => setDeleteTarget(agent)}
                >
                  <Trash2 />
                </Button>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 border bg-background text-center text-xs">
              <div className="border-r px-2 py-2">
                <p className="font-semibold text-foreground">
                  {agent.phoneNumbersCount}
                </p>
                <p className="text-muted-foreground">工作区主叫</p>
              </div>
              <div className="border-r px-2 py-2">
                <p className="font-semibold text-foreground">
                  {agent.callLogsCount}
                </p>
                <p className="text-muted-foreground">通话</p>
              </div>
              <div className="border-r px-2 py-2">
                <p className="font-semibold text-foreground">
                  {agent.knowledgeSourcesCount}
                </p>
                <p className="text-muted-foreground">补充资料</p>
              </div>
            </div>
          </SortMobile>
        ))}
      </div>
      {/* ── table ── */}
      <div className="hidden overflow-x-auto border bg-card md:block">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              <TableHead className="pl-4 whitespace-nowrap">数字员工</TableHead>
              <TableHead className="w-24">系统状态</TableHead>
              <TableHead className="w-32">话术草稿</TableHead>
              <TableHead className="w-24 text-right whitespace-nowrap">
                工作区主叫
              </TableHead>
              <TableHead className="w-24 text-right whitespace-nowrap">
                通话
              </TableHead>
              <TableHead className="w-24 text-right whitespace-nowrap">
                启用补充资料
              </TableHead>

              <TableHead className="w-14 pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((agent) => (
              <SortRow
                id={agent.agentId}
                key={agent.agentId}
                onClick={() => router.push(`/agents/${agent.agentId}`)}
                className="cursor-pointer border-b transition-colors hover:bg-muted/10"
              >
                {/* agent name + slug */}
                <TableCell className="pl-4">
                  <div className="flex items-center gap-2"><AgentSortHandle id={agent.agentId} name={agent.name} /><AgentIdentity agent={agent} editable={canManage} /></div>
                </TableCell>

                {/* active toggle — stop propagation so the toggle doesn't also navigate */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <StatusCell agent={agent} canManage={canManage} /><AgentSyncSettings agentId={agent.agentId} agentName={agent.name}/>
                </TableCell>

                {/* configured */}
                <TableCell>
                  <ConfiguredChip configured={agent.isConfigured} />
                </TableCell>

                {/* stats */}
                <TableCell className="text-right tabular-nums text-sm">
                  {agent.phoneNumbersCount}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {agent.callLogsCount}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {agent.knowledgeSourcesCount}
                </TableCell>

                {/* actions — stop propagation so the menu doesn't also navigate */}
                <TableCell
                  className="pr-4 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="行操作"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem asChild>
                        <Link
                          href={`/agents/${agent.agentId}`}
                          className="flex items-center gap-2"
                        >
                          <Pencil className="size-4" /> {canManage ? "编辑" : "查看"}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/agents/${agent.agentId}?tab=voice`} className="flex items-center gap-2">
                          <AudioLines className="size-4" /> 通话设置
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPreviewTarget(agent)}>
                        <FlaskConical className="size-4" /> 测试模型
                      </DropdownMenuItem>
                      {canManage && <><DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(agent)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-4" /> 删除
                      </DropdownMenuItem></>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </SortRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── pagination bar ── */}
      <div className="flex flex-col gap-3 px-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <span className="whitespace-nowrap font-medium text-foreground">
            页码 {currentPage} 共 {totalPages}
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage(1)}
              disabled={currentPage <= 1}
              aria-label="第一页"
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="上一页"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              aria-label="下一页"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages}
              aria-label="最后一页"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <AlertDialog
        open={canManage && !!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此数字员工？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将删除 {deleteTarget?.name ?? "此数字员工"}{" "}
              ，并解除与电话号码、工具和知识库的关联。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteAgent.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAgent.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> 删除中…
                </>
              ) : (
                "删除"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {previewTarget ? (
        <TestCallDialog agentId={previewTarget.agentId} agentName={previewTarget.name} onClose={() => setPreviewTarget(null)} />
      ) : null}
    </div>
  );
}
