/*
 * 中文导读：表单的 CreateOrg 组件，封装该界面的展示与交互。
 */
"use client";

import { userMessage } from "@/src/lib/locale";

import Link from "next/link";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
 FormField,
 FormItem,
 FormLabel,
 FormControl,
 FormMessage,
} from "@/src/components/ui/form";
import { toast } from "@/src/lib/toast";
import { authClient } from "@/src/lib/auth-client";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createOrgSchema } from "@/src/models/orgs/createOrgsSchema";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { clearIdentityCache } from "@/src/lib/query-cache";




export default function Orgs() {
 const router = useRouter();
 const queryClient = useQueryClient();
 const [loading, setLoading] = useState(false);
 const [createdId, setCreatedId] = useState<string | null>(null);
 const [error, setError] = useState<string | null>(null);
 const form = useForm<z.infer<typeof createOrgSchema>>({
 resolver: zodResolver(createOrgSchema),
 defaultValues: {
 name: "",
 },
 });

 const onSubmit = async (values: z.infer<typeof createOrgSchema>) => {
 try {
 setLoading(true);
 setError(null);
 let workspaceId = createdId;
 if (!workspaceId) {
 const { data, error } = await authClient.organization.create({
 name: values.name,
 slug: `workspace-${crypto.randomUUID()}`,
 keepCurrentActiveOrganization: true,
 });
 if (error || !data?.id) {
 const message = userMessage(error?.message || "工作区未创建，请重试。", error?.code);
 toast.error(message); setError(message); return;
 }
 workspaceId = data.id;
 setCreatedId(workspaceId);
 }
 const { error: activationError } = await authClient.organization.setActive({
 organizationId: workspaceId,
 });
 if (activationError) {
 const message = userMessage(activationError.message || "工作区已创建，但暂时无法打开", activationError.code);
 toast.error(message);
 setError(message);
 return;
 }
 clearIdentityCache(queryClient);
 toast.success("工作区创建成功");
 router.push("/dashboard");
 router.refresh();
 } catch (err) {
 const message =
 err instanceof Error ? userMessage(err.message) : "无法创建工作区";
 toast.error(message);
 setError(message);
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-10 max-w-lg mx-auto">
 <Link
 href="/orgs"
 className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
 >
 <ArrowLeft className="h-4 w-4" />
 返回工作区列表
 </Link>

 <div className="border border-border bg-card p-6 sm:p-8">
 <div className="flex h-12 w-12 items-center justify-center bg-primary/10 text-primary mb-5">
 <Building2 className="h-6 w-6" />
 </div>
 <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-1">
 创建工作区
 </h1>
 

 <FormProvider {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
 {error ? (
 <p className="text-sm font-medium text-destructive">{error}</p>
 ) : null}
 <FormField
 control={form.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel>工作区名称</FormLabel>
 <FormControl>
 <Input placeholder="例如：外贸业务 / 国内客户" className="h-10" maxLength={80} disabled={loading || !!createdId} {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <div className="pt-2">
 <Button type="submit" disabled={loading || form.formState.isSubmitting} className="w-full h-10">
 {loading || form.formState.isSubmitting ? (
 <>
 <Loader2 className="h-4 w-4 animate-spin mr-2" />
 创建中…
 </>
 ) : (
 (createdId ? "打开已创建的工作区" : "创建工作区")
 )}
 </Button>
 </div>
 </form>
 </FormProvider>
 </div>
 </div>
 );
}
