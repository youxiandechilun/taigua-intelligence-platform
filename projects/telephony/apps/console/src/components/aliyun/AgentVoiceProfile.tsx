/*
 * 中文导读：阿里云连接的 AgentVoiceProfile 组件，封装该界面的展示与交互。
 */
"use client";
import { NativeSelect } from "@/src/components/ui/native-select";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AudioLines, RefreshCw, Save } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Notice } from "./Shared";
import { aliyunApi, type AgentProfile, type CommunicationProfile } from "@/src/lib/api/resources/aliyun";
import { useAliyunConfig, useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { toast } from "@/src/lib/toast";
import { DEFAULT_POLICY, DialPolicyEditor, policyText } from "./CloudSettingsControls";

function ProfileEditor({ agentId, data }: { agentId: string; data: AgentProfile }) {
  const { org } = useAliyunIdentity();
  const config = useAliyunConfig();
  const qc = useQueryClient();
  const [profile, setProfile] = useState(data.profile);
  const patch = (value: Partial<CommunicationProfile>) => setProfile(p => ({ ...p, ...value }));
  const voices = useMutation({ mutationFn: () => aliyunApi.catalog("voices", org) });
  const voice = voices.data?.entries.find(v => v.id === profile.voiceCode);
  const save = useMutation({ mutationFn: () => aliyunApi.saveProfile(agentId, org, { profile, expectedUpdatedAt: data.updatedAt }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["aliyun", "voice-profile"] }); void qc.invalidateQueries({ queryKey: ["agent", agentId] }); toast.success("本智能体设置已保存；电话音色需云端发布后生效"); }, onError: (e: Error) => toast.error(e.message) });
  return <section className="rounded-lg border bg-card p-5 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><AudioLines className="size-4 text-primary" />本智能体通话设置</h2><span className="rounded-md bg-primary/5 px-2 py-1 text-xs text-primary">{data.saved ? "网页设定已保存" : "尚未保存个性设置"}</span></div>
    <div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm">角色性别<NativeSelect aria-label="角色性别" className="h-9 rounded-md border bg-background px-3" value={profile.gender} onChange={e => patch({ gender: e.target.value as CommunicationProfile["gender"] })}><option value="neutral">不指定性别</option><option value="female">女性角色</option><option value="male">男性角色</option></NativeSelect><span className="text-xs leading-5 text-muted-foreground">用于 AI 角色设定；实际声音由下方音色决定。</span></label><label className="grid gap-2 text-sm">回答语言<NativeSelect aria-label="回答语言" className="h-9 rounded-md border bg-background px-3" value={profile.language} onChange={e => patch({ language: e.target.value as CommunicationProfile["language"] })}><option value="zh-CN">中文（普通话）</option><option value="zh-HK">中文（粤语）</option><option value="en">英语</option><option value="auto">跟随客户语言</option></NativeSelect><span className="text-xs leading-5 text-muted-foreground">保存后用于网页文字试聊。开场白也应编辑为对应语言。</span></label></div>
    <div className="rounded-md border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">期望电话音色</h3><Button variant="outline" size="sm" disabled={!config.data?.hasAccessKey || voices.isPending} onClick={() => voices.mutate()}><RefreshCw className="size-3.5" />{voices.isPending ? "查询中…" : "查询阿里云音色"}</Button></div>
      <label className="grid gap-2 text-sm">选择声音<NativeSelect aria-label="选择声音" className="h-9 rounded-md border bg-background px-3" value={profile.voiceCode} onChange={e => { const entry = voices.data?.entries.find(v => v.id === e.target.value); patch({ voiceCode: e.target.value, voiceName: entry?.name || "" }); }}><option value="">跟随云端当前音色</option>{profile.voiceCode && !voice && <option value={profile.voiceCode}>{profile.voiceName || profile.voiceCode}（已保存）</option>}{voices.data?.entries.map(v => <option key={v.id} value={v.id}>{v.name} · {v.type === "SYSTEM" ? "系统音色" : "自定义音色"}</option>)}</NativeSelect></label>
      {!config.data?.hasAccessKey && <p className="text-xs leading-5 text-muted-foreground">尚未保存服务端 AccessKey，暂不能读取阿里云真实音色库。<Link href="/settings/aliyun" className="ml-1 text-primary underline">配置云服务</Link></p>}
      {voices.error && <Notice>{voices.error.message}</Notice>}
      {voice?.sampleUrl ? <div className="space-y-2"><p className="text-xs text-muted-foreground">{voice.name} · 阿里云示例音频</p><audio controls preload="none" src={voice.sampleUrl} className="w-full" /></div> : voice && <p className="text-xs text-muted-foreground">阿里云暂未返回此音色的示例音频。</p>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">已有音色编码，手动填写</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-2">音色编码<Input aria-label="音色编码" value={profile.voiceCode} onChange={e => patch({ voiceCode: e.target.value })} /></label><label className="grid gap-2">音色显示名称<Input aria-label="音色显示名称" value={profile.voiceName} onChange={e => patch({ voiceName: e.target.value })} /></label></div></details>
    </div>
    <div className="space-y-4 rounded-md border p-4"><div><h3 className="text-sm font-medium">本智能体拨打规则</h3></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={!profile.dialPolicyOverride} onChange={e => patch({ dialPolicyOverride: e.target.checked ? null : { ...(config.data?.dialPolicy || DEFAULT_POLICY), days: [...(config.data?.dialPolicy?.days || DEFAULT_POLICY.days)] } })} />使用工作区默认拨打规则</label>{profile.dialPolicyOverride ? <DialPolicyEditor scope="agent" product={config.data?.product || "aiccs"} value={profile.dialPolicyOverride} onChange={dialPolicyOverride => patch({ dialPolicyOverride })} /> : <p className="rounded-md bg-primary/5 p-3 text-xs leading-5 text-primary">{policyText(config.data?.dialPolicy, config.data?.product)}</p>}</div>
    <div className="flex flex-wrap items-start justify-end gap-4"><Button title="角色与语言用于网页演练和导出；电话使用阿里云已发布的声音和拨打规则。" disabled={save.isPending || !data.updatedAt || !config.data} onClick={() => save.mutate()}><Save className="size-4" />{save.isPending ? "保存中…" : "保存本智能体设置"}</Button></div>
  </section>;
}
export function AgentVoiceProfile({ agentId }: { agentId: string }) {
  const { org, user } = useAliyunIdentity();
  const query = useQuery({ queryKey: ["aliyun", "voice-profile", user, org, agentId], queryFn: () => aliyunApi.profile(agentId, org), enabled: !!org, retry: false });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">读取角色与声音…</p>;
  if (query.error) return <Notice>{query.error.message}</Notice>;
  return query.data ? <ProfileEditor key={`${org}:${agentId}:${query.data.updatedAt}`} agentId={agentId} data={query.data} /> : null;
}
