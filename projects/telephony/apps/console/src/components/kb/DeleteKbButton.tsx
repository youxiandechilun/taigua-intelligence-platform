/*
 * 中文导读：知识库的 DeleteKbButton 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog";
import { useDeleteKb } from "@/src/hooks/queries/kb";

export function DeleteKbButton({ kbId, name }: { kbId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteKb();

  async function onDelete() {
    try {
      await del.mutateAsync(kbId);
      setOpen(false);
    } catch {
      // The mutation hook displays the API error; preserve the current state for retry.
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="删除">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除 &quot;{name}&quot;？</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将解除所有智能体对此文档的引用。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={del.isPending}>
            {del.isPending ? (
              <>
                <Loader2 className="animate-spin" /> 正在删除…
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
