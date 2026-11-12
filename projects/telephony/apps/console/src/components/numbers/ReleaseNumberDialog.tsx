/*
 * 中文导读：电话号码的 ReleaseNumberDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";

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
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { useReleaseNumber } from "@/src/hooks/queries/numbers";

export function ReleaseNumberDialog({
  phId,
  phoneNumber,
  compact = false,
}: {
  phId: string;
  phoneNumber: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const release = useReleaseNumber();
  const confirmed = confirmation.trim() === phoneNumber;
  const confirmationId = `release-number-${phId}`;

  async function confirmRelease() {
    if (!confirmed || release.isPending) return;
    try {
      await release.mutateAsync(phId);
      setOpen(false);
      setConfirmation("");
    } catch {
      // Mutation-level feedback keeps the dialog open so the user can retry.
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (release.isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) setConfirmation("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon-sm" : "sm"}
          className={
            compact
              ? "text-destructive hover:text-destructive"
              : "w-full border-destructive/40 text-destructive hover:text-destructive"
          }
          aria-label={`释放${phoneNumber}`}
        >
          <Trash2 />
          {compact ? null : "释放号码"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            释放 {phoneNumber} 并永久移除？
          </AlertDialogTitle>
          <AlertDialogDescription>
            此操作将立即从 泰卦电销智能体 移除号码，并在电话服务商处释放。通话和接听分配将停止，该号码可能无法再次购买。此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              释放不会保留或预留此号码。请先更新已公布的来电号码、转接规则和客户记录。
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={confirmationId}>
            请输入 <span className="font-mono">{phoneNumber}</span> 以确认
          </Label>
          <Input
            id={confirmationId}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={phoneNumber}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={release.isPending}>
            保留号码
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!confirmed || release.isPending}
            onClick={(event) => {
              event.preventDefault();
              void confirmRelease();
            }}
          >
            {release.isPending ? (
              <>
                <Loader2 className="animate-spin" /> 正在释放…
              </>
            ) : (
              "永久释放"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
