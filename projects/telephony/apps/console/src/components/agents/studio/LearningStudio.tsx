/*
 * 中文导读：数字员工与话术的 LearningStudio 组件，封装该界面的展示与交互。
 */
"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {BookOpenCheck,BrainCircuit,FileAudio,History,Loader2,MessageSquareText,Play,Plus,Save,Send,Upload,X} from 'lucide-react';
import Link from 'next/link';
import styles from './learning-studio.module.css';
import {Button} from '@/src/components/ui/button';
import {Input} from '@/src/components/ui/input';
import {Textarea} from '@/src/components/ui/textarea';
import {toast} from '@/src/lib/toast';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {learningApi,type LearningRecording,type TrainingMessage} from '@/src/lib/api/resources/learning';
import {prepareRecording} from '@/src/lib/browser-compute/recording';
import {AudioPlayer} from '@/src/components/calls/AudioPlayer';
import {RecordingReview} from './RecordingReview';
import {scriptOpening} from './flow-model';
import type {ConversationPlaybook} from '@/src/lib/api/resources/playbook';

export function LearningStudio({agentId,playbook,placeholders,canEdit,onApply,initialTab='chat'}:{agentId:string;playbook:ConversationPlaybook;placeholders?:Record<string,string>;canEdit:boolean;onApply:(patch:Partial<ConversationPlaybook>)=>void;initialTab?:'chat'|'recording'|'history'}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [tab,setTab]=useState<'chat'|'recording'|'history'>(initialTab),[messages,setMessages]=useState<TrainingMessage[]>([]),[input,setInput]=useState(''),[correction,setCorrection]=useState(''),[file,setFile]=useState<File|null>(null),[consent,setConsent]=useState(false),[selected,setSelected]=useState(''),[audio,setAudio]=useState('');
 const [dragging,setDragging]=useState(false),[normalizeAudio,setNormalizeAudio]=useState(true),[filterAudio,setFilterAudio]=useState(false);
 const [preparedAudio,setPreparedAudio]=useState('');
 const preparedAudioRef=useRef('');
 useEffect(()=>{if(preparedAudioRef.current)URL.revokeObjectURL(preparedAudioRef.current);preparedAudioRef.current='';setPreparedAudio('');return()=>{if(preparedAudioRef.current)URL.revokeObjectURL(preparedAudioRef.current);};},[file,normalizeAudio,filterAudio]);
 const fileInputRef=useRef<HTMLInputElement>(null),dragDepthRef=useRef(0),fileHintId=useId();
 const audioRef=useRef(''),audioStartRef=useRef(0),audioElementRef=useRef<HTMLAudioElement>(null);useEffect(()=>()=>{if(audioRef.current)URL.revokeObjectURL(audioRef.current);},[]);
 const key=['employee-learning',user,org,agentId];
 const records=useQuery({queryKey:[...key,'recordings'],queryFn:()=>learningApi.list(agentId,org),enabled:!!org,refetchInterval:q=>q.state.data?.some(r=>['PROCESSING','QUEUED'].includes(r.status))?5000:false,refetchIntervalInBackground:false});
 const capabilities=useQuery({queryKey:[...key,'capabilities'],queryFn:()=>learningApi.capabilities(agentId,org),enabled:!!org,retry:false});
 const history=useQuery({queryKey:[...key,'history'],queryFn:()=>learningApi.history(agentId,org),enabled:!!org&&tab==='history'});
 const refresh=()=>void qc.invalidateQueries({queryKey:key});
 const chat=useMutation({mutationFn:(next:TrainingMessage[])=>learningApi.rehearse(agentId,org,next,playbook,placeholders),onSuccess:(r)=>{setMessages(m=>[...m,{role:'assistant',content:r.answer}]);setInput('');},onError:(e:Error)=>{setMessages(m=>m.slice(0,-1));toast.error(e.message);}});
 const previewRecording=useMutation({mutationFn:()=>{if(!file)throw new Error('请先选择录音。');return prepareRecording(file,{normalize:normalizeAudio,filter:filterAudio});},onSuccess:blob=>{if(preparedAudioRef.current)URL.revokeObjectURL(preparedAudioRef.current);preparedAudioRef.current=URL.createObjectURL(blob);setPreparedAudio(preparedAudioRef.current);},onError:(error:Error)=>toast.error(error.message)});
 const upload=useMutation({mutationFn:async()=>{if(!file||!consent)throw new Error('请选择已授权录音并确认用途。');return learningApi.upload(agentId,org,file.name,await prepareRecording(file,{normalize:normalizeAudio,filter:filterAudio}),capabilities.data?.transcriptionAvailable===true&&capabilities.data?.analysisAvailable===true);},onSuccess:r=>{setFile(null);setConsent(false);setSelected(r.id);refresh();toast.success(r.status==='QUEUED'?'已上传，正在排队转写和整理':'录音已保存，配置模型后可开始学习');},onError:(e:Error)=>toast.error(e.message)});
 const learn=useMutation({mutationFn:(id:string)=>learningApi.learn(agentId,org,id),onSuccess:()=>{refresh();toast.success('已开始转写与分析，可在此查看进度');},onError:(e:Error)=>toast.error(e.message)});
 const save=useMutation({mutationFn:()=>learningApi.saveSession(agentId,org,{messages,revision:playbook.canvas?.revision||'培训草稿',correction}),onSuccess:()=>{refresh();toast.success('对练与纠正已保存到训练记录');},onError:(e:Error)=>toast.error(e.message)});
 const play=useMutation({mutationFn:({recording:r,seconds=0}:{recording:LearningRecording;seconds?:number})=>{audioStartRef.current=seconds;return learningApi.audio(agentId,org,r.id);},onSuccess:blob=>{if(audioRef.current)URL.revokeObjectURL(audioRef.current);audioRef.current=URL.createObjectURL(blob);setAudio(audioRef.current);},onError:(e:Error)=>toast.error(e.message)});
 const archive=useMutation({mutationFn:(id:string)=>learningApi.archive(agentId,org,id),onSuccess:()=>{setSelected('');refresh();toast.success('录音已归档');},onError:(e:Error)=>toast.error(e.message)});
 const uploadDisabled=!canEdit||upload.isPending||previewRecording.isPending;
 function chooseRecording(files:File[]){
  if(uploadDisabled||!files.length)return;
  if(files.length!==1){toast.error('请每次选择一份录音。');return;}
  const next=files[0]!;
  if(!/\.(wav|mp3|m4a)$/i.test(next.name)){toast.error('请选择 WAV、MP3 或 M4A 录音。');return;}
  if(!next.size||next.size>20*1024*1024){toast.error('请选择20MB以内的有效录音。');return;}
  setFile(next);setConsent(false);
 }
 function send(){if(!canEdit||!capabilities.data?.analysisAvailable||!input.trim()||chat.isPending)return;const next=[...messages.slice(-18),{role:'user' as const,content:input.trim()}];setMessages(next);chat.mutate(next);}
 const recording=records.data?.find(r=>r.id===selected)||records.data?.[0];
 const statusNames:Record<string,string>={UPLOADED:'待学习',QUEUED:'排队中',PROCESSING:'自动整理中',READY:'知识待审核',NEEDS_REVIEW:'处理待核对'};
 const opening=scriptOpening(playbook).replace(/\{\{\s*([\w.\p{L}\p{N}_]+)\s*\}\}/gu,(_,name:string)=>placeholders?.[name]?.trim()||'（待确认）');
 return <section className={styles.studio}>
 <header className={styles.header}><div><h2><BrainCircuit aria-hidden="true"/>训练与学习</h2><p>{tab==='chat'?'模拟客户回应，检查并调整回答方式。':tab==='recording'?'从录音中提取业务知识，审核后进入知识库。':'查看保存的对练内容和纠正意见。'}</p></div>
 <div className={styles.modes} role="group" aria-label="训练方式">{([['chat','文字对练',MessageSquareText],['recording','录音学习',FileAudio],['history','训练记录',History]] as const).map(([id,label,Icon])=><Button key={id} size="sm" variant="ghost" aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon aria-hidden="true" className="size-3.5"/>{label}</Button>)}</div></header>
 {tab==='chat'&&<div className={styles.chatLayout}>
  <div className={styles.dialogue}><div className={styles.dialogueHeader}><span>对话预览 · 当前话术草稿</span><Button size="xs" variant="ghost" disabled={chat.isPending} onClick={()=>setMessages([])}>重新开始</Button></div>
   <div className={styles.messages} role="log" aria-label="文字对练内容" aria-live="polite"><div className={styles.message}><span>数字员工 · 开场白</span>{opening}</div>
    {messages.map((m,i)=><div key={i} className={styles.message+(m.role==='user'?' '+styles.customer:'')}><span>{m.role==='user'?'模拟客户':'数字员工'}</span>{m.content}</div>)}
    {chat.isPending&&<p role="status" className="text-xs text-muted-foreground">数字员工正在回答…</p>}
    {!messages.length&&<div className={styles.suggestions}><p>选择一句客户回应，或在下方输入</p><div>{['您是做什么的？','我现在不方便','可以先发资料吗？'].map(text=><button type="button" key={text} disabled={!canEdit||chat.isPending} onClick={()=>setInput(text)}>{text}</button>)}</div></div>}
   </div>
   <div className={styles.composer}><Input aria-label="模拟客户说话" maxLength={6000} disabled={!canEdit||chat.isPending} placeholder="输入客户可能说的话" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)send();}}/><Button size="sm" disabled={!canEdit||!input.trim()||chat.isPending||!capabilities.data?.analysisAvailable} onClick={send}>{chat.isPending?<Loader2 className="size-3.5 animate-spin"/>:<Send className="size-3.5"/>}发送</Button></div>
  </div>
  <aside className={styles.correction}><h3>纠正回答</h3><p>先对练，再记录需要改进的回答；确认后可加入常见问答草稿。</p><label>你希望怎样回答<Textarea disabled={!canEdit} rows={5} maxLength={4000} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="写下更合适的回答，或记录发现的问题"/></label>
   <div className={styles.correctionActions}><Button size="sm" variant="outline" disabled={!canEdit||!messages.length||save.isPending} onClick={()=>save.mutate()}><Save className="size-3.5"/>保存训练记录</Button><Button size="sm" variant="outline" disabled={!canEdit||!correction.trim()||!messages.some(m=>m.role==='user')||playbook.faq.length>=100} onClick={()=>{const question=messages.filter(m=>m.role==='user').at(-1)!.content;onApply({faq:[...playbook.faq,{id:crypto.randomUUID(),question,answer:correction}]});toast.success('已加入常见问答草稿，请检查后保存');setCorrection('');}}><Plus className="size-3.5"/>加入问答草稿</Button></div>
   <p className={styles.hint}>加入问答后需保存话术草稿；保存训练记录用于留存本次对练。</p>
   {capabilities.error?<p role="alert" className="mt-3 text-xs text-destructive">模型配置读取失败，请稍后重试。</p>:capabilities.data&&!capabilities.data.analysisAvailable?<p role="status" className={styles.hint}>文字模型尚未就绪，<Link className="text-primary hover:underline" href="/settings/models">前往模型设置</Link>。</p>:null}
  </aside>
 </div>}
 {tab==='recording'&&<div className={styles.recordingLayout}><div className={styles.uploadPanel}><section aria-label="录音上传" className="overflow-hidden rounded-lg border">
  <input ref={fileInputRef} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a" hidden disabled={uploadDisabled} onChange={e=>{chooseRecording(Array.from(e.currentTarget.files??[]));e.currentTarget.value='';}}/>
  <div className={`relative m-4 rounded-lg border border-dashed transition-colors ${dragging?'border-primary bg-primary/5':'border-border hover:border-primary/40 hover:bg-primary/[0.02]'}`}
   onDragEnter={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();if(!uploadDisabled){dragDepthRef.current++;setDragging(true);}}}
   onDragOver={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect=uploadDisabled?'none':'copy';}}
   onDragLeave={e=>{e.preventDefault();dragDepthRef.current=Math.max(0,dragDepthRef.current-1);if(!dragDepthRef.current)setDragging(false);}}
   onDrop={e=>{e.preventDefault();dragDepthRef.current=0;setDragging(false);chooseRecording(Array.from(e.dataTransfer.files));}}>
   <button type="button" aria-label={file?'更换录音文件':'选择录音文件'} aria-describedby={fileHintId} disabled={uploadDisabled} onClick={()=>fileInputRef.current?.click()} className="flex w-full min-w-0 flex-col items-center rounded-lg px-4 py-5 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60">
    <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/5 text-primary"><FileAudio aria-hidden="true" className="size-6"/></span>
    <span className="max-w-full truncate text-sm font-medium" aria-live="polite">{dragging?'松开即可选择录音':file?file.name:'点击上传录音，或拖入文件'}</span>
    {file&&<span className="mt-1 text-xs text-muted-foreground">{(file.size/(1024*1024)).toFixed(2)} MB · 点击更换</span>}
    <span id={fileHintId} className="mt-2 text-xs text-muted-foreground">WAV / MP3 / M4A · 最长10分钟 · 最大20MB</span>
   </button>
   {file&&<Button type="button" size="icon" variant="ghost" className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-destructive" aria-label="移除已选录音" disabled={uploadDisabled} onClick={()=>{setFile(null);setConsent(false);}}><X aria-hidden="true" className="size-4"/></Button>}
  </div>
  {file&&<div className="flex flex-wrap items-center gap-5 px-4 pb-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={normalizeAudio} disabled={uploadDisabled} onChange={event=>setNormalizeAudio(event.target.checked)}/>音量均衡</label><label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={filterAudio} disabled={uploadDisabled} onChange={event=>setFilterAudio(event.target.checked)}/>低频降噪</label><Button type="button" size="sm" variant="outline" disabled={uploadDisabled} onClick={()=>previewRecording.mutate()}>{previewRecording.isPending?<Loader2 className="size-3.5 animate-spin"/>:<Play className="size-3.5"/>}{previewRecording.isPending?'处理中…':'试听处理结果'}</Button></div>}
  {file&&preparedAudio&&<div className="px-4 pb-4"><AudioPlayer src={preparedAudio}/></div>}
  <div className="grid gap-3 border-t bg-muted/10 px-4 py-3"><label className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 accent-primary" checked={consent} disabled={uploadDisabled||!file} onChange={e=>setConsent(e.target.checked)}/>已获录音使用授权，同意由阿里云转写及{capabilities.data?.analysisProvider||'所选文字模型'}分析，按平台标准计费。</label><Button type="button" size="sm" className="w-full" disabled={uploadDisabled||!file||!consent||!capabilities.data?.transcriptionAvailable||!capabilities.data?.analysisAvailable} onClick={()=>upload.mutate()}>{upload.isPending?<Loader2 className="size-3.5 animate-spin"/>:<Upload className="size-3.5"/>}{upload.isPending?'上传中…':'上传并自动提炼'}</Button></div>
  {capabilities.isError&&<p role="alert" className="px-4 pb-3 text-sm text-destructive">模型配置读取失败，请刷新后再上传。</p>}{capabilities.data&&(!capabilities.data.transcriptionAvailable||!capabilities.data.analysisAvailable)&&<p role="alert" className="px-4 pb-3 text-sm text-destructive">请先配置语音识别和文字模型。</p>}
 </section><p className={styles.hint}>录音提炼结果先进入待审核知识，审核后才可被引用；不会直接覆盖话术设置。</p></div>
 <div className={styles.recordingResults}>
 {!records.isPending&&!records.error&&!records.data?.length&&<div className={styles.recordingEmpty}><h3>让录音成为可引用的业务知识</h3><p>上传日常录音后，系统转写并清洗无效内容，提取关键词、客户问题和有效回答。</p><div className={styles.recordingSteps}><div><span>01</span><strong>上传录音</strong><small>支持点击或拖入文件</small></div><div><span>02</span><strong>自动清洗提炼</strong><small>整理关键内容与知识</small></div><div><span>03</span><strong>审核后入库</strong><small>确认内容后供外呼引用</small></div></div></div>}
 {records.error&&<p role="alert" className="text-sm text-destructive">{records.error.message}</p>}
 {records.isPending&&<p role="status" className="text-sm text-muted-foreground">正在读取录音…</p>}
 {!!records.data?.length&&<div className={styles.recordingDetail}><div className={styles.recordingList}>{records.data.map(r=><button key={r.id} onClick={()=>{setSelected(r.id);setAudio('');}} className={`w-full rounded-lg border p-3 text-left ${recording?.id===r.id?'border-primary bg-primary/5':'bg-card'}`}><span className="block truncate text-sm font-medium">{r.name}</span><span className="mt-1 block text-xs text-muted-foreground">{Math.floor(r.durationSeconds/60)}分{r.durationSeconds%60}秒 · {r.knowledgeDocument?.deletedAt?'知识已归档':r.knowledgeDocument?.status==='COMPLETED'?'知识已审核':statusNames[r.status]||'状态待确认'}</span></button>)}</div>
 {recording&&<div className="min-w-0 space-y-4 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="min-w-0 truncate text-sm font-semibold">{recording.name}</h3><div className="flex gap-2"><Button size="sm" variant="outline" disabled={play.isPending} onClick={()=>play.mutate({recording})}><Play className="size-3.5"/>回听原录音</Button>{canEdit&&<Button size="sm" variant="ghost" disabled={['PROCESSING','QUEUED'].includes(recording.status)||archive.isPending} onClick={()=>archive.mutate(recording.id)}>归档</Button>}</div></div>{audio&&<audio ref={audioElementRef} controls src={audio} onLoadedMetadata={()=>{if(audioElementRef.current)audioElementRef.current.currentTime=audioStartRef.current;}} className="h-10 w-full"/>}
 {recording.status==='UPLOADED'&&<Button size="sm" title="提交阿里云转写及所选文字模型分析" disabled={!canEdit||learn.isPending||!capabilities.data?.transcriptionAvailable||!capabilities.data?.analysisAvailable} onClick={()=>learn.mutate(recording.id)}><BrainCircuit className="size-3.5"/>开始自动整理</Button>}
 {['PROCESSING','QUEUED'].includes(recording.status)&&<div role="status" className="rounded-lg border bg-primary/[0.025] p-4"><div className="flex items-center gap-2 text-sm font-medium text-primary"><Loader2 className="size-4 animate-spin"/>{recording.status==='QUEUED'?'已进入处理队列':recording.analysis?.stage==='EXTRACTING'?'正在清洗、识别关键词与提取知识':'正在转写原始录音'}</div><div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs text-muted-foreground">{['录音上传','原文转写','清洗提炼','等待审核'].map((label,i)=><div key={label} className={`rounded-md px-2 py-2 ${i===0||(i===1&&recording.status==='PROCESSING')||(i===2&&recording.analysis?.stage==='EXTRACTING')?'bg-primary/10 text-primary':'bg-muted/30'}`}>{label}</div>)}</div></div>}
 {recording.error&&<p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm leading-6 text-destructive">{recording.error}</p>}
 {recording.transcript&&<details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">原始转写</summary><p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm leading-6">{recording.transcript}</p></details>}
 {recording.status==='READY'&&recording.analysis&&<RecordingReview key={recording.id} recording={recording} agentId={agentId} org={org} canEdit={canEdit&&!upload.isPending&&capabilities.data?.canManageKnowledge===true} onRefresh={refresh} onListen={seconds=>play.mutate({recording,seconds})}/>}
 </div>}</div>}</div></div>}
 {tab==='history'&&<div className={styles.history}>{history.isPending?<p className="text-sm text-muted-foreground">正在读取训练记录…</p>:history.error?<p role="alert" className="text-sm text-destructive">{history.error.message}</p>:!history.data?.length?<div className="py-10 text-center"><BookOpenCheck className="mx-auto size-8 text-muted-foreground"/><p className="mt-3 text-sm">暂无保存的训练记录</p></div>:history.data.map(r=><details key={r.id} ><summary className="cursor-pointer text-sm">{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.messages.filter(m=>m.role==='user').length}轮对练</summary><div className="mt-4 space-y-3">{r.messages.map((m,i)=><p key={i} className="text-sm leading-6"><strong>{m.role==='user'?'客户':'数字员工'}：</strong>{m.content}</p>)}{r.correction&&<p className="rounded-lg bg-primary/5 p-3 text-sm leading-6"><strong>纠正意见：</strong>{r.correction}</p>}</div></details>)}</div>}
 </section>;
}
