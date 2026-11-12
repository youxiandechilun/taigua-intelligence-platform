/*
 * 中文导读：数字员工配置编辑入口。
 */
"use client";

import Link from "next/link";
import {AgentReleasePanel} from './AgentReleasePanel';
import {useAgentRelease} from '@/src/lib/api/resources/agent-releases';
import dynamic from "next/dynamic";
import { unifiedScript, patchScript, flowText } from "./studio/flow-model";
const AgentDemoPanel=dynamic(()=>import('./AgentDemoPanel').then(m=>m.AgentDemoPanel),{ssr:false,loading:()=> <p className="p-5 text-sm text-muted-foreground">正在加载演示设置…</p>});
const ScenarioEditor = dynamic(()=>import("./studio/ScenarioEditor").then(m=>m.ScenarioEditor),{ssr:false,loading:()=> <p className="p-8 text-sm text-muted-foreground">正在加载话术场景…</p>});
import {EmployeeSipVoice} from "../telephony/EmployeeServices";
import {telephonyApi, type VoiceProfile} from '@/src/lib/api/resources/telephony';
import {PersonalVoiceSettings} from '../telephony/PersonalVoiceSettings';
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, Download, GitCompareArrows, Loader2, RefreshCw, Save, Send, Trash2, UserRound, Phone } from "lucide-react";
import type { Agent } from "@/src/lib/api/types";
import { playbookApi, type ConversationPlaybook, type PlaybookView } from "@/src/lib/api/resources/playbook";
import { aliyunApi, type AgentProfile, type CommunicationProfile } from "@/src/lib/api/resources/aliyun";
import { useCompanyContext } from "@/src/lib/api/resources/company";
import { queryKeys } from "@/src/lib/query-keys";
import { toast } from "@/src/lib/toast";
import { useDeleteAgent, useUpdateAgent } from "@/src/hooks/queries/agents";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { AgentAvatar, AgentIdentity } from "./AgentIdentity";
import { ScriptOverview } from "./studio/ScriptOverview";
import { completeSystemSpeech } from "./studio/SystemSpeechEditor";
import { AgentPreviewPanel } from "./AgentPreviewPanel";
import { BasicFields, Field, AIInstructionFields } from "./employee-editor-forms";
import { EmployeeCallingAccess } from "./EmployeeCallingAccess";
import settingsStyles from "./employee-settings.module.css";
import { download, employeeText, handoffText, profileText, reviewDraft, same, scriptText, validateDraft } from "./employee-editor-model";

const editorTabs = [
  { id: "basic", label: "基础设置", Icon: UserRound },
  { id: "script", label: "话术设计", Icon: GitCompareArrows },
  { id: "demo", label: "演示模式", Icon: Phone },
] as const;
type EditorData = { playbook: PlaybookView; voice: AgentProfile; sip: VoiceProfile; modelId: string };

// Both resources use the same configuration revision. Refuse a mixed snapshot.
async function loadEditor(id: string, org: string): Promise<EditorData> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [playbook, voice, sip, model] = await Promise.all([playbookApi.get(id), aliyunApi.profile(id, org), telephonyApi.profile(org,id), telephonyApi.selection(org,id)]);
    if (playbook.updatedAt === voice.updatedAt) return { playbook, voice, sip:sip.profile, modelId:model.modelId };
  }
  throw new Error("设置正在由其他页面更新，请稍后重新加载。");
}

export function EmployeeEditor({ agent, scriptOnly=false }: { agent: Agent; scriptOnly?:boolean }) {
  const { org, user } = useAliyunIdentity();
  const company=useCompanyContext();
  const training=company.data?.permissions.agentConfiguration?.some(a=>["update","publish"].includes(a));
  const query = useQuery({
    queryKey: ["employee-editor", user, org, agent.agentId],
    queryFn: () => loadEditor(agent.agentId, org), enabled: !!org&&!!training,
    refetchOnWindowFocus: false, refetchOnMount: "always", staleTime: 30000, retry: false,
  });
  if(company.isPending)return <p className="text-sm text-muted-foreground">正在读取权限…</p>;
  if(company.error)return <p role="alert" className="text-sm text-destructive">{company.error.message}</p>;
  if(!training)return <div className="space-y-4"><Link href="/agents" className="text-sm text-primary">返回数字员工</Link><h1 className="text-xl font-semibold">{agent.name}</h1><PersonalVoiceSettings key={user+org+agent.agentId} agentId={agent.agentId}/><AgentReleasePanel agentId={agent.agentId}/><Button asChild variant="outline"><Link href={'/calls?agentId='+agent.agentId}>我的通话记录</Link></Button></div>;
  // A background refresh must keep the mounted editor and its unsaved draft.
  if (query.isPending) return <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">正在加载员工设置…</div>;
  if (!query.data) return <div className="space-y-3 rounded-xl border bg-card p-6"><p role="alert" className="text-sm text-destructive">{query.error?.message || "未能读取员工设置，请稍后重试。"}</p><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>;
  return <Editor key={`${user}:${org}:${agent.agentId}`} agent={agent} initial={query.data} scriptOnly={scriptOnly} />;
}

function Editor({ agent, initial, scriptOnly }: { agent: Agent; initial: EditorData; scriptOnly:boolean }) {
  const id = agent.agentId;
  const { org, user } = useAliyunIdentity();
  const company = useCompanyContext();
  const canEdit = company.data?.permissions.agentConfiguration?.includes("update")===true;
  const release=useAgentRelease(id);
  const qc = useQueryClient();
  const params = useSearchParams(), pathname = usePathname(), router = useRouter();
  const rawTab = params.get("tab") || "script";
  const legacyRuntime = ["runtime", "webhooks", "limits", "advanced", "tools", "training", "knowledge", "handoff", "analysis"].includes(rawTab);
  const current = scriptOnly ? "script" : legacyRuntime || rawTab === "policy" || rawTab === "voice" ? "basic" : ["canvas", "behavior"].includes(rawTab) ? "script" : editorTabs.some(t => t.id === rawTab) ? rawTab : "script";
  
  const update = useUpdateAgent(id);
  const remove = useDeleteAgent();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const needsScriptUpgrade = useRef(initial.playbook.playbook.scriptMode !== "canvas");
  const [saved, setSaved] = useState(() => ({ ...initial, playbook: { ...initial.playbook, playbook: unifiedScript(initial.playbook.playbook) } }));
  const [draft, setDraft] = useState(saved.playbook.playbook);
  const [publishRequest, setPublishRequest] = useState(0);
  const [scopeRequest, setScopeRequest] = useState(0);
  const [profile, setProfile] = useState(initial.voice.profile);
  const [sip, setSip] = useState(initial.sip);
  const [modelId, setModelId] = useState(initial.modelId);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [recordingDirty, setRecordingDirty] = useState(false);
  const [demoDirty,setDemoDirty]=useState(false);
  const [variables, setVariables] = useState(initial.playbook.placeholders);
  const [compareOpen, setCompareOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [leaveHref, setLeaveHref] = useState<string|null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [reloading, setReloading] = useState(false);
  const metadata = draft.employee ?? { description: agent.studioSummary?.description || draft.purpose, business: "", tags: agent.studioSummary?.tags || [] };
  const playbookDirty = !same(draft, saved.playbook.playbook) || !same(variables, saved.playbook.placeholders);
  const voiceDirty = !same(profile, saved.voice.profile);
  const sipDirty = !same({...sip,language:profile.language}, saved.sip);
  const modelDirty = modelId !== saved.modelId;
  const dirty = playbookDirty || voiceDirty || sipDirty || modelDirty;
  const busy = saving || reloading;
  const checks = reviewDraft(draft);
  const variableNames = [...new Set(Array.from(scriptText("", draft, profile, {}).matchAll(/\{\{\s*([A-Za-z_][\w.]*|[\p{L}\p{N}_]+)\s*\}\}/gu), m => m[1]!))];
  const auditionOpening = draft.opening.replace(/\{\{\s*([\w.\p{L}\p{N}_]+)\s*\}\}/gu, (token, name:string) => variables[name]?.trim() || token);

  useEffect(() => {
    if (!dirty && !personalDirty && !recordingDirty && !demoDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty,personalDirty,recordingDirty,demoDirty]);

  const patch = (p: Partial<ConversationPlaybook>) => setDraft(d => patchScript(d, p));
  const patchProfile = (p: Partial<CommunicationProfile>) => setProfile(v => ({ ...v, ...p }));
  const canLeaveRecording = () => {
    if (!recordingDirty&&!demoDirty) return true;
    toast.error(demoDirty?"请先保存演示设置，再离开当前页面。":"请先生成并保存当前开场白或录音，再离开话术设置。");
    return false;
  };
  const requestLeave = (href:string) => {
    if (!canLeaveRecording()) return false;
    if (dirty || personalDirty) { setLeaveHref(href); return false; }
    return true;
  };

  function publishCache(next: EditorData) {
    setSaved(next);
    qc.setQueryData(["employee-editor", user, org, id], next);
    qc.setQueryData(["agents", "playbook", id], next.playbook);
    qc.setQueryData(["aliyun", "voice-profile", user, org, id], next.voice);
    void qc.invalidateQueries({ queryKey: queryKeys.agents.config(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.agents.list() });
    void qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
    void qc.invalidateQueries({ queryKey: ["aliyun", "agent-status"] });
  }

  async function save(override?:ConversationPlaybook): Promise<boolean> {
    const sourceDraft=override||draft;
    const currentDraft={...sourceDraft,systemSpeech:completeSystemSpeech(sourceDraft.systemSpeech)};
    const speechNeedsSave=!same(currentDraft.systemSpeech,sourceDraft.systemSpeech);
    if (!canEdit || busy || saveLock.current) return false;
    if (scriptOnly && (voiceDirty || sipDirty || modelDirty)) { setError("声音、模型和拨打参数由超级管理员维护。"); return false; }
    const problem = validateDraft(currentDraft, profile);
    if (problem) { setError(problem); toast.error(problem); return false; }
    if (!Number.isInteger(sip.audio.noInputSeconds) || sip.audio.noInputSeconds<1 || sip.audio.noInputSeconds>30) { toast.error("无回应等待时间为 1 至 30 秒。"); return false; }
    if (!override && !dirty && saved.playbook.saved && !needsScriptUpgrade.current && !speechNeedsSave) { setError(""); return true; }
    saveLock.current = true; setSaving(true); setError("");
    let next = saved;
    const completed:string[] = [];
    try {
      const [latestSip,latestModel]=await Promise.all([sipDirty?telephonyApi.profile(org,id):null,modelDirty?telephonyApi.selection(org,id):null]);
      if(latestSip&&!same(latestSip.profile,saved.sip))throw new Error("声音设置已在其他页面更新，请读取最新内容后重试。");
      if(latestModel&&latestModel.modelId!==saved.modelId)throw new Error("模型设置已在其他页面更新，请读取最新内容后重试。");
      if (override || playbookDirty || !saved.playbook.saved || needsScriptUpgrade.current || speechNeedsSave) {
        const result = await playbookApi.save(id, { playbook: currentDraft, placeholders: variables, expectedUpdatedAt: next.playbook.updatedAt });
        next = { ...next, playbook: { ...result, agentName: agent.name }, voice: { ...next.voice, updatedAt: result.updatedAt } };
        publishCache(next); completed.push("话术"); needsScriptUpgrade.current = false;
        setDraft(result.playbook); setVariables(result.placeholders);
      }
      if (voiceDirty) {
        const result = await aliyunApi.saveProfile(id, org, { profile, expectedUpdatedAt: next.playbook.updatedAt });
        next = { ...next, playbook: { ...next.playbook, updatedAt: result.updatedAt }, voice: result };
        setProfile(result.profile); publishCache(next); completed.push("角色与规则");
      }
      if(sipDirty){
        const target={...sip,language:profile.language};
        await telephonyApi.saveProfile(org,id,target);
        next={...next,sip:target};setSip(target);publishCache(next);completed.push("声音");
        void qc.invalidateQueries({queryKey:["employee-voice-catalog"]});
        void qc.invalidateQueries({queryKey:["my-voice"]});
      }
      if(modelDirty){await telephonyApi.selectModel(org,id,modelId);next={...next,modelId};publishCache(next);completed.push("模型");}
      void qc.invalidateQueries({queryKey:["agent-release"]});
      toast.success(process.env.NEXT_PUBLIC_LOCAL_PREVIEW === "true" ? "本地草稿已保存" : "公司草稿已保存");
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "保存失败，请稍后再试。";
      const detail=completed.length?`${completed.join("、")}已保存；其余设置未保存：${message}`:message;
      setError(detail);toast.error(detail);
      void qc.invalidateQueries({queryKey:["agent-release"]});
      return false;
    } finally { saveLock.current = false; setSaving(false); }
  }

  async function reload() {
    if (busy) return;
    setReloading(true);
    try {
      const original = await loadEditor(id, org);
      needsScriptUpgrade.current = original.playbook.playbook.scriptMode !== "canvas";
      const result = { ...original, playbook: { ...original.playbook, playbook: unifiedScript(original.playbook.playbook) } };
      setDraft(result.playbook.playbook); setVariables(result.playbook.placeholders); setProfile(result.voice.profile);setSip(result.sip);setModelId(result.modelId);
      publishCache(result); setError(""); setReloadOpen(false);
      toast.success("已读取最新保存内容");
    } catch (e) { setError(e instanceof Error ? e.message : "重新加载失败。"); }
    finally { setReloading(false); }
  }

  function exportDraft() {
    download(`${agent.name}-话术草稿.txt`, scriptText(agent.name, draft, profile, variables));
    toast.success("话术已导出");
  }

  function startChat() {
    setChatOpen(true);
  }

  const savedSections: Array<{ name: string; draft: string; saved: string }> = [
    { name: "基本资料", draft: employeeText(draft), saved: employeeText(saved.playbook.playbook) },
    { name: "身份与目的", draft: draft.identity + "\n" + draft.purpose, saved: saved.playbook.playbook.identity + "\n" + saved.playbook.playbook.purpose },
    { name: "沟通流程", draft: draft.canvas ? flowText(draft.canvas) : "", saved: saved.playbook.playbook.canvas ? flowText(saved.playbook.playbook.canvas) : "" },
    { name: "常见问答", draft: draft.faq.map(r => r.question + "\n" + r.answer).join("\n\n"), saved: saved.playbook.playbook.faq.map(r => r.question + "\n" + r.answer).join("\n\n") },
    { name: "异议处理", draft: draft.objections.map(r => r.trigger + "\n" + r.response).join("\n\n"), saved: saved.playbook.playbook.objections.map(r => r.trigger + "\n" + r.response).join("\n\n") },
    { name: "人工接管", draft: handoffText(draft), saved: handoffText(saved.playbook.playbook) },
    { name: "AI 工作指令", draft: draft.aiInstructions ?? draft.baseInstructions, saved: saved.playbook.playbook.aiInstructions ?? saved.playbook.playbook.baseInstructions },
    { name: "声音与拨打规则", draft: profileText(profile), saved: profileText(saved.voice.profile) },
    { name: "通话声音与音频", draft: JSON.stringify({...sip,language:profile.language},null,2), saved:JSON.stringify(saved.sip,null,2) },
    { name: "演练变量", draft: Object.entries(variables).map(([k,v]) => `${k}：${v}`).join("\n"), saved: Object.entries(saved.playbook.placeholders).map(([k,v]) => `${k}：${v}`).join("\n") },
  ];
  const differences = savedSections.filter(r => r.draft !== r.saved);

  const tools=<>
    <DropdownMenuItem onSelect={exportDraft}><Download className="size-3.5"/>导出话术</DropdownMenuItem>
    <DropdownMenuItem disabled={busy} onSelect={()=>dirty?setReloadOpen(true):void reload()}><RefreshCw className="size-3.5"/>重新加载</DropdownMenuItem>
  </>;
  const saveAction=canEdit&&current==="basic"?<Button size="sm" disabled={busy||(!dirty&&saved.playbook.saved)} onClick={()=>void save()}>{saving?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}{saving?"保存中…":"保存草稿"}</Button>:null;
  const voiceSettings = <EmployeeSipVoice agentId={id} value={{...sip,language:profile.language}} onChange={next=>{setSip(next);patchProfile({language:next.language as CommunicationProfile["language"]});}} onGenderChange={gender=>patchProfile({gender})} disabled={!canEdit||busy} previewText={auditionOpening}/>;
  return <div className="employee-editor flex min-w-0 flex-col gap-4">
    <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <div className="flex min-w-0 items-center gap-3"><Button asChild size="icon-sm" variant="ghost"><Link href="/agents" aria-label="返回数字员工" onClick={event=>{if(!requestLeave('/agents'))event.preventDefault();}}><ArrowLeft className="size-4"/></Link></Button><div className="min-w-0"><h1 className="sr-only">{agent.name} · 员工设置</h1>{canEdit&&!scriptOnly?<AgentIdentity agent={agent} editable/>:<div className="flex items-center gap-3"><AgentAvatar agent={agent}/><h2 className="text-lg font-semibold">{agent.name}</h2></div>}</div>{canEdit&&<Button asChild size="sm" variant="outline"><Link href={`/agents/${id}?scope=personal`} onClick={event=>{if(!requestLeave(`/agents/${id}?scope=personal`))event.preventDefault();}}>选择声音</Link></Button>}</div>
      <AgentReleasePanel agentId={id} publishRequest={publishRequest} scopeRequest={scopeRequest} hidePublishAction={current!=="basic"} hideStatus={current!=="basic"} hideMenu hideUseAction dirty={dirty} saving={saving} savedAt={saved.playbook.updatedAt} onSave={canEdit?()=>save():undefined} saveAction={saveAction}/>
    </header>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><span>{error}</span><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={exportDraft}>导出当前草稿</Button><Button variant="outline" size="sm" onClick={() => setReloadOpen(true)}>读取最新内容</Button></div></div>}
    <div className="min-w-0">
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <Tabs value={current} onValueChange={value => { if(value!==current&&!canLeaveRecording())return; const next = new URLSearchParams(params); next.set("tab", value); router.replace(`${pathname}?${next}`, { scroll: false }); }} className="gap-0">
          <div className="overflow-x-auto border-b px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="设置页签区域">
            <TabsList aria-label="数字员工设置" className="h-11! w-max min-w-full justify-start gap-0 bg-transparent p-0">
              {editorTabs.filter(tab=>!scriptOnly||tab.id==='script').map(({ id: tabId, label, Icon }) => <TabsTrigger key={tabId} value={tabId} className="h-11! flex-none gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-2.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none after:hidden"><Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.9} /><span>{label}</span></TabsTrigger>)}
            </TabsList>
          </div>
          {!scriptOnly&&<TabsContent forceMount value="basic" className="m-0 p-5 data-[state=inactive]:hidden">
            <div className={settingsStyles.settings}><div className={settingsStyles.basicGrid}>
              <div className={settingsStyles.profile}>
                <fieldset disabled={!canEdit || busy} className="min-w-0"><BasicFields metadata={metadata} onChange={employee => patch({ employee })} active={agent.isActive} activeBusy={update.isPending} onActiveChange={isActive => update.mutate({ isActive })} /></fieldset>
              </div>
              <div className={settingsStyles.basicOptions}>
              {voiceSettings}
              <EmployeeCallingAccess value={profile.dialPolicyOverride} onChange={dialPolicyOverride=>patchProfile({dialPolicyOverride})} disabled={!canEdit||busy} scopeDisabled={busy}
                scopeLabel={release.data?.audience?.allEmployees ? "全公司员工可使用" : release.data?.audience ? `${release.data.audience.departmentIds.length} 个部门 · ${release.data.audience.userIds.length} 位指定员工` : "正在读取使用范围…"}
                onScope={release.data?.canPublish&&company.data?.allData ? ()=>setScopeRequest(n=>n+1) : undefined}/>
              </div>
            </div></div>
            <fieldset disabled={!canEdit||busy} className="min-w-0"><AIInstructionFields draft={draft} patch={patch}/></fieldset>
            {canEdit && <div className={settingsStyles.footer}><Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="size-3.5" />删除数字员工</Button></div>}
          </TabsContent>}
          {!scriptOnly&&<TabsContent forceMount value="demo" className="m-0 data-[state=inactive]:hidden">{current==="demo"&&<AgentDemoPanel agentId={id} defaultOpening={draft.opening} onDirtyChange={setDemoDirty}/>}</TabsContent>}
          <TabsContent value="script" className="m-0">{draft.canvas&&<ScenarioEditor
            recordingScope={user&&org&&id?JSON.stringify(["script-recordings-v1",user,org,id,"template"]):""}
            previewVoiceProfile={{...sip,language:profile.language}}
            onRecordingDirtyChange={setRecordingDirty}
            employeeName={agent.name} playbook={draft} canEdit={canEdit} busy={busy} dirty={dirty||needsScriptUpgrade.current||!saved.playbook.saved}
            savedAt={saved.playbook.updatedAt} initialView={rawTab==="behavior"?"overview":"cards"}
            onChange={patch} onSave={save} onRehearse={startChat} menuItems={tools}
            publishAction={release.data?.canPublish?<Button size="sm" disabled={busy||release.isPending||Boolean(release.error)||(!dirty&&!needsScriptUpgrade.current&&!release.data.hasUnpublishedChanges)} onClick={()=>setPublishRequest(n=>n+1)}><Send className="size-3.5"/>发布话术</Button>:undefined}
            onCompare={()=>setCompareOpen(true)}
            checkContent={<section className="space-y-3 border-t pt-4"><h3 className="text-sm font-medium">内容与合规提示</h3><p className="text-xs leading-5 text-muted-foreground">基础规则供人工复核，不代表运营商审核通过。</p>{checks.map(c=><div key={c.label} className={`flex items-start gap-3 rounded-lg border p-3 ${c.ok?"":"border-amber-200 bg-amber-50/50 dark:bg-amber-950/10"}`}>{c.ok?<Check className="mt-0.5 size-4 shrink-0 text-primary"/>:<CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600"/>}<div><p className="text-sm font-medium">{c.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{c.detail}</p></div></div>)}</section>}
            globalContent={<div className="space-y-5">
              {scriptOnly?<AIInstructionFields draft={draft} patch={patch}/>:<p className="text-sm text-muted-foreground">AI 身份、沟通要求和限制请在基础设置中修改。</p>}
              <Field label="本次通话目标"><Textarea rows={3} maxLength={1000} value={draft.purpose} onChange={e=>patch({purpose:e.target.value})}/></Field>

              {variableNames.length>0&&<details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">演练变量（{variableNames.length} 项）</summary><div className="mt-4 grid gap-4">{variableNames.map(name=><Field key={name} label={name}><Input value={variables[name]||""} maxLength={4000} placeholder="填写演练示例" onChange={e=>setVariables(v=>({...v,[name]:e.target.value}))}/></Field>)}</div></details>}
            </div>}
            renderOverview={(onLocate,onGlobals)=><ScriptOverview playbook={draft} onLocate={onLocate} onGlobals={onGlobals} onExport={exportDraft} onCopy={()=>{void navigator.clipboard.writeText(scriptText(agent.name,draft,profile,variables)).then(()=>toast.success("已复制当前话术"),()=>toast.error("复制失败，请使用导出"));}}/>}
          />}</TabsContent>
        </Tabs>
        {variableNames.length > 0 && ["basic"].includes(current) && <details className="mx-5 mb-5 rounded-lg border p-3.5"><summary className="cursor-pointer text-sm font-medium">演练变量（{variableNames.length} 项）</summary><fieldset disabled={!canEdit || busy} className="mt-4 grid gap-4 sm:grid-cols-2">{variableNames.map(name => <Field key={name} label={name}><Input value={variables[name] || ""} maxLength={4000} placeholder="填写演练示例，真实客户值由任务提供" onChange={e => setVariables(v => ({ ...v, [name]: e.target.value }))} /></Field>)}</fieldset></details>}
      </section>
    </div>

    <Dialog open={!!leaveHref} onOpenChange={open=>{if(!open)setLeaveHref(null);}}><DialogContent><DialogHeader><DialogTitle>有尚未保存的修改</DialogTitle><DialogDescription>保存后再离开，或放弃本次修改。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setLeaveHref(null)}>返回编辑</Button><Button onClick={()=>{if(leaveHref)router.push(leaveHref);}}>放弃修改并离开</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>话术对比</DialogTitle><DialogDescription>查看当前修改、已保存内容和电话正在使用的话术。</DialogDescription></DialogHeader>
      <section className="space-y-3"><h3 className="text-sm font-semibold">当前草稿与已保存内容</h3><p className="text-xs text-muted-foreground">{differences.length ? `${differences.length} 处内容存在修改` : "当前草稿与已保存内容一致"}</p>{differences.map(row => <details key={row.name} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium text-primary">{row.name}有修改</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded border bg-muted/15 p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">已保存内容</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{row.saved || "未填写"}</pre></div><div className="rounded border border-primary/15 bg-primary/5 p-3"><p className="mb-2 text-xs font-medium text-primary">当前编辑内容</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{row.draft || "未填写"}</pre></div></div></details>)}</section>
      <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">正式版本</h3><p className="text-sm">{release.data?.version?'当前设置已发布':'尚未发布'}</p><p className="text-xs text-muted-foreground">新建任务固定使用正式版本。已创建任务不会随培训草稿或后续发布发生变化。</p></section><DialogFooter><Button variant="outline" onClick={() => setCompareOpen(false)}>关闭</Button><Button onClick={exportDraft}><Download className="size-4" />导出当前草稿</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={reloadOpen} onOpenChange={setReloadOpen}><DialogContent><DialogHeader><DialogTitle>重新读取已保存内容？</DialogTitle><DialogDescription>当前未保存的修改会被替换。可先导出话术草稿，或下载完整草稿备份。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => download(`${agent.name}-员工设置草稿.json`, JSON.stringify({ playbook: draft, profile, voice:{...sip,language:profile.language}, modelId, placeholders: variables }, null, 2), "application/json")}>备份完整草稿</Button><Button disabled={busy} onClick={() => void reload()}>{reloading ? "读取中…" : "读取最新内容"}</Button></DialogFooter></DialogContent></Dialog>
    {chatOpen&&<AgentPreviewPanel agentId={id} agentName={agent.name} playbook={draft} placeholders={variables} open={chatOpen} onOpenChange={setChatOpen} />}
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这位数字员工？</AlertDialogTitle><AlertDialogDescription>将删除 {agent.name}，并解除电话号码、工具与知识库关联。此操作无法撤销，请确认后操作。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => { try { await remove.mutateAsync(id); router.push("/agents"); } catch { /* Existing mutation reports the error. */ } }}>{remove.isPending ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
