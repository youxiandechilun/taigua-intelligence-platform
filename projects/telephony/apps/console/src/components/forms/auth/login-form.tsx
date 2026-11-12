/*
 * 中文导读：表单的 login-form 组件，封装该界面的展示与交互。
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EyeIcon, EyeOffIcon, Loader2 } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { loginSchema } from "@/src/models/auth/loginSchema";
import { accountLoginEmail } from "@/src/lib/account-login";
import { Checkbox } from "@/src/components/ui/checkbox";
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from "@/src/components/ui/input-group";


import { clearIdentityCache } from "@/src/lib/query-cache";
import { userMessage } from "@/src/lib/locale";

export function LoginForm({ invitationId = "" }: { invitationId?: string } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => setReady(true), []);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      account: "",
      password: "",
      remember: false,
    },
  });
  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setError(null);
    setLoading(true);
    try {
      await authClient.signIn.email({
        email: accountLoginEmail(data.account, process.env.NEXT_PUBLIC_ACCOUNT_EMAIL_DOMAIN || "dx.zezejun.cn"),
        password: data.password,
        rememberMe: data.remember === true,
        fetchOptions: {
          onSuccess: () => {
            clearIdentityCache(queryClient);
            toast.success("登录成功");
            router.push("/dashboard");
            router.refresh();
          },
          onError: (ctx) => {
            const msg = userMessage(ctx.error.message || "登录失败，请重试。", ctx.error.code).replaceAll("邮箱", "账号");
            toast.error(msg);
            setError(msg);
          },
        },
      });
    } catch {
      const msg = "无法连接服务器，请重试。";
      toast.error(msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form method="post" aria-label="账号登录" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 ">
        {error && (
          <p className="text-destructive text-lg text-center mt-4 font-semibold">
            {error}
          </p>
        )}

        <FormField
          control={form.control}
          name="account"
          render={({ field }) => (
            <FormItem>
              <FormLabel >账号</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="输入分配的账号"
                  type="text"
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  disabled={loading}
                  className="h-11 rounded-lg"
                />
              </FormControl>

              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <InputGroup className="h-11 rounded-lg">
                <FormControl>
                  <InputGroupInput
                    placeholder="请输入密码"
                    type={showPassword && field.value ? "text" : "password"}
                    autoComplete="current-password"
                    className="h-11"
                    {...field}
                    disabled={loading}
                    onChange={(event) => {
                      field.onChange(event);
                      if (!event.target.value) setShowPassword(false);
                    }}
                  />
                </FormControl>
                {field.value && <InputGroupButton
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword(!showPassword)}
                    className="cursor-pointer mr-2"
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </InputGroupButton>}
              </InputGroup>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="remember"
          control={form.control}
          render={({ field}) => (
            <FormItem className="flex items-center gap-2 ml-2 ">
              <FormControl>
                <Checkbox
                  id="remember"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={loading}
                />
              </FormControl>
              <FormLabel htmlFor="remember">记住我</FormLabel>
            </FormItem>
          )}
        />

        <Button type="submit" className="h-11 w-full rounded-lg" disabled={!ready || loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span>登录</span>
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground">需要账号或重置密码，请联系管理员。</p>
      </form>
    </Form>
  );
}
