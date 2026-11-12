/*
 * 中文导读：表单的 register-form 组件，封装该界面的展示与交互。
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/src/lib/toast";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import Link from "next/link";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { registerSchema } from "@/src/models/auth/registerSchema";
import { authClient } from "@/src/lib/auth-client";
import { CONSOLE_URL, invitationPath } from "@/src/lib/links";
import OAuthButtons from "../../oauth-buttons";

export function RegisterForm({ invitationId = "" }: { invitationId?: string } = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
  const onSubmit = async (data: z.infer<typeof registerSchema>) => {
    setLoading(true);
    try {
      const { error } = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
        callbackURL: `${CONSOLE_URL ?? window.location.origin}${invitationId ? invitationPath(invitationId) : "/login"}`,
      });
      if (error) {
        toast.error(error.message || error.statusText || "操作出错");
        return;
      }
      toast.message("请查看邮箱，按邮件指引继续");
      router.push(invitationPath(invitationId, "/verify"));
    } catch {
      toast.error("无法连接服务器，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <div className="flex  flex-col items-center gap-2 text-center py-2 ">
        <h1 className="text-2xl font-bold ">创建账户</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {invitationId ? "请使用收到邀请的邮箱，验证邮箱后继续。" : "填写资料以创建账号"}
        </p>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 ">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>姓名</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="例如：张先生"
                  type="text"
                  autoCapitalize="none"
                  autoComplete="name"
                  autoCorrect="off"
                  className="h-11"
                />
              </FormControl>
              <FormDescription />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="name@example.com"
                  type="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  className="h-11"
                />
              </FormControl>
              <FormDescription className="text-xs text-muted-foreground">
                新账号需要验证邮箱后才能登录。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>密码</FormLabel>
              </div>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  placeholder="••••••••"
                  className="h-11 pr-10"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="confirmPassword"
          control={form.control}
          render={({ field }) => {
            const password = form.watch("password");
            return (
              <FormItem>
                <FormLabel>确认密码</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    placeholder="••••••••"
                    className="h-11 pr-10"
                  />
                </FormControl>
                <FormMessage>
                  {password !== field.value && "两次输入的密码不一致"}
                </FormMessage>
              </FormItem>
            );
          }}
        />
        
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              创建中…
            </>
          ) : (
            <span>创建账户</span>
          )}
        </Button>

        <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
          <span className="bg-background text-muted-foreground relative z-10 px-2">
            或
          </span>
        </div>
        <OAuthButtons invitationId={invitationId} />
        <div className="text-center text-sm">
          已有账号？{" "}
          <Link href={invitationPath(invitationId, "/login")} className="underline underline-offset-4">
            登录
          </Link>
        </div>
      </form>
    </Form>
  );
}
