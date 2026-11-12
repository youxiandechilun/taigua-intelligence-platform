/*
 * 中文导读：凭据管理的 AddSecretDialog 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "@/src/lib/toast";
import { z } from "zod";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { useCreateSecret } from "@/src/hooks/queries/secrets";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入密钥名称")
    .max(120, "密钥名称不能超过 120 个字符")
    .regex(
      /^[A-Za-z0-9_.:-]+$/,
      "请使用字母、数字、点、下划线、冒号或连字符"
    ),
  value: z.string().min(1, "请输入密钥内容"),
});

type FormValues = z.infer<typeof schema>;

export function AddSecretDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createSecret = useCreateSecret();
  const [showValue, setShowValue] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", value: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await createSecret.mutateAsync(values, {
        onSuccess: () => {
          toast.success("密钥已保存");
          reset();
          setShowValue(false);
          onOpenChange(false);
        },
      });
    } catch {
      // The mutation hook shows the user-facing error toast.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !createSecret.isPending) {
      reset();
      setShowValue(false);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建密钥</DialogTitle>
          <DialogDescription>
            保存第三方服务令牌或 API 密钥，后台不会展示原始内容。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="secret-name">名称</Label>
            <Input
              id="secret-name"
              placeholder="stripe.api_key"
              autoComplete="off"
              disabled={createSecret.isPending}
              {...register("name")}
            />
            {errors.name ? (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                名称在此工作区中必须唯一。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-value">值</Label>
            <div className="flex gap-2">
              <Input
                id="secret-value"
                type={showValue ? "text" : "password"}
                autoComplete="new-password"
                disabled={createSecret.isPending}
                {...register("value")}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showValue ? "隐藏密钥内容" : "显示密钥内容"}
                onClick={() => setShowValue((visible) => !visible)}
                disabled={createSecret.isPending}
              >
                {showValue ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
            {errors.value ? (
              <p className="text-xs text-destructive">{errors.value.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createSecret.isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={createSecret.isPending}>
              {createSecret.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              保存密钥
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
