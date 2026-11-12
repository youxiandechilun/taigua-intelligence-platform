/*
 * 中文导读：设置中心的 PlatformBrandingSettings 组件，封装该界面的展示与交互。
 */
"use client";
import { RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { platformBrandingApi, usePlatformBranding, type PlatformBranding } from "@/src/lib/api/resources/platform-branding";
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/ui/button";
import { toast } from "@/src/lib/toast";

export function PlatformBrandingSettings() {
  const query = usePlatformBranding();
  if (query.isLoading) return <p className="text-sm text-muted-foreground">正在加载登录页设置…</p>;
  if (query.error || !query.data) return <div role="alert" className="space-y-3"><p>登录页设置加载失败，请重试。</p><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>;
  return <BrandingForm key={query.data.loginSlogan} initial={query.data} />;
}
function BrandingForm({ initial }: { initial: PlatformBranding }) {
  const [slogan, setSlogan] = useState(initial.loginSlogan);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const value = slogan.trim();
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await platformBrandingApi.save({ loginSlogan: value });
      client.setQueryData(["platform-branding"], result);
      toast.success("登录页标语已保存，刷新登录页即可看到。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-6 rounded-lg border bg-card p-6">
    <div><h2 className="text-lg font-semibold">公共登录页设置</h2></div>
    <form onSubmit={save} className="space-y-5">
      <label className="grid gap-2 text-sm font-medium">Logo 下方标语<Input value={slogan} onChange={event => setSlogan(event.target.value)} maxLength={120} required disabled={busy} /></label>
      <div className="rounded-md border bg-white p-6 text-stone-500"><Image src="/brand/taigua-logo.png" alt="泰卦传媒" width={1848} height={266} className="h-auto w-64 max-w-full" /><p className="mt-2 text-sm leading-6 break-words">{value || "标语预览"}</p></div>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !value || value === initial.loginSlogan}><Save aria-hidden="true" className="size-4" />{busy ? "正在保存…" : "保存登录页标语"}</Button><Button asChild variant="outline"><Link href="/login" target="_blank" rel="noopener noreferrer">查看登录页</Link></Button></div>
    </form>
  </section>;
}
