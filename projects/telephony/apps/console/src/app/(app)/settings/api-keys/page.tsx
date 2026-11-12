/*
 * 中文导读：设置中心 / api-keys的路由页面；由 Next.js 按文件路由约定加载。
 */
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "@/src/lib/toast";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Badge } from "@/src/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { Skeleton } from "@/src/components/ui/skeleton";
import { EmptyState } from "@/src/components/common/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { authClient } from "@/src/lib/auth-client";
import { queryKeys } from "@/src/lib/query-keys";

type ApiKey = {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt?: string | Date;
  lastRequest?: string | Date | null;
  enabled?: boolean | null;
  expiresAt?: string | Date | null;
};

type ApiKeyListResponse = {
  apiKeys?: ApiKey[];
  total?: number;
};

const schema = z.object({
  name: z.string().min(2, "请输入名称"),
});

export default function ApiKeysPage() {
  const { data: session } = authClient.useSession();
  const orgId = session?.session?.activeOrganizationId ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  const { data: keys = [], isFetching: loading, refetch, error: loadError } = useQuery({
    queryKey: queryKeys.apiKeys.list(orgId),
    enabled: !!orgId,
    queryFn: async () => {
      const api = authClient.apiKey as {
        list?: (input: {
          query?: { organizationId?: string };
        }) => Promise<{ data?: ApiKeyListResponse; error?: { message?: string } }>;
      };
      if (!orgId) return [];
      if (!api.list) throw new Error("当前无法查看 系统 API 密钥列表");
      const res = await api.list({ query: { organizationId: orgId } });
      if (res.error) throw new Error(res.error.message || "无法加载 系统 API 密钥");
      return res.data?.apiKeys ?? [];
    },
  });

  async function refresh() {
    await refetch();
  }

  async function onCreate(values: z.infer<typeof schema>) {
    if (!orgId) return;
    setCreating(true);
    try {
      const api = authClient.apiKey as {
        create?: (input: { name: string; organizationId: string }) => Promise<{
          data?: { key: string };
          error?: { message?: string };
        }>;
      };
      if (!api.create) throw new Error("当前无法创建 系统 API 密钥");
      const { data, error } = await api.create({
        name: values.name,
        organizationId: orgId,
      });
      if (error || !data?.key)
        throw new Error(error?.message ?? "创建失败");
      setNewKey({ key: data.key, name: values.name });
      setCreateOpen(false);
      form.reset();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "无法创建密钥");
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(keyId: string) {
    try {
      const api = authClient.apiKey as {
        delete?: (input: { keyId: string }) => Promise<{
          error?: { message?: string };
        }>;
      };
      if (!api.delete) throw new Error("当前无法删除 系统 API 密钥");
      const { error } = await api.delete({ keyId });
      if (error) throw new Error(error.message ?? "撤销失败");
      toast.success("密钥已撤销");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "无法撤销密钥");
    }
  }

  async function copyNewKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError.message}</p> : null}
      <section className="border bg-card p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">系统 API 密钥</h2>
            <p className="text-sm text-muted-foreground">
              这些密钥属于当前工作区。其他程序读取本系统 API 或 MCP 服务时，请将密钥放入{" "}
              <code className="bg-muted px-1 py-0.5 font-mono text-xs">
                x-api-key
              </code>{" "}
              请求头。这些密钥不支持 Bearer 鉴权，仅提供读取权限，无法管理账单或电话号码归属。
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus /> 新建 系统 API 密钥
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>创建 系统 API 密钥</DialogTitle>
                <DialogDescription>
                  请为密钥设置便于识别的名称。完整密钥仅显示一次，请妥善保存。新密钥属于当前工作区，可用于 MCP，且仅有读取权限。
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onCreate)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>名称</FormLabel>
                        <FormControl>
                          <Input placeholder="正式环境 API" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateOpen(false)}
                      disabled={creating}
                    >
                      取消
                    </Button>
                    <Button type="submit" disabled={creating}>
                      {creating ? (
                        <>
                          <Loader2 className="animate-spin" /> 正在创建…
                        </>
                      ) : (
                        "创建密钥"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !keys.length ? (
          <EmptyState
            icon={KeyRound}
            title="还没有 系统 API 密钥"
            description="仅在需要程序接入时创建。阿里云 AccessKey 和百炼 API Key 请到阿里云配置中填写。"
            className="border-0"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>密钥</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.start ? `${k.start}••••••••` : "••••••••"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={k.enabled === false ? "secondary" : "default"}
                    >
                      {k.enabled === false ? "已停用" : "已启用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.createdAt
                      ? new Date(k.createdAt).toLocaleDateString("zh-CN")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="撤销"
                        >
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>撤销此密钥？</AlertDialogTitle>
                          <AlertDialogDescription>
                            使用此密钥的应用将立即停止工作。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onRevoke(k.id)}>
                            撤销
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={!!newKey} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>复制 系统 API 密钥</DialogTitle>
            <DialogDescription>
              完整密钥仅显示这一次。请立即复制并妥善保存。
            </DialogDescription>
          </DialogHeader>
          <div className="border bg-muted/30 p-3 font-mono text-xs break-all">
            {newKey?.key}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyNewKey}>
              {copied ? (
                <>
                  <Check /> 已复制
                </>
              ) : (
                <>
                  <Copy /> 复制密钥
                </>
              )}
            </Button>
            <Button onClick={() => setNewKey(null)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
