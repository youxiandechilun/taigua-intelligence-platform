/*
 * 中文导读：数字员工与话术的 ScenarioEditor 组件，封装该界面的展示与交互。
 */
"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, BookOpenText, Check, CircleHelp, Flag, GitCompareArrows, LayoutGrid, List, Loader2, MessageCircle, MessageSquareText, MoreHorizontal, PencilLine, Plus, Save, Search, Settings2, ShieldCheck, Trash2, Undo2, X } from "lucide-react";
import type { ConversationPlaybook, FlowGraph, FlowNode } from "@/src/lib/api/resources/playbook";
import type { VoiceProfile } from "@/src/lib/api/resources/telephony";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { NativeSelect } from "@/src/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/src/components/ui/dropdown-menu";
import { Field } from "../employee-editor-forms";
import { deleteFlowNode, flowBranches, inspectFlow, putBranch } from "./flow-model";
import { ScenarioPreview } from "./ScenarioPreview";
import { responseLabel, scenarioItems, scenarioKinds, scenarioOutcomes, type ScenarioGroup, type ScenarioItem } from "./scenario-model";
import styles from "./scenario-editor.module.css";
import { SimpleScriptEditor } from "./SimpleScriptEditor";

export type ScenarioEditorProps = {
  recordingScope: string;
  previewVoiceProfile?: VoiceProfile;
  employeeName: string;
  playbook: ConversationPlaybook;
  canEdit: boolean;
  busy: boolean;
  dirty: boolean;
  savedAt: string | null;
  initialView?: "cards" | "overview";
  onChange: (patch: Partial<ConversationPlaybook>) => void;
  onRecordingDirtyChange?: (dirty: boolean) => void;
  onSave: (playbook?: ConversationPlaybook) => Promise<boolean>;
  saveLabel?: string;
  savedLabel?: string;
  onRehearse: () => void;
  globalContent: ReactNode;
  menuItems?: ReactNode;
  publishAction?: ReactNode;
  checkContent?: ReactNode;
  onCompare?: () => void;
  renderOverview: (onLocate: (id: string) => void, onGlobals: () => void) => ReactNode;
};
type NextScene = { sourceId: string; branch: string; condition: string; edgeId?: string };
const groups = [
  { id: "steps", label: "通话顺序", detail: "从开场到业务沟通", description: "从上到下查看主要沟通步骤；客户回应决定实际下一步。", Icon: List },
  { id: "faq", label: "常见问题", detail: "客户随时可能提问", description: "这些问题在通话中随时可能出现，回答后继续当前步骤。", Icon: CircleHelp },
  { id: "objections", label: "异议应对", detail: "忙碌、顾虑与拒绝", description: "针对客户明确表达的情况作回应；明确拒绝时礼貌结束。", Icon: MessageCircle },
  { id: "endings", label: "结束处理", detail: "结束话术与结果标记", description: "不同回应对应不同结束方式，意向结果在这里设置。", Icon: Flag },
] as const;
const newTypes = [
  { id: "step", title: "沟通步骤", detail: "开场、提问与业务介绍", Icon: MessageSquareText },
  { id: "faq", title: "客户提问", detail: "客户可能问到的问题", Icon: CircleHelp },
  { id: "objection", title: "客户异议", detail: "忙碌、顾虑与拒绝的回应", Icon: MessageCircle },
  { id: "ending", title: "结束处理", detail: "结束话术与意向标记", Icon: Flag },
] as const;

function cardIcon(item: ScenarioItem) {
  return item.group === "endings" ? Flag : item.source === "faq" ? CircleHelp : item.source === "objection" ? MessageCircle : MessageSquareText;
}

export function ScenarioEditor(props: ScenarioEditorProps) {
  const [advanced, setAdvanced] = useState(false);
  if (!advanced) return <SimpleScriptEditor {...props} onAdvanced={() => setAdvanced(true)} />;
  return <><div className="flex items-center justify-between gap-3 border-b px-5 py-2 text-xs text-muted-foreground"><span>高级流程：保存后按节点和分支执行</span><Button size="sm" variant="ghost" onClick={() => setAdvanced(false)}>返回简单编辑</Button></div><AdvancedScenarioEditor {...props} onSave={override=>props.onSave({...(override || props.playbook),conversationMode:"flow"})} /></>;
}

function AdvancedScenarioEditor({ employeeName, playbook: p, canEdit, busy, dirty, savedAt, initialView = "cards", onChange, onSave, saveLabel, savedLabel, onRehearse, globalContent, menuItems, publishAction, checkContent, onCompare, renderOverview }: ScenarioEditorProps) {
  const graph = p.canvas!;
  const items = scenarioItems(p);
  const [view, setView] = useState<"cards" | "overview">(initialView);
  const [group, setGroup] = useState<ScenarioGroup>("steps");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("step:" + graph.entry);
  const [panel, setPanel] = useState<"edit" | "preview">("edit");
  const [globalOpen, setGlobalOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState<(typeof newTypes)[number]["id"]>("step");
  const [newTitle, setNewTitle] = useState("");
  const [createFrom, setCreateFrom] = useState<NextScene | null>(null);
  const [removeItem, setRemoveItem] = useState<ScenarioItem | null>(null);
  const [undo, setUndo] = useState<Partial<ConversationPlaybook> | null>(null);
  const [typeChange, setTypeChange] = useState<{ id: string; kind: FlowNode["kind"] } | null>(null);
  const visible = items.filter(item => (item.group === group) && `${item.title} ${item.text}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = visible.find(item => item.key === selectedKey) || visible[0];
  const currentGroup = groups.find(g => g.id === group)!;
  const selectedNode = selected?.source === "step" ? graph.nodes.find(n => n.id === selected.id) : undefined;
  const openingRecording=p.recordingReplies?.entries['opening-recordings'];
  const recordedOpening=!!openingRecording&&openingRecording.mode==='recording-first'&&openingRecording.clips.some(clip=>!!(clip.voiceId||p.recordingReplies?.voiceId)&&(openingRecording.openingPlayback!=='fixed'||clip.assetId===openingRecording.selectedOpeningId));
  const issues = inspectFlow(graph,recordedOpening);
  const locked = !canEdit || busy;

  function change(patch: Partial<ConversationPlaybook>) { setUndo(null); onChange(patch); }
  function updateGraph(next: FlowGraph) { change({ canvas: next }); }
  function updateNode(id: string, patch: Partial<FlowNode>) { updateGraph({ ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }); }
  function locate(id: string) {
    const item = items.find(item => item.key === id) || items.find(item => item.source === "step" && item.id === id);
    if (!item) return;
    setView("cards"); setGroup(item.group); setSearch(""); setSelectedKey(item.key); setPanel("edit");
  }
  function newNextScene(link: NextScene) {
    setCreateFrom(link); setNewType(["拒绝", "否定"].includes(link.branch) ? "ending" : "step"); setNewTitle(""); setCreateOpen(true);
  }
  function create() {
    const title = newTitle.trim(); if (!title || locked || (createFrom && !graph.nodes.some(n => n.id === createFrom.sourceId))) return;
    const id = crypto.randomUUID();
    if (newType === "faq") {
      if (p.faq.length >= 50) return;
      change({ faq: [...p.faq, { id, question: title, answer: "" }] }); setSelectedKey("faq:" + id);
    } else if (newType === "objection") {
      if (p.objections.length >= 50) return;
      change({ objections: [...p.objections, { id, trigger: title, response: "" }] }); setSelectedKey("objection:" + id);
    } else {
      if (graph.nodes.length >= 80) return;
      let next: FlowGraph = { ...graph, nodes: [...graph.nodes, { id, kind: newType === "ending" ? "end" : "speech", title, text: "", x: 350, y: graph.nodes.length * 260, field: "", outcome: "neutral" }] };
      if (createFrom) {
        if (graph.edges.length >= 240 && !createFrom.edgeId) return;
        next = putBranch(next, { id: createFrom.edgeId || crypto.randomUUID(), source: createFrom.sourceId, target: id, branch: createFrom.branch, condition: createFrom.condition });
      }
      updateGraph(next); setSelectedKey("step:" + id);
    }
    setGroup(newType === "faq" ? "faq" : newType === "objection" ? "objections" : newType === "ending" ? "endings" : "steps"); setSearch(""); setPanel("edit"); setView("cards"); setCreateOpen(false); setNewTitle(""); setCreateFrom(null);
  }
  function remove() {
    if (!removeItem || locked) return;
    if (removeItem.source === "step") {
      if (graph.nodes.length <= 1) return;
      onChange({ canvas: deleteFlowNode(graph, removeItem.id) }); setUndo({ canvas: graph });
    } else if (removeItem.source === "faq") { onChange({ faq: p.faq.filter(f => f.id !== removeItem.id) }); setUndo({ faq: p.faq }); }
    else { onChange({ objections: p.objections.filter(o => o.id !== removeItem.id) }); setUndo({ objections: p.objections }); }
    setRemoveItem(null); setSelectedKey("step:" + graph.entry); setPanel("edit");
  }
  function changeKind(id: string, kind: FlowNode["kind"]) {
    const keep = (branch: string) => ["end", "handoff"].includes(kind) ? false : ["jump", "text"].includes(kind) ? branch === "全部" : kind === "ivr" ? /^([0-9*#]|未识别)$/.test(branch) : true;
    updateGraph({ ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, kind } : n), edges: graph.edges.filter(e => e.source !== id || keep(e.branch)) });
    setTypeChange(null);
  }
  const atLimit = (createFrom && graph.edges.length >= 240 && !createFrom.edgeId) || (newType === "faq" ? p.faq.length >= 50 : newType === "objection" ? p.objections.length >= 50 : graph.nodes.length >= 80);

  return <div className={styles.studio} aria-label="场景话术编辑器">
    <header className={styles.toolbar}>
      <div className={styles.viewSwitch} aria-label="话术展示方式">
        <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid size={14} />场景卡片</button>
        <button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")}><List size={14} />文字总览</button>
      </div>
      <div className={styles.toolbarActions}>
        <span className={styles.savedStatus} role="status">{dirty ? <><i />有修改待保存</> : <><Check size={13} />{savedLabel || '草稿已保存'}</>}</span>
        <Button variant="ghost" size="sm" onClick={() => setGlobalOpen(true)}><Settings2 className="size-3.5" />全局规则</Button>
        <Button variant="outline" size="sm" onClick={onRehearse} disabled={busy}><MessageSquareText className="size-3.5" />文字演练</Button>
        {canEdit && <Button size="sm" variant={publishAction ? "outline" : "default"} disabled={busy || !dirty} onClick={() => { setUndo(null); void onSave(); }}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{busy ? "保存中…" : saveLabel || "保存草稿"}</Button>}
        {publishAction}
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="更多话术操作"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-44"><DropdownMenuItem onSelect={() => setCheckOpen(true)}><ShieldCheck className="size-3.5" />检查话术</DropdownMenuItem>{menuItems}</DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    {view === "overview" ? renderOverview(locate, () => setGlobalOpen(true)) : <>
      {undo && <div className={styles.undo} role="status">场景已从当前草稿移除。<button type="button" disabled={locked} onClick={() => { onChange(undo); setUndo(null); }}><Undo2 size={13} />撤销移除</button><button type="button" aria-label="关闭撤销提示" onClick={() => setUndo(null)}><X size={13} /></button></div>}
      <div className={styles.workspace}>
        <section className={styles.library} aria-label="话术场景列表">
          <div className={styles.libraryHeading}><div><h2>话术场景 <span>{items.length}</span></h2><p>先设置通话步骤，再补充问题与异议。</p></div>{canEdit && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setCreateFrom(null); setNewTitle(""); setNewType(group === "faq" ? "faq" : group === "objections" ? "objection" : group === "endings" ? "ending" : "step"); setCreateOpen(true); }}><Plus className="size-3.5" />新建场景</Button>}</div>
          <nav className={styles.categories} aria-label="话术场景分类">{groups.map(({id,label,detail,Icon}) => <button type="button" key={id} aria-pressed={group === id} onClick={() => { setGroup(id); setSearch(""); setPanel("edit"); }}><span className={styles.categoryIcon}><Icon size={16}/></span><strong>{label}</strong><span className={styles.categoryCount}>{items.filter(i => i.group === id).length}</span><small>{detail}</small></button>)}</nav>
          <div className={styles.categoryHeading}><div><h3>{currentGroup.label}</h3><p>{currentGroup.description}</p></div></div>
          <div className={styles.search}><Search size={15} /><input aria-label="搜索话术场景" placeholder="搜索当前分类的话术" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" aria-label="清空搜索" onClick={() => setSearch("")}><X size={13} /></button>}</div>
          <div className={styles.sceneList}>
            {visible.map(item => {
              const Icon = cardIcon(item), outgoing = graph.edges.filter(e => e.source === item.id), node = item.source === "step" ? graph.nodes.find(n => n.id === item.id) : undefined;
              const primary = outgoing.find(e => e.branch === "全部") || outgoing.find(e => e.branch === "肯定") || outgoing[0];
              const next = graph.nodes.find(n => n.id === primary?.target);
              return <button type="button" key={item.key} className={`${styles.sceneRow} ${selected?.key === item.key ? styles.sceneSelected : ""}`} aria-pressed={selected?.key === item.key} aria-label={`编辑场景：${item.title || "未命名场景"}`} onClick={() => { setSelectedKey(item.key); setPanel("edit"); }}>
                <span className={styles.stepNumber}>{item.group === "steps" ? String(item.order).padStart(2, "0") : <Icon size={16}/>}</span>
                <div className={styles.sceneContent}><div className={styles.sceneTitle}><h3>{item.title || "未命名场景"}</h3>{item.entry && <span className={styles.entryBadge}>从这里开始</span>}{item.group === "endings" && node && <span className={styles.entryBadge}>{scenarioOutcomes[node.outcome]}</span>}</div><p className={styles.sceneExcerpt}>{item.text || "点击补充沟通内容和回答"}</p>
                {item.group === "steps" && <div className={styles.sceneNext}>{primary && next ? <><span>{responseLabel(primary.branch)}</span><ArrowRight size={11}/><span>{next.title}</span>{outgoing.length > 1 && <small>另有 {outgoing.length - 1} 种走向</small>}</> : <span>待设置下一步</span>}</div>}</div>
                <span className={styles.rowAction}>{selected?.key === item.key ? "编辑中" : "编辑"}<ArrowRight size={13}/></span>
              </button>;
            })}
          </div>
          {!visible.length && <div className={styles.empty}><BookOpenText size={24} /><h3>{search ? "没有找到相关场景" : "这里还没有场景"}</h3><p>{search ? "换一个关键词，或查看全部场景。" : "添加客户常见的问题和回应，通话时就有对应的处理方式。"}</p><Button variant="outline" size="sm" onClick={() => search ? setSearch("") : (setCreateFrom(null), setNewType(group === "faq" ? "faq" : group === "objections" ? "objection" : group === "endings" ? "ending" : "step"), setCreateOpen(true))} disabled={!search && locked}>{search ? "清空搜索" : "添加一个场景"}</Button></div>}
          <footer className={styles.libraryFooter}><span>{employeeName} · {graph.nodes.length} 个步骤 · {graph.edges.length} 个分支</span><button type="button" onClick={() => setCheckOpen(true)}>检查走向 <ArrowRight size={12} /></button></footer>
        </section>
        <aside className={styles.editorPanel} aria-label="场景详情">
          {selected && <>
            <header className={styles.panelHeader}><span>{selected.label}</span><h2>{selected.title || "未命名场景"}</h2><div className={styles.panelSwitch}><button type="button" aria-pressed={panel === "edit"} onClick={() => setPanel("edit")}><PencilLine size={13} />编辑内容</button><button type="button" aria-pressed={panel === "preview"} onClick={() => setPanel("preview")}><MessageSquareText size={13} />对话预览</button></div></header>
            <div className={styles.panelBody}>
              {panel === "preview" ? <ScenarioPreview key={selected.key} item={selected} playbook={p} /> : <fieldset disabled={locked} className={styles.fields}>
                {selectedNode ? <>
                  <Field label="场景名称"><Input value={selectedNode.title} maxLength={100} onChange={e => updateNode(selectedNode.id, { title: e.target.value })} /></Field>
                  {selectedNode.kind !== "jump" && <Field label={selected.entry ? "开场白" : selected.group === "endings" ? "结束话术" : "沟通内容 / 表达要求"}><Textarea rows={5} maxLength={4000} placeholder={selected.entry ? "用自然、简短的话开始沟通" : "填写这个场景要表达的内容和要求"} value={selectedNode.text} onChange={e => updateNode(selectedNode.id, { text: e.target.value })} /><span className={styles.fieldHint}>{selected.entry || selected.group === "endings" ? "保持简短，一次只表达一件事。" : "可写参考话术，也可说明本步骤要了解什么。"}</span></Field>}
                  {selectedNode.kind === "collect" && <Field label="信息保存字段"><Input maxLength={50} value={selectedNode.field} placeholder="例如：主营产品" onChange={e => updateNode(selectedNode.id, { field: e.target.value })} /></Field>}
                  {selected.group === "endings" ? <Field label="通话结果标记"><NativeSelect value={selectedNode.outcome} onChange={e => updateNode(selectedNode.id, { outcome: e.target.value as FlowNode["outcome"] })}>{Object.entries(scenarioOutcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field> : <BranchEditor key={selectedNode.id} node={selectedNode} graph={graph} disabled={locked} onChange={updateGraph} onLocate={locate} onCreateNext={newNextScene} />}
                  <details className={styles.advanced}><summary>更多设置</summary><div className="mt-4 grid gap-4"><Field label="步骤类型"><NativeSelect value={selectedNode.kind} onChange={e => {
                    const kind = e.target.value as FlowNode["kind"];
                    if (kind === selectedNode.kind) return;
                    if (graph.edges.some(edge => edge.source === selectedNode.id)) setTypeChange({ id: selectedNode.id, kind }); else changeKind(selectedNode.id, kind);
                  }}>{Object.entries(scenarioKinds).filter(([value]) => !selected.entry || !["end", "handoff", "jump"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field>{!selected.entry && !["end", "handoff", "jump"].includes(selectedNode.kind) && <Button variant="outline" size="sm" onClick={() => updateGraph({ ...graph, entry: selectedNode.id })}>设为开场白</Button>}</div></details>
                </> : selected.source === "faq" ? <>
                  <Field label="客户可能怎么问"><Textarea rows={3} maxLength={1000} value={selected.title} onChange={e => change({ faq: p.faq.map(f => f.id === selected.id ? { ...f, question: e.target.value } : f) })} /></Field>
                  <Field label="参考回答"><Textarea rows={7} maxLength={4000} placeholder="填写简短、自然的回答" value={selected.text} onChange={e => change({ faq: p.faq.map(f => f.id === selected.id ? { ...f, answer: e.target.value } : f) })} /></Field>
                  <p className={styles.help}>客户在通话中问到相关问题时使用，回答后继续沟通。</p>
                </> : <>
                  <Field label="客户的情况或顾虑"><Textarea rows={3} maxLength={1000} value={selected.title} onChange={e => change({ objections: p.objections.map(o => o.id === selected.id ? { ...o, trigger: e.target.value } : o) })} /></Field>
                  <Field label="如何回应"><Textarea rows={7} maxLength={4000} placeholder="先回应客户，再说明下一步" value={selected.text} onChange={e => change({ objections: p.objections.map(o => o.id === selected.id ? { ...o, response: e.target.value } : o) })} /></Field>
                  <p className={styles.help}>只回应客户明确表达的顾虑；明确拒绝时礼貌结束。</p>
                </>}
                <div className={styles.deleteRow}><span>{selected.entry ? "当前通话从这里开始" : selected.source === "step" ? `被 ${graph.edges.filter(e => e.target === selected.id).length} 个分支引用` : "通话中的通用场景"}</span>{canEdit && <Button variant="ghost" size="icon-sm" aria-label={`移除场景：${selected.title}`} className="hover:text-destructive" disabled={busy || (selected.source === "step" && graph.nodes.length <= 1)} onClick={() => setRemoveItem(selected)}><Trash2 className="size-3.5" /></Button>}</div>
              </fieldset>}
            </div>
            <footer className={styles.panelFooter}><span>{savedAt ? "内容修改后请保存草稿" : "尚未保存"}</span><span>当前话术草稿</span></footer>
          </>}{!selected && <div className={styles.empty}><BookOpenText size={24}/><p>在左侧选择一个场景，查看或编辑内容。</p></div>}
        </aside>
      </div>
    </>}
    <Dialog open={globalOpen} onOpenChange={setGlobalOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>全局规则</DialogTitle><DialogDescription>统一设置业务身份、通话目标和补充要求，适用于全部场景。</DialogDescription></DialogHeader><fieldset disabled={locked}>{globalContent}</fieldset><DialogFooter><Button onClick={() => setGlobalOpen(false)}>返回话术</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={checkOpen} onOpenChange={setCheckOpen}><DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>检查话术</DialogTitle><DialogDescription>一起查看话术走向和内容提示，点击问题可返回对应场景。</DialogDescription></DialogHeader>
      <section className="space-y-3"><h3 className="text-sm font-medium">步骤与分支</h3>{issues.length ? <div className="space-y-2">{issues.map((issue, i) => <button type="button" key={i} className="block w-full rounded-lg border p-3 text-left text-sm leading-6 hover:bg-muted/30" onClick={() => { if (issue.nodeId) locate(issue.nodeId); setCheckOpen(false); }}><span className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}>{issue.severity === "error" ? "待完善" : "建议"}</span><span className="ml-2">{issue.message.replaceAll("节点", "场景").replaceAll("连线", "分支")}</span></button>)}</div> : <p className="flex items-center gap-2 py-2 text-sm"><Check className="size-4 text-primary" />现有步骤和分支可以完整走到结束。</p>}</section>
      {checkContent}
      <DialogFooter>{onCompare&&<Button variant="outline" onClick={()=>{setCheckOpen(false);onCompare();}}><GitCompareArrows className="size-3.5"/>查看修改</Button>}<Button onClick={()=>setCheckOpen(false)}>返回编辑</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-lg"><form onSubmit={e => { e.preventDefault(); create(); }}><DialogHeader><DialogTitle>{createFrom ? "新建下一步场景" : "新建话术场景"}</DialogTitle><DialogDescription>{createFrom ? `为“${responseLabel(createFrom.branch)}”添加下一步，创建后自动关联。` : "加入当前员工的草稿，继续补充内容和下一步。"}</DialogDescription></DialogHeader><div className="my-5 grid gap-5"><div className={styles.newTypes}>{newTypes.filter(t => !createFrom || ["step", "ending"].includes(t.id)).map(({ id, title, detail, Icon }) => <button type="button" key={id} aria-pressed={newType === id} onClick={() => setNewType(id)}><Icon size={16} /><strong>{title}</strong><span>{detail}</span></button>)}</div><Field label={newType === "faq" ? "客户问题" : newType === "objection" ? "客户情况" : "场景名称"}><Input autoFocus required maxLength={newType === "faq" || newType === "objection" ? 1000 : 100} value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder={newType === "step" ? "例如：了解客户需求" : newType === "faq" ? "例如：这个服务怎么收费？" : newType === "objection" ? "例如：客户现在不方便沟通" : "例如：客户同意继续了解"} /></Field>{atLimit && <p role="alert" className={styles.error}>此类场景已达到上限。</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" disabled={locked || atLimit || !newTitle.trim()}><Plus className="size-3.5" />加入草稿</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!removeItem} onOpenChange={open => { if (!open) setRemoveItem(null); }}><DialogContent><DialogHeader><DialogTitle>移除这个场景？</DialogTitle><DialogDescription>“{removeItem?.title || "未命名场景"}”将从当前草稿移除。{removeItem?.source === "step" ? `同时移除关联的 ${graph.edges.filter(e => e.source === removeItem.id || e.target === removeItem.id).length} 个分支${removeItem.id === graph.entry ? "，并将第一个可用沟通步骤设为开场" : ""}。` : ""}保存前可撤销本次移除。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRemoveItem(null)}>取消</Button><Button disabled={locked} onClick={remove}>从草稿移除</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!typeChange} onOpenChange={open => { if (!open) setTypeChange(null); }}><DialogContent><DialogHeader><DialogTitle>调整步骤类型？</DialogTitle><DialogDescription>更改为“{typeChange && scenarioKinds[typeChange.kind]}”后，会移除不适用的回应分支。请在调整后检查下一步设置。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setTypeChange(null)}>取消</Button><Button disabled={locked} onClick={() => { if (typeChange) changeKind(typeChange.id, typeChange.kind); }}>确认调整</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function BranchEditor({ graph, node, disabled, onChange, onLocate, onCreateNext }: {
  graph: FlowGraph; node: FlowNode; disabled: boolean; onChange: (g: FlowGraph) => void; onLocate: (id: string) => void; onCreateNext: (link: NextScene) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; branch: string } | null>(null);
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const existing = graph.edges.filter(e => e.source === node.id);
  const branches = flowBranches(node, graph), connected = branches.filter(b => existing.some(e => e.branch === b)), missing = branches.filter(b => !connected.includes(b));
  const displayed = expanded || !connected.length ? branches : connected;
  const fixed = ["jump", "text"].includes(node.kind);

  function openBranch(branch = "") {
    const edge = existing.find(e => e.branch === branch);
    setEditing({ id: edge?.id, branch }); setName(branch ? responseLabel(branch) : ""); setCondition(edge?.condition || ""); setTarget(edge?.target || ""); setError("");
  }
  function draftBranch(): string | null {
    if (!editing || disabled) return null;
    const value = name.trim();
    const branch = value === responseLabel(editing.branch) ? editing.branch : value;
    if (!branch) { setError("请填写客户回应名称。"); return null; }
    if (existing.some(e => e.id !== editing.id && (e.branch === branch || responseLabel(e.branch) === responseLabel(branch)))) { setError("此回应已存在，请编辑对应分支。"); return null; }
    if (node.kind === "ivr" && !/^([0-9*#]|未识别)$/.test(branch)) { setError("请输入单个 0–9、*、# 或“未识别”。"); return null; }
    if (graph.edges.length >= 240 && !editing.id) { setError("分支已达到 240 个，请先整理现有分支。"); return null; }
    return branch;
  }
  function connect(branch: string, next: string) {
    if (disabled) return;
    const edge = existing.find(e => e.branch === branch);
    setError("");
    if (next === "__new__") { onCreateNext({ sourceId: node.id, branch, condition: edge?.condition || "", edgeId: edge?.id }); return; }
    if (!next) { onChange({ ...graph, edges: graph.edges.filter(e => !(e.source === node.id && e.branch === branch)) }); return; }
    if (graph.edges.length >= 240 && !edge) { setError("分支已达到 240 个，请先整理现有分支。"); return; }
    onChange(putBranch(graph, { id: edge?.id || crypto.randomUUID(), source: node.id, target: next, branch, condition: edge?.condition || "" }));
  }
  function saveBranch() {
    const branch = draftBranch(); if (!branch) return;
    if (!target) { setError("请选择下一步场景。"); return; }
    onChange(putBranch(graph, { id: editing?.id || crypto.randomUUID(), source: node.id, target, branch, condition: condition.trim() })); setEditing(null);
  }
  function newTarget() {
    const branch = draftBranch(); if (!branch) return;
    onCreateNext({ sourceId: node.id, branch, condition: condition.trim(), edgeId: editing?.id }); setEditing(null);
  }
  return <section className={styles.branches} aria-label="客户回应与下一步">
    <div className={styles.sectionHeading}><h3>客户回应 <ArrowRight size={13} /> 下一步</h3><span>{existing.length} 个分支</span></div>
    <p className={styles.fieldHint}>回应条件、下一步和结束话术都可按业务调整。</p>
    {displayed.map(branch => {
      const edge = existing.find(e => e.branch === branch);
      return <div className={styles.branch} key={branch}>
        <div className={styles.branchTop}><span>{responseLabel(branch)}</span><div className={styles.branchActions}>
          <button type="button" aria-label={`设置回应：${responseLabel(branch)}`} onClick={() => openBranch(branch)}><PencilLine size={12} />设置</button>
          {edge && <button type="button" aria-label={`编辑下一步：${responseLabel(branch)}`} onClick={() => onLocate(edge.target)}>编辑下一步 <ArrowRight size={11} /></button>}
        </div></div>
        <NativeSelect aria-label={`${responseLabel(branch)}的下一步`} value={edge?.target || ""} onChange={e => connect(branch, e.target.value)}>
          <option value="">暂不设置 · 留在当前步骤</option>
          <optgroup label="沟通步骤">{graph.nodes.filter(n => !["end", "handoff"].includes(n.kind)).map(n => <option key={n.id} value={n.id}>{n.title || "未命名场景"}{n.id === node.id ? "（当前步骤）" : ""}</option>)}</optgroup>
          <optgroup label="结束处理">{graph.nodes.filter(n => ["end", "handoff"].includes(n.kind)).map(n => <option key={n.id} value={n.id}>{n.title || "未命名场景"}</option>)}</optgroup>
          <option value="__new__">＋ 新建下一步场景…</option>
        </NativeSelect>
        {edge?.condition && <p className={styles.conditionText}>{edge.condition}</p>}
      </div>;
    })}
    {!expanded && connected.length > 0 && missing.length > 0 && <button type="button" className={styles.textButton} onClick={() => setExpanded(true)}><Plus size={13} />补充其他回应 <span>{missing.length}</span></button>}
    {!fixed && <button type="button" className={styles.textButton} onClick={() => openBranch()}><Plus size={13} />{node.kind === "ivr" ? "自定义按键" : "自定义客户回应"}</button>}
    {error && !editing && <p role="alert" className={styles.error}>{error}</p>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent className="sm:max-w-lg">
      <form onSubmit={e => { e.preventDefault(); saveBranch(); }}>
        <DialogHeader><DialogTitle>{editing?.id ? "编辑客户回应" : "添加客户回应"}</DialogTitle><DialogDescription>填写客户会怎样回应，以及对应进入哪个场景。</DialogDescription></DialogHeader>
        <fieldset disabled={disabled} className="my-5 grid gap-5">
          <Field label={node.kind === "ivr" ? "电话按键" : "回应名称"}><Input required readOnly={fixed} maxLength={40} aria-label="客户回应名称" value={name} onChange={e => setName(e.target.value)} placeholder="例如：感兴趣、现在不方便、已经在使用" /></Field>
          <Field label="判断条件"><Textarea rows={3} maxLength={300} aria-label="客户回应判断条件" value={condition} onChange={e => setCondition(e.target.value)} placeholder="选填，例如：客户明确表示愿意了解，并同意加微信" /></Field>
          <Field label="下一步场景"><NativeSelect aria-label="客户回应的下一步场景" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择已有场景</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{n.title || "未命名场景"}{["end", "handoff"].includes(n.kind) ? " · 结束处理" : ""}</option>)}</NativeSelect><button type="button" className={styles.textButton} onClick={newTarget}><Plus size={13} />没有合适的？新建下一步场景</button></Field>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </fieldset>
        <DialogFooter className="sm:justify-between"><div>{editing?.id && <Button type="button" variant="ghost" className="text-destructive" disabled={disabled} onClick={() => { onChange({ ...graph, edges: graph.edges.filter(e => e.id !== editing.id) }); setEditing(null); }}><Trash2 className="size-3.5" />移除这个分支</Button>}</div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button><Button type="submit" disabled={disabled}>应用到草稿</Button></div></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </section>;
}
