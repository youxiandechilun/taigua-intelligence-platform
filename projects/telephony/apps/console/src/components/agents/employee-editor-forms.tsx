/*
 * 中文导读：数字员工与话术的 employee-editor-forms 组件，封装该界面的展示与交互。
 */
"use client";

import { NativeSelect } from "@/src/components/ui/native-select";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAliyunIdentity } from "@/src/hooks/queries/aliyun";
import { BookOpen, Headset, MessageSquareText, Plus, Tag, X, Pencil, Search, Users, MessageCircle } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Switch } from "@/src/components/ui/switch";
import { companyApi, useCompanyContext, useCompanyUnits, unitLabel, hasCompanyPermission } from "@/src/lib/api/resources/company";
import type { ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { rowId } from "./employee-editor-model";
import styles from "./employee-settings.module.css";

type PlaybookProps = { draft: ConversationPlaybook; patch: (p: Partial<ConversationPlaybook>) => void };

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label title={hint} className="grid min-w-0 gap-2 text-sm font-medium">
    <span>{label}</span>{children}
  </label>;
}

export function PanelHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-3" title={description}>
    <div><h2 className="text-base font-semibold">{title}</h2></div>{action}
  </header>;
}

function Remove({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" size="icon" variant="ghost" className="size-6 shrink-0 text-muted-foreground hover:text-destructive" aria-label={label} onClick={onClick} disabled={disabled}><X className="size-3.5" /></Button>;
}

export function aiWorkInstructions(p: ConversationPlaybook) {
  return p.aiInstructions ?? [p.identity ? '你的身份：'+p.identity : '',p.baseInstructions,p.conversationRules?.forbiddenAnswers ? '禁止回答与承诺：'+p.conversationRules.forbiddenAnswers : '',p.conversationRules?.hangupConditions ? '结束通话条件：'+p.conversationRules.hangupConditions : ''].filter(Boolean).join('\n\n');
}

export function AIInstructionFields({draft,patch}:PlaybookProps) {
  return <section className="mt-5 space-y-3 border-t pt-5" aria-label="AI 身份与规则">
    <h3 className="text-sm font-semibold">AI 身份与规则</h3>
    <Field label="AI 工作指令" hint="实际用于 AI 对话：说明身份、任务、回答范围、限制和结束条件。"><Textarea required aria-label="AI 工作指令" rows={10} maxLength={30000} className="resize-y font-normal leading-6" value={aiWorkInstructions(draft)} onChange={e=>patch({aiInstructions:e.target.value})}/></Field>
    <p className="text-xs text-muted-foreground">保存并发布后，所有账号的新测试电话和新建外呼任务使用此指令。</p>
  </section>;
}

export function BasicFields({ metadata, onChange, active, onActiveChange, activeBusy }: {
  metadata: NonNullable<ConversationPlaybook["employee"]>;
  onChange: (m: NonNullable<ConversationPlaybook["employee"]>) => void;
  active: boolean; onActiveChange: (active: boolean) => void; activeBusy: boolean;
}) {
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [tagName, setTagName] = useState("");
  function add() {
    const value = newTag.trim();
    if (!value) return;
    if (metadata.tags.length >= 20) { setTagError("最多设置 20 个标签。"); return; }
    if (metadata.tags.includes(value)) { setTagError("这个标签已存在。"); return; }
    onChange({ ...metadata, tags: [...metadata.tags, value] });
    setNewTag(""); setTagError("");
  }
  function rename() {
    const value = tagName.trim();
    if (editing === null || !value) return;
    if (metadata.tags.some((v, i) => i !== editing && v === value)) { setTagError("这个标签已存在。"); return; }
    onChange({ ...metadata, tags: metadata.tags.map((v, i) => i === editing ? value : v) });
    setEditing(null); setTagError("");
  }
  return <div className="space-y-4">
    <Field label="员工简介" hint="显示在名称下方，方便团队了解这位数字员工的职责。">
      <Textarea rows={3} className="min-h-24 font-normal leading-6" maxLength={1000} value={metadata.description} onChange={e => onChange({ ...metadata, description: e.target.value })} />
    </Field>
    <section className="space-y-3 border-t pt-4" aria-label="员工标签管理">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Tag className="size-4 text-primary" />员工标签</h3>
      
      <div className="flex flex-wrap gap-2">{metadata.tags.map((tag, i) => <span key={`${tag}-${i}`} className="inline-flex items-center rounded-md border border-primary/15 bg-primary/5 px-2 py-1 text-xs text-primary">
        <button type="button" className="px-1 focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setEditing(i); setTagName(tag); }} aria-label={`重命名标签${tag}`}>{tag}</button>
        <button type="button" className="ml-1 rounded p-0.5 hover:bg-primary/10" onClick={() => { onChange({ ...metadata, tags: metadata.tags.filter((_, n) => n !== i) }); setEditing(null); }} aria-label={`移除标签${tag}`}><X className="size-3" /></button>
      </span>)}</div>
      {editing !== null && <div className="flex max-w-md gap-2"><Input aria-label="新的标签名称" maxLength={30} value={tagName} onChange={e => setTagName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); rename(); } }} /><Button size="sm" type="button" onClick={rename}><Pencil aria-hidden="true" className="size-4" />确认修改</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>取消</Button></div>}
      <div className="flex gap-2"><Input aria-label="新增员工标签" maxLength={30} value={newTag} placeholder="输入标签名称" onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /><Button type="button" variant="outline" onClick={add} disabled={!newTag.trim()}><Plus className="size-4" />添加标签</Button></div>
      {tagError && <p role="alert" className="text-xs text-destructive">{tagError}</p>}
    </section>
  </div>;
}

export function GlobalScriptFields({ draft: p, patch }: PlaybookProps) {
  return <div className="@container space-y-5">
    <div className="grid gap-4">
      <Field label="身份介绍"><Input maxLength={300} value={p.identity} onChange={e => patch({ identity: e.target.value })} /></Field>
      <Field label="联系目的"><Textarea rows={3} maxLength={1000} value={p.purpose} onChange={e => patch({ purpose: e.target.value })} /></Field>
    </div>
    <section className="space-y-3 border-t pt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" />常见问答</h3>
      <div className="grid items-start gap-3 @min-[620px]:grid-cols-2">
        {p.faq.map((row, i) => <article key={row.id} className="space-y-3 rounded-lg border bg-muted/15 p-3.5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">问答 {i + 1}</span><Remove label={`删除问答${i + 1}`} onClick={() => patch({ faq: p.faq.filter(r => r.id !== row.id) })} /></div>
          <Field label="客户问题"><Input maxLength={1000} value={row.question} onChange={e => patch({ faq: p.faq.map(r => r.id === row.id ? { ...r, question: e.target.value } : r) })} className="bg-background" /></Field>
          <Field label="对应回答"><Textarea rows={3} maxLength={6000} value={row.answer} onChange={e => patch({ faq: p.faq.map(r => r.id === row.id ? { ...r, answer: e.target.value } : r) })} className="min-h-24 bg-background leading-6" /></Field>
        </article>)}
      </div>
      {!p.faq.length && <p className="text-xs text-muted-foreground">暂无问答</p>}
      <Button type="button" size="sm" variant="outline" disabled={p.faq.length >= 100} onClick={() => patch({ faq: [...p.faq, { id: rowId(), question: "", answer: "" }] })}><Plus className="size-3.5" />添加问答</Button>
    </section>
    <section className="space-y-3 border-t pt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-primary" />异议处理</h3>
      <div className="grid items-start gap-3 @min-[620px]:grid-cols-2">
        {p.objections.map((row, i) => <article key={row.id} className="space-y-3 rounded-lg border bg-muted/15 p-3.5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">场景 {i + 1}</span><Remove label={`删除异议场景${i + 1}`} onClick={() => patch({ objections: p.objections.filter(r => r.id !== row.id) })} /></div>
          <Field label="客户情况"><Input maxLength={1000} value={row.trigger} onChange={e => patch({ objections: p.objections.map(r => r.id === row.id ? { ...r, trigger: e.target.value } : r) })} className="bg-background" /></Field>
          <Field label="回应话术"><Textarea rows={3} maxLength={4000} value={row.response} onChange={e => patch({ objections: p.objections.map(r => r.id === row.id ? { ...r, response: e.target.value } : r) })} className="min-h-24 bg-background leading-6" /></Field>
        </article>)}
      </div>
      {!p.objections.length && <p className="text-xs text-muted-foreground">暂无异议处理</p>}
      <Button type="button" size="sm" variant="outline" disabled={p.objections.length >= 50} onClick={() => patch({ objections: [...p.objections, { id: rowId(), trigger: "", response: "" }] })}><Plus className="size-3.5" />添加场景</Button>
    </section>
    <details className="rounded-lg border p-3.5"><summary className="cursor-pointer text-sm font-medium">补充约束与原有业务要求</summary><Field label="补充要求" hint="保留已有约束；不要在这里填写服务密钥。"><Textarea className="mt-3 leading-6" rows={5} maxLength={30000} value={p.baseInstructions} onChange={e => patch({ baseInstructions: e.target.value })} /></Field></details>
  </div>;
}

export function HandoffFields({ draft: p, patch, personal = false }: PlaybookProps & {personal?:boolean}) {
  const directory = useCompanyContext();
  const {user} = useAliyunIdentity();
  const units = useCompanyUnits(directory.data);
  const canAssignOthers = hasCompanyPermission(directory.data, "crm", "assign");
  const canAssign = personal || canAssignOthers;
  const org = directory.data?.organizationId;
  const members = useQuery({queryKey:["company-members", user, org, "handoff"],queryFn:()=>companyApi.members(org!),enabled:Boolean(user&&org&&canAssign&&directory.data?.canManageMembers),refetchOnWindowFocus:true});
  const [department, setDepartment] = useState("all");
  const [staffKeyword, setStaffKeyword] = useState("");
  const availableStaff = members.data ? members.data.filter(member=>member.enabled&&!member.deletedAt).map(member=>({id:member.userId,name:member.name,role:member.roleName,department:member.department})) : directory.data?.assignees ?? [];
  const staff = personal && !canAssignOthers ? availableStaff.filter(member=>member.id===user) : availableStaff;
  const selected = staff.find(member => member.id === p.handoff.assigneeUserId);
  const organization = units.data ?? [];
  const departments = organization.length ? organization.map(unit=>[unit.id,unitLabel(unit,organization)] as const).sort((a,b)=>a[1].localeCompare(b[1],"zh-CN")) : Array.from(new Map(staff.filter(member=>member.department).map(member=>[member.department!.id,member.department!.name])).entries());
  const allowedDepartments = new Set([department]);
  for(let changed=true;changed;){changed=false;for(const unit of organization)if(unit.parentId&&allowedDepartments.has(unit.parentId)&&!allowedDepartments.has(unit.id)){allowedDepartments.add(unit.id);changed=true;}}
  const staffLabel=(member:typeof staff[number])=>[member.name,member.department?departments.find(([id])=>id===member.department?.id)?.[1]||member.department.name:"公司直属",({owner:"公司负责人",admin:"公司管理员",member:"员工"} as Record<string,string>)[member.role]??member.role].join(" · ");
  const candidates = staff.filter(member => (department === "all" || allowedDepartments.has(member.department?.id ?? "direct")) && (!staffKeyword.trim() || staffLabel(member).toLocaleLowerCase().includes(staffKeyword.trim().toLocaleLowerCase())));
  const peopleLoading=directory.isPending||members.isPending&&members.fetchStatus!=="idle"||units.isPending&&units.fetchStatus!=="idle";
  const peopleError=directory.error||members.error||units.error;
  const update = (data: Partial<ConversationPlaybook["handoff"]>) => patch({ handoff: { ...p.handoff, ...data } });
  return <div className={styles.settings}>
    <header className={styles.handoffHeader}><h2 className={styles.sectionHeading}><Headset aria-hidden="true"/>人工接管</h2><label className="flex items-center gap-2.5 text-xs"><Switch checked={p.handoff.enabled} onCheckedChange={enabled=>update({enabled})} aria-label="启用人工接管话术"/>{p.handoff.enabled ? "已启用" : "未启用"}</label></header>
    <div className={styles.handoffGrid}>
      <div><h3 className={styles.sectionHeading}><MessageCircle aria-hidden="true"/>触发与话术</h3><div className={styles.handoffFields}>
        <Field label="什么时候需要接管" hint="例如：客户要求人工、投诉、合同和退款、无法确认的问题。"><Textarea rows={5} maxLength={6000} value={p.handoff.rules} onChange={e => update({ rules: e.target.value })} /></Field>
        <Field label="怎样告知客户"><Textarea rows={4} maxLength={2000} value={p.handoff.response} onChange={e => update({ response: e.target.value })} /></Field>
      </div></div>
      <div className={styles.handoffPeople}><h3 className={styles.sectionHeading}><Users aria-hidden="true"/>接管人员</h3><div className={styles.handoffFields}>
        <Field label="按组织筛选"><NativeSelect className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={department} disabled={!canAssign || peopleLoading} onChange={e => setDepartment(e.target.value)}><option value="all">全部授权组织</option><option value="direct">公司直属</option>{departments.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</NativeSelect></Field>
        <label className="grid gap-2 text-sm font-medium">搜索员工<div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input aria-label="搜索接管员工" placeholder="输入员工姓名或职位" className="pl-9 font-normal" value={staffKeyword} disabled={!canAssign || peopleLoading || Boolean(peopleError)} onChange={e=>setStaffKeyword(e.target.value)}/></div></label>
        <Field label="接管负责人"><NativeSelect className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={p.handoff.assigneeUserId ?? ""} disabled={!canAssign || peopleLoading || Boolean(peopleError)} onChange={e => { const member = staff.find(row => row.id === e.target.value); update({ assigneeUserId: member?.id ?? null, target: member ? [member.department?.name, member.name].filter(Boolean).join(" / ") : "" }); }}>
          <option value="">跟随客户负责人或任务发起人</option>
          {p.handoff.assigneeUserId && !selected && <option value={p.handoff.assigneeUserId}>原负责人已不在当前可选范围</option>}
          {selected && !candidates.some(member => member.id === selected.id) && <option value={selected.id}>{staffLabel(selected)}</option>}
          {candidates.map(member => <option value={member.id} key={member.id}>{staffLabel(member)}</option>)}
        </NativeSelect></Field>
        {peopleError && <button type="button" className="text-sm text-destructive underline" onClick={() => {void directory.refetch();void units.refetch();if(directory.data?.canManageMembers)void members.refetch();}}>组织或人员加载失败，点击重试</button>}
        {!!staffKeyword.trim() && !candidates.length && <p className="text-xs text-muted-foreground">当前组织未找到匹配员工。</p>}
        
      </div><p className={styles.note}>不指定时，跟随客户负责人或任务发起人。组织筛选包含下级部门，仅用于查找员工。</p>
      </div>
    </div>
    <p className={styles.note}>通话后分配人工处理；实时电话转接需线路支持。</p>
  </div>;
}
