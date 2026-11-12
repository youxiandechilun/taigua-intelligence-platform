/*
 * 中文导读：凭据管理的 SecretsTable 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import {
  Clipboard,
  KeyRound,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "@/src/lib/toast";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { EmptyState } from "@/src/components/common/EmptyState";
import { useDeleteSecret, useSecrets } from "@/src/hooks/queries/secrets";
import type { Secret } from "@/src/lib/api/types";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function SecretSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function SecretsTable({ onCreate }: { onCreate: () => void }) {
  const { data: secrets = [], isLoading, isError, isFetching, refetch } =
    useSecrets();
  const deleteSecret = useDeleteSecret();
  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);

  async function copyReference(secret: Secret) {
    await navigator.clipboard.writeText(secret.reference);
    toast.success("密钥引用已复制");
  }

  async function confirmDelete() {
    try {
      if (!deleteTarget) return;
      await deleteSecret.mutateAsync(deleteTarget.secretId, {
        onSuccess: () => {
          toast.success("密钥已删除");
          setDeleteTarget(null);
        },
      });
    } catch {
      // The mutation hook displays the API error; preserve the current state for retry.
    }
  }

  if (isLoading) return <SecretSkeleton />;

  if (isError) {
    return (
      <EmptyState
        icon={KeyRound}
        title="无法加载密钥"
        description="请刷新密钥列表，或检查网络连接后重试。"
        action={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            重试
          </Button>
        }
      />
    );
  }

  if (!secrets.length) {
    return (
      <EmptyState
        icon={KeyRound}
        title="还没有密钥"
        action={<Button onClick={onCreate}>添加密钥</Button>}
      />
    );
  }

  return (
    <>
      <div className="border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>引用</TableHead>
              <TableHead>已更新</TableHead>
              <TableHead className="w-12 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.map((secret) => (
              <TableRow key={secret.secretId}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center border bg-primary/10 text-primary">
                      <KeyRound className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{secret.name}</p>
                      <p className="text-xs text-muted-foreground">
                        密钥内容已隐藏
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <code className="rounded-sm border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                    {secret.reference}
                  </code>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {fmtDate(secret.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`操作对象：${secret.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>密钥操作</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => copyReference(secret)}>
                        <Clipboard className="size-4" />
                        复制引用
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(secret)}
                      >
                        <Trash2 className="size-4" />
                        删除密钥
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteSecret.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将移除名为以下内容的密钥： {deleteTarget?.name}。使用该引用的工具或回调可能会失效，请及时更新。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSecret.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
              disabled={deleteSecret.isPending}
            >
              {deleteSecret.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              删除密钥
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
