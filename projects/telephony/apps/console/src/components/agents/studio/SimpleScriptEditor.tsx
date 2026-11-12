/*
 * 中文导读：统一话术的紧凑编辑界面。
 */
"use client";

import {useQuery} from "@tanstack/react-query";
import {personalVoices} from "@/src/lib/api/resources/personal-voices";
import {useAliyunIdentity} from "@/src/hooks/queries/aliyun";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Plus, Save, Search, Settings2, Trash2, Undo2, X } from "lucide-react";
import type { ConversationPlaybook, FlowGraph } from "@/src/lib/api/resources/playbook";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/src/components/ui/dropdown-menu";
import { toast } from "@/src/lib/toast";
import type { ScenarioEditorProps } from "./ScenarioEditor";
import { scenarioItems, type ScenarioItem } from "./scenario-model";
import { deleteConversationStep } from "./flow-model";
import { FaqRecordingEditor, readyFaqRecording, FaqRecordingPreview } from "./FaqRecordingEditor";
import { RecordingReplyEditor, recordingStatus } from "./RecordingReplyEditor";
import { chooseOpeningClip, openingRecordingKey, useScriptRecordings, type ScriptRecording } from "./use-script-recordings";
import { ScriptPreviewProvider, ScriptPreviewButton } from "./use-script-audio-preview";
import {VoiceOpeningPicker} from "./VoiceOpeningPicker";
import {SystemSpeechEditor} from "./SystemSpeechEditor";
import styles from "./simple-script-editor.module.css";

type RemovedItem =
  | { source: "step"; canvas: FlowGraph; key: string }
  | { source: "faq"; row: ConversationPlaybook["faq"][number]; index: number }
  | { source: "objection"; row: ConversationPlaybook["objections"][number]; index: number };
type ScriptSection = "opening" | "steps" | "questions" | "system";

export function SimpleScriptEditor({ playbook: p, canEdit, busy, dirty, savedAt, recordingScope, previewVoiceProfile, onChange, onSave, saveLabel, globalContent, menuItems, publishAction, onAdvanced, onRecordingDirtyChange }: ScenarioEditorProps & { onAdvanced: () => void }) {
  const recordings = useScriptRecordings(recordingScope,p);
  const {org,user}=useAliyunIdentity();
  const agentId=(()=>{try{return JSON.parse(recordingScope)[3] as string;}catch{return '';}})();
  const voiceCatalog=useQuery({queryKey:['my-voice',user,org,agentId],queryFn:()=>personalVoices.catalog(org,agentId),enabled:!!user&&!!org&&!!agentId,retry:false,refetchOnWindowFocus:false});
  const anchorOptions=voiceCatalog.data?.providers.find(v=>v.provider==='HAOKEHU_SIP')?.options.filter(v=>v.kind==='clone'&&v.model==='qwen3.8-omni-flash-realtime'&&v.available)||[];
  const graph = p.canvas!;
  const items = scenarioItems(p);
  const opening = items.find(item => item.entry);
  const steps = items.filter(item => item.group === "steps" && !item.entry);
  const questions = items.filter(item => ["faq", "objections"].includes(item.group));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [remove, setRemove] = useState<ScenarioItem | null>(null);
  const [undo, setUndo] = useState<RemovedItem | null>(null);
  const [recording, setRecording] = useState(false);
  const [openingDraft,setOpeningDraft]=useState(false),[openingBusy,setOpeningBusy]=useState(false);
  const openingStateChange=useCallback((pending:boolean,inFlight:boolean)=>{setOpeningDraft(pending);setOpeningBusy(inFlight);},[]);
  const savingLock = useRef(false);
  const previewRevisions = useRef(new Map<string, { entry: ScriptRecording | undefined; revision: number }>());
  const [section, setSection] = useState<ScriptSection>("opening");
  const sectionId = useId();
  const saving = busy || recordings.saving || openingBusy;
  const changed = dirty || recordings.dirty || openingDraft;
  const locked = !canEdit || saving || recordings.loading || (!!recordings.error && !recordings.dirty);
  const matches = questions.filter(item => `${item.title} ${item.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 5));
  const currentPage = Math.min(page, pages - 1);
  const visibleQuestions = matches.slice(currentPage * 5, currentPage * 5 + 5);
  const sections = [
    { id: "opening", label: "声音与开场白", purpose: "本人开场白 + AI 回答", count: "" },
    { id: "steps", label: "通话目标", purpose: "希望达成什么", count: "" },
    { id: "questions", label: "参考问答", purpose: "遇到问题怎么答", count: `${questions.length} 条` },
    { id: "system", label: "场景话术", purpose: "特殊场景的固定播报", count: "" },
  ] as const;

  function changeSection(next: ScriptSection) {
    if (recording || saving || next === section) return;
    window.dispatchEvent(new Event("taigua-script-audio-stop"));
    setSection(next);
  }

  useEffect(() => {
    if (!['library','generated'].includes(p.recordingReplies?.openingSource||'') && opening && !recordings.loading && !recordings.entries[openingRecordingKey] && recordings.entries[opening.key]) {
      recordings.moveEntry(opening.key, openingRecordingKey);
    }
  }, [opening?.key, recordings.loading, recordings.entries, recordings.moveEntry]);

  useEffect(() => {
    onRecordingDirtyChange?.(recordings.dirty || recording || openingDraft || openingBusy);
  }, [onRecordingDirtyChange, recordings.dirty, recording,openingDraft,openingBusy]);
  useEffect(() => () => onRecordingDirtyChange?.(false), [onRecordingDirtyChange]);

  useEffect(() => {
    if (!recordings.dirty && !recording && !openingDraft && !openingBusy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recordings.dirty, recording,openingDraft,openingBusy]);

  function updateText(item: ScenarioItem, text: string) {
    if(item.source === "step") setUndo(null);
    if (item.source === "step") onChange({ canvas: { ...graph, nodes: graph.nodes.map(node => node.id === item.id ? { ...node, text } : node) } });
    else if (item.source === "faq") onChange({ faq: p.faq.map(row => row.id === item.id ? { ...row, answer: text } : row) });
    else onChange({ objections: p.objections.map(row => row.id === item.id ? { ...row, response: text } : row) });
  }
  function updateTitle(item: ScenarioItem, title: string) {
    if(item.source === "step") setUndo(null);
    if (item.source === "step") onChange({ canvas: { ...graph, nodes: graph.nodes.map(node => node.id === item.id ? { ...node, title } : node) } });
    else if (item.source === "faq") onChange({ faq: p.faq.map(row => row.id === item.id ? { ...row, question: title } : row) });
    else onChange({ objections: p.objections.map(row => row.id === item.id ? { ...row, trigger: title } : row) });
  }
  async function save() {
    if (locked || recording || openingDraft || savingLock.current) return;
    savingLock.current = true;
    try {
      const cloud=process.env.NEXT_PUBLIC_LOCAL_PREVIEW!=="true";
      const recordingReplies=await recordings.manifest(p);
      if(!(await onSave({...p,recordingReplies})))return;
      if (recordings.dirty && !(await recordings.save())) return;
      setUndo(null);
      if (!dirty) toast.success(cloud?"话术和录音已保存":"话术录音已保存在本地");
    } catch(error){toast.error(error instanceof Error?error.message:"录音保存失败，请重试");} finally { savingLock.current = false; }
  }
  function addQuestion() {
    if (locked || recording || p.faq.length >= 100) return;
    const id = crypto.randomUUID();
    onChange({ faq: [...p.faq, { id, question: "", answer: "" }] });
    setSearch(""); setPage(Math.floor(p.faq.length / 5)); setExpanded("faq:" + id); changeSection("questions");
  }
  function addStep() {
    if (locked || !newTitle.trim() || graph.nodes.length >= 80 || graph.edges.length > 238) return;
    setUndo(null);
    const id = crypto.randomUUID();
    let last = graph.nodes.find(node => node.id === graph.entry);
    const seen = new Set<string>();
    let continuation = graph.edges.find(edge => edge.source === last?.id && edge.branch === "全部") || graph.edges.find(edge => edge.source === last?.id && edge.branch === "肯定");
    while (last) {
      seen.add(last.id);
      const next = graph.nodes.find(node => node.id === continuation?.target);
      if (!next || ["end", "handoff"].includes(next.kind)) break;
      if (seen.has(next.id)) { toast.error("当前流程包含循环，请在高级流程设置中添加步骤。"); return; }
      last = next;
      continuation = graph.edges.find(edge => edge.source === last?.id && edge.branch === "全部") || graph.edges.find(edge => edge.source === last?.id && edge.branch === "肯定");
    }
    const edges = continuation ? [
      ...graph.edges.map(edge => edge.id === continuation.id ? { ...edge, target: id } : edge),
      { id: crypto.randomUUID(), source: id, target: continuation.target, branch: "全部", condition: "" },
    ] : [...graph.edges, ...(last ? [{ id: crypto.randomUUID(), source: last.id, target: id, branch: "全部", condition: "" }] : [])];
    onChange({ canvas: { ...graph, nodes: [...graph.nodes, { id, title: newTitle.trim(), text: newText.trim(), kind: "speech", x: 350, y: graph.nodes.length * 260, field: "", outcome: "neutral" }], edges } });
    setAddStepOpen(false); setExpanded("step:" + id); setNewTitle(""); setNewText(""); changeSection("steps");
  }
  function removeItem() {
    if (!remove || locked || recording) return;
    if (remove.source === "step") {
      if(remove.entry) return;
      setUndo({ source: "step", canvas: graph, key: remove.key });
      onChange({ canvas: deleteConversationStep(graph, remove.id) });
    } else if (remove.source === "faq") {
      const index = p.faq.findIndex(row => row.id === remove.id);
      if (index >= 0) { setUndo({ source: "faq", row: p.faq[index], index }); onChange({ faq: p.faq.filter(row => row.id !== remove.id) }); }
    } else {
      const index = p.objections.findIndex(row => row.id === remove.id);
      if (index >= 0) { setUndo({ source: "objection", row: p.objections[index], index }); onChange({ objections: p.objections.filter(row => row.id !== remove.id) }); }
    }
    setRemove(null); setExpanded(null);
  }
  function restoreItem() {
    if (!undo || locked || recording) return;
    if (undo.source === "step") {
      onChange({ canvas: undo.canvas });
      setExpanded(undo.key); setUndo(null); changeSection("steps");
      return;
    }
    if (undo.source === "faq") {
      if (p.faq.some(row => row.id === undo.row.id)) { setUndo(null); return; }
      if (p.faq.length >= 100) { toast.error("问答已达上限，移除一条后再撤销。"); return; }
      const index = Math.min(undo.index, p.faq.length);
      onChange({ faq: [...p.faq.slice(0, index), undo.row, ...p.faq.slice(index)] });
      setPage(Math.floor(index / 5));
    } else {
      if (p.objections.some(row => row.id === undo.row.id)) { setUndo(null); return; }
      const index = Math.min(undo.index, p.objections.length);
      onChange({ objections: [...p.objections.slice(0, index), undo.row, ...p.objections.slice(index)] });
      setPage(Math.floor((p.faq.length + index) / 5));
    }
    setSearch(""); setExpanded(`${undo.source}:${undo.row.id}`); setUndo(null); changeSection("questions");
  }
  function renderRecording(item: ScenarioItem) {
    const key = item.entry ? openingRecordingKey : item.key;
    if(item.source==="faq"||item.source==="objection")return <FaqRecordingEditor key={key} entry={recordings.entries[key]} text={item.text} voiceId={p.recordingReplies?.voiceId} voiceName={anchorOptions.find(v=>v.voiceId===p.recordingReplies?.voiceId)?.name} scope={recordingScope} disabled={locked||recording} onBusy={setRecording} onChange={entry=>recordings.setEntry(key,entry)}/>;
    return <RecordingReplyEditor key={key} kind={item.entry ? "opening" : item.source === "step" ? "speech" : "answer"} entry={recordings.entries[key]} text={item.text} disabled={locked || recording} recordingScope={recordingScope} canUpdateExistingVoice={voiceCatalog.data?.canUpdateLibrary} onVoiceCloned={id=>{onChange({recordingReplies:{version:1,entries:{},...p.recordingReplies,voiceId:id}});void voiceCatalog.refetch();toast.success('复刻声音已关联，请保存话术');}} voiceOptions={anchorOptions.filter(v=>!p.recordingReplies?.openingSource||v.voiceId===p.recordingReplies.voiceId).map(v=>({voiceId:v.voiceId,name:v.name}))} defaultVoiceId={p.recordingReplies?.voiceId} onChange={entry => recordings.setEntry(key, entry)} onRecordingChange={setRecording} />;
  }
  function previewButton(item: ScenarioItem) {
    const entry = recordings.entries[item.entry ? openingRecordingKey : item.key];
    if(entry?.direct)return <FaqRecordingPreview entry={entry} text={item.text} voiceId={p.recordingReplies?.voiceId} scope={recordingScope} disabled={recording||recordings.loading}/>;
    const previous = previewRevisions.current.get(item.key);
    const version = previous && previous.entry === entry ? previous : { entry, revision: (previous?.revision || 0) + 1 };
    previewRevisions.current.set(item.key, version);
    return <ScriptPreviewButton id={item.key} revision={version.revision} text={item.text} label={`试听${item.entry ? "开场白" : item.title || "这句话"}`} disabled={recording || recordings.loading} className={styles.previewButton} getBlob={() => item.entry ? chooseOpeningClip(entry, item.text)?.blob : entry?.mode !== "ai" && entry?.transcript?.trim() === item.text.trim() ? entry?.blob : undefined} />;
  }
  function renderRow(item: ScenarioItem, index: number) {
    const currentRecording=recordings.entries[item.key];
    const status = currentRecording?.direct ? readyFaqRecording(currentRecording,item.text,p.recordingReplies?.voiceId)?"已有录音":currentRecording.asset?"录音待核对":"AI回答" : recordingStatus(currentRecording, item.text);
    const statusLabel = item.source === "step" ? "执行要求" : status === "已有录音" ? "录音" : status === "录音待核对" ? "待核对" : "参考回答";
    const open = expanded === item.key;
    const toggle = () => setExpanded(open ? null : item.key);
    return <article key={item.key} className={`${styles.row} ${open ? styles.activeRow : ""}`}>
      <div className={styles.rowHeading}>
        {item.source === "step" && <span className={styles.rowNumber}>{index + 1}</span>}
        {open && canEdit ? <Input className={styles.rowTitleInput} aria-label={item.source === "step" ? "要求名称" : "客户可能怎么说"} maxLength={item.source === "step" ? 100 : 1000} value={item.title} disabled={locked || recording} placeholder={item.source === "step" ? "要求名称" : "客户可能怎么说"} onChange={event => updateTitle(item, event.target.value)} /> : <button type="button" className={styles.rowToggle} aria-expanded={open} disabled={recording || saving} aria-label={`编辑${item.source === "step" ? "沟通要求" : "问答"}：${item.title || "新问答"}`} onClick={toggle}><span className={styles.rowText}><strong>{item.title || "新问答"}</strong></span></button>}
        <div className={styles.rowControls}>
          <span className={`${styles.rowStatus} ${status === "已有录音" ? styles.hasRecording : status === "录音待核对" ? styles.needsReview : ""}`}>{statusLabel}</span>
          {item.source!=="step"&&previewButton(item)}
          {canEdit && <Button type="button" size="icon-xs" variant="ghost" aria-label={item.source === "step" ? "删除这条沟通要求" : "删除这条问答"} disabled={locked || recording} onClick={() => setRemove(item)}><Trash2 className="size-3" /></Button>}
          <button type="button" className={styles.expandButton} aria-expanded={open} aria-label={`${open ? "收起" : "展开"}${item.title || "新问答"}`} disabled={recording || saving} onClick={toggle}><ChevronDown size={13} /></button>
        </div>
      </div>
      {open && <div className={`${styles.rowBody} ${item.source!=="step"?styles.faqRowBody:""}`}>
        <Textarea className={styles.speechText} aria-label={item.source === "step" ? "AI执行要求" : "参考答案"} rows={3} maxLength={4000} value={item.text} disabled={locked || recording} placeholder={item.source === "step" ? "写清什么情况下怎么做，这里的内容不会直接朗读" : "填写有依据的参考答案，AI按客户问题自然表达"} onChange={event => updateText(item, event.target.value)} />
        {item.source!=="step"&&renderRecording(item)}
      </div>}
    </article>;
  }

  return <ScriptPreviewProvider recordingScope={recordingScope} voiceProfile={previewVoiceProfile} voiceAnchor={p.recordingReplies?.voiceId}><div className={styles.editor} aria-label="通话设置编辑器">
    <header className={styles.toolbar}>
      <div className={styles.sectionTabs} role="tablist" aria-label="通话设置分类">{sections.map((tab, index) => <button
        key={tab.id} type="button" role="tab" id={`${sectionId}-tab-${tab.id}`} aria-controls={`${sectionId}-panel-${tab.id}`}
        aria-selected={section === tab.id} tabIndex={section === tab.id ? 0 : -1} disabled={recording || saving}
        onClick={() => changeSection(tab.id)} onKeyDown={event => {
          const nextIndex = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
          if (nextIndex < 0 || recording || saving) return;
          event.preventDefault(); changeSection(sections[nextIndex].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
        }}><span className={styles.tabNumber} aria-hidden="true">{index + 1}</span><span className={styles.tabContent}><span className={styles.tabTitle}>{tab.label}{tab.count && <small>{tab.count}</small>}</span><span className={styles.tabPurpose}>{tab.purpose}</span></span>{index < sections.length - 1 && <ChevronRight className={styles.tabArrow} size={14} aria-hidden="true" />}</button>)}</div>
      <div className={styles.toolbarActions}>
        <span className={`${styles.saved} ${changed ? styles.dirty : ""}`} role="status">{recordings.loading ? "读取录音中…" : changed ? "有修改待保存" : <><Check size={12} />已保存</>}</span>
        <Button type="button" size="sm" variant="ghost" disabled={recording || saving} onClick={() => setGlobalOpen(true)}><Settings2 className="size-3.5"/>统一规则</Button>
        {canEdit && <Button type="button" size="sm" disabled={locked || recording || openingDraft || !changed} onClick={() => void save()}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{saving ? "保存中…" : saveLabel || "保存话术"}</Button>}
        {publishAction&&<fieldset disabled={recording||openingDraft||saving||recordings.dirty} className="contents">{publishAction}</fieldset>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="更多话术设置" disabled={recording}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={dirty || recordings.dirty || saving} onSelect={onAdvanced}>高级流程设置</DropdownMenuItem>{menuItems}</DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    {p.conversationMode!=="goal"&&<div className={styles.notice}>当前使用已有流程，保存话术时保持该执行方式。</div>}
    {(p.livestreamSchedule || p.livestreamPrice) && <div className={styles.notice} role="status">当前草稿含旧版直播时间或费用规则。新发布的话术不再使用后台固定回答，请在沟通要求或参考问答中填写需要使用的时间和费用内容。</div>}
    {recordings.error && <div role="alert" className={styles.saveError}><p className={styles.error}>{recordings.error}</p></div>}
    {undo && <div className={styles.notice} role="status">{undo.source === "step" ? "沟通要求" : "问答"}已从草稿删除。<Button size="sm" variant="ghost" disabled={locked || recording} onClick={restoreItem}><Undo2 className="size-3.5" />撤销</Button><Button size="icon-sm" variant="ghost" aria-label="关闭撤销提示" disabled={locked || recording} onClick={() => setUndo(null)}><X className="size-3" /></Button></div>}
    <div className={styles.body}>
      <section className={styles.section} role="tabpanel" id={`${sectionId}-panel-opening`} aria-labelledby={`${sectionId}-tab-opening`} hidden={section !== "opening"} tabIndex={0}>
        <VoiceOpeningPicker key={`${agentId}:${savedAt}`} custom={{agentId,scope:'template',playbook:p,onChange,onDraftChange:openingStateChange}} value={p.recordingReplies?.voiceId||''} options={anchorOptions.map(v=>({voiceId:v.voiceId,name:v.name}))} disabled={locked||recording} canManage={voiceCatalog.data?.canUpdateLibrary} onChange={id=>{const entries={...p.recordingReplies?.entries};delete entries['opening-recordings'];if(id!==p.recordingReplies?.voiceId){for(const [key,entry] of Object.entries(recordings.entries)){if(key!==openingRecordingKey&&entry.mode!=='ai'){recordings.setEntry(key,{...entry,mode:'ai'});entries[key]={mode:'ai',clips:[]};}}}onChange({recordingReplies:{version:1,entries,openingSource:'library',...(id?{voiceId:id}:{})}});}}/>

      </section>
      <section className={styles.section} role="tabpanel" id={`${sectionId}-panel-steps`} aria-labelledby={`${sectionId}-tab-steps`} hidden={section !== "steps"} tabIndex={0}>
        <div className={styles.goalFields}>
          <label className={styles.textField}><span>这通电话要达成什么</span><Textarea aria-label="通话目标" rows={3} maxLength={1000} value={p.purpose} disabled={locked||recording} placeholder="例如：邀请有兴趣的客户看直播，征求加微信同意后发送直播间。" onChange={e=>onChange({purpose:e.target.value})}/></label>
          <p className={styles.itemCount}>客户提问先回答，感兴趣再推进；下方填写 AI 的处理要求。</p>
        </div>
        <header className={styles.sectionHeader}><span className={styles.itemCount}>补充要求 · {steps.length} 条</span>{canEdit && <Button type="button" variant="outline" size="sm" disabled={locked || recording || graph.nodes.length >= 80} onClick={() => setAddStepOpen(true)}><Plus className="size-3.5" />添加要求</Button>}</header>
        {steps.length ? <div className={styles.rows}>{steps.map(renderRow)}</div> : <div className={styles.empty}>没有补充要求也可使用，AI将按通话目标和参考问答沟通。</div>}
      </section>
      <section className={styles.section} role="tabpanel" id={`${sectionId}-panel-questions`} aria-labelledby={`${sectionId}-tab-questions`} hidden={section !== "questions"} tabIndex={0}>
        <header className={styles.sectionHeader}><span className={styles.itemCount}>共 {questions.length} 条</span><div className={styles.questionTools}><div className={styles.search}><Search size={13} /><Input aria-label="搜索客户问题" placeholder="搜索问题或回答" value={search} disabled={recording} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>{canEdit && <Button type="button" size="sm" variant="outline" disabled={locked || recording || p.faq.length >= 100} onClick={addQuestion}><Plus className="size-3.5" />添加问答</Button>}</div></header>
        {visibleQuestions.length ? <div className={styles.rows}>{visibleQuestions.map(renderRow)}</div> : <div className={styles.empty}>{search ? "没有找到相关问答" : "暂无补充问答，可按需添加。"}</div>}
        {matches.length > 5 && <nav className={styles.pager} aria-label="客户问答分页"><span>{currentPage + 1} / {pages}</span><Button type="button" size="icon-sm" variant="outline" aria-label="上一页问答" disabled={recording || currentPage === 0} onClick={() => { setPage(currentPage - 1); setExpanded(null); }}><ChevronLeft className="size-3.5" /></Button><Button type="button" size="icon-sm" variant="outline" aria-label="下一页问答" disabled={recording || currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setExpanded(null); }}><ChevronRight className="size-3.5" /></Button></nav>}
      </section>
      <section className={styles.section} role="tabpanel" id={`${sectionId}-panel-system`} aria-labelledby={`${sectionId}-tab-system`} hidden={section !== "system"} tabIndex={0}>
        <SystemSpeechEditor value={p.systemSpeech} disabled={locked || recording} onChange={systemSpeech=>onChange({systemSpeech})}/>
      </section>

    </div>

    <Dialog open={globalOpen} onOpenChange={setGlobalOpen}><DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>统一规则</DialogTitle><DialogDescription>设置通话目标、身份与沟通要求。</DialogDescription></DialogHeader><fieldset disabled={locked}>{globalContent}</fieldset><DialogFooter><Button type="button" onClick={()=>setGlobalOpen(false)}>返回话术</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}><DialogContent className="sm:max-w-lg"><form onSubmit={event => { event.preventDefault(); addStep(); }}><DialogHeader><DialogTitle>添加沟通要求</DialogTitle><DialogDescription className="sr-only">填写要补充的沟通内容。</DialogDescription></DialogHeader><div className="my-5 grid gap-4"><label className={styles.textField}><span>要求名称</span><Input required autoFocus maxLength={100} value={newTitle} onChange={event => setNewTitle(event.target.value)} placeholder="例如：了解合作需求" /></label><label className={styles.textField}><span>AI执行要求</span><Textarea rows={4} maxLength={4000} value={newText} onChange={event => setNewText(event.target.value)} /></label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAddStepOpen(false)}>取消</Button><Button type="submit" disabled={locked || !newTitle.trim()}>添加</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!remove} onOpenChange={open => { if (!open) setRemove(null); }}><DialogContent><DialogHeader><DialogTitle>{remove?.source === "step" ? "删除这条沟通要求？" : "删除这条问答？"}</DialogTitle><DialogDescription>{remove?.title || "新问答"}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRemove(null)}>保留</Button><Button variant="destructive" onClick={removeItem}>删除</Button></DialogFooter></DialogContent></Dialog>
  </div></ScriptPreviewProvider>;
}
