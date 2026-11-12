/*
 * 中文导读：数字员工与话术的 PersonalScriptEditor 组件，封装该界面的展示与交互。
 */
"use client";
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Save,RefreshCw} from 'lucide-react';
import {personalPlaybookApi,type PersonalPlaybookView} from '@/src/lib/api/resources/playbook';
import {personalVoices} from '@/src/lib/api/resources/personal-voices';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {Button} from '../ui/button';
import {VoiceOpeningPicker} from './studio/VoiceOpeningPicker';
import {toast} from '@/src/lib/toast';

type Props={agentId:string;mode?:'voice'|'questions';onDirtyChange?:(dirty:boolean)=>void};
export function PersonalScriptEditor({agentId,mode='questions',onDirtyChange}:Props){
 const {org,user}=useAliyunIdentity();
 const query=useQuery({queryKey:['my-playbook',user,org,agentId],queryFn:()=>personalPlaybookApi.get(agentId,org),enabled:!!org&&!!user,refetchOnWindowFocus:false,retry:false});
 if(query.isPending)return <p className="p-5">正在读取统一话术…</p>;
 if(!query.data)return <div role="alert" className="p-5"><p>{query.error?.message}</p><Button onClick={()=>void query.refetch()}>重新加载</Button></div>;
 return <Editor key={user+org+agentId+mode} agentId={agentId} mode={mode} initial={query.data} onDirtyChange={onDirtyChange}/>;
}
function Editor({agentId,mode,initial,onDirtyChange}:Props&{initial:PersonalPlaybookView}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [saved,setSaved]=useState(initial),[draft,setDraft]=useState(()=>structuredClone(initial.playbook)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),dirty=JSON.stringify(draft)!==JSON.stringify(saved.playbook);
 const catalog=useQuery({queryKey:['my-voice',user,org,agentId],queryFn:()=>personalVoices.catalog(org,agentId),enabled:mode==='voice'&&!!org&&!!user,retry:false});
 const options=catalog.data?.providers.find(p=>p.provider==='HAOKEHU_SIP')?.options.filter(v=>v.kind==='clone'&&v.available)||[];
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
 useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
 function accept(next:PersonalPlaybookView){setSaved(next);setDraft(structuredClone(next.playbook));qc.setQueryData(['my-playbook',user,org,agentId],next);void qc.invalidateQueries({queryKey:['my-voice']});}
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{accept(await personalPlaybookApi.save(agentId,{playbook:draft,placeholders:saved.placeholders,expectedRevision:saved.revision,baseReleaseId:saved.baseReleaseId},org));toast.success('已保存，用于本账号的新通话');}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{lock.current=false;setBusy(false);}}
 async function reload(){setBusy(true);try{accept(await personalPlaybookApi.get(agentId,org));setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
 function chooseVoice(voiceId:string){if(!voiceId)return;setDraft(p=>{if(voiceId===saved.playbook.recordingReplies?.voiceId)return {...p,recordingReplies:structuredClone(saved.playbook.recordingReplies)};const entries={...p.recordingReplies?.entries};delete entries['opening-recordings'];for(const key of Object.keys(entries))entries[key]={mode:'ai',clips:[]};return {...p,recordingReplies:{version:1,voiceId,entries}};});}
 const flow=draft.publishedFlow||draft.canvas;
 return <div className="space-y-5 p-5"><header className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{mode==='voice'?'我的通话声音':'统一话术'}</h2>{mode==='voice'&&<Button size="sm" disabled={busy||!dirty} onClick={()=>void save()}><Save className="size-3.5"/>{busy?'保存中…':'保存'}</Button>}</header>
 {error&&<div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm"><p className="text-destructive">{error}</p><Button size="sm" variant="outline" onClick={()=>void reload()}><RefreshCw className="size-3.5"/>放弃修改并读取最新设置</Button></div>}
 {mode==='voice'?<><VoiceOpeningPicker key={saved.revision} voiceOnly value={draft.recordingReplies?.voiceId||saved.configuration.profile.voiceId||''} options={options.map(v=>({voiceId:v.voiceId,name:v.name}))} disabled={busy||catalog.isPending} canManage={catalog.data?.canUpdateLibrary} onChange={chooseVoice}/>{catalog.error&&<p role="alert" className="text-sm text-destructive">{catalog.error.message}</p>}</>:<>
 <p className="text-sm text-muted-foreground">话术由管理员统一维护，此处为已发布版本。</p>
 {[['身份',draft.identity],['通话目标',draft.purpose],['开场白',draft.opening],['AI 工作指令',draft.aiInstructions||draft.baseInstructions],['禁止回答与承诺',draft.conversationRules?.forbiddenAnswers],['结束条件',draft.conversationRules?.hangupConditions]].filter(([,value])=>value).map(([label,value])=><div key={label}><h3 className="text-sm font-medium">{label}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{value}</p></div>)}
 {(flow?.nodes||draft.flow.map(n=>({id:n.id,title:n.title,text:n.instruction}))).filter(n=>n.text).map(n=><div key={n.id}><h3 className="text-sm font-medium">{n.title}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{n.text}</p></div>)}
 {draft.faq.map(x=><div key={x.id}><h3 className="text-sm font-medium">{x.question}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{x.answer}</p></div>)}
 {draft.objections.map(x=><div key={x.id}><h3 className="text-sm font-medium">{x.trigger}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{x.response}</p></div>)}
 </>}
 </div>;
}
