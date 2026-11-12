/*
 * 中文导读：数字员工与话术的 VoiceOpeningPicker 组件，封装该界面的展示与交互。
 */
"use client";
import Link from 'next/link';
import {useEffect,useId,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Headphones,AudioLines,Loader2,Pencil,Save} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi} from '@/src/lib/api/resources/telephony';
import {customOpenings,type GeneratedOpening} from '@/src/lib/api/resources/custom-openings';
import type {ConversationPlaybook} from '@/src/lib/api/resources/playbook';
import {Button} from '../../ui/button';
import {NativeSelect} from '../../ui/native-select';
import {Textarea} from '../../ui/textarea';

type CustomOpeningProps={agentId:string;scope:'template'|'personal';playbook:ConversationPlaybook;onChange:(patch:Partial<ConversationPlaybook>)=>void;onDraftChange?:(dirty:boolean,busy:boolean)=>void};
export function VoiceOpeningPicker({value,options,disabled,canManage,onChange,custom,voiceOnly=false}:{value:string;options:{voiceId:string;name:string}[];disabled:boolean;canManage?:boolean;onChange:(id:string)=>void;custom?:CustomOpeningProps;voiceOnly?:boolean}){
 const {org,user}=useAliyunIdentity(),[audio,setAudio]=useState(''),[label,setLabel]=useState(''),url=useRef('');
 const qc=useQueryClient();
 const [correction,setCorrection]=useState<{voiceId:string;text:string;updatedAt:string}|null>(null),[corrected,setCorrected]=useState(false);
 const [mode,setMode]=useState<'library'|'generated'>(custom?.playbook.recordingReplies?.openingSource==='generated'?'generated':'library');
 const [text,setText]=useState(custom?.playbook.opening||'');
 const [generation,setGeneration]=useState<GeneratedOpening|null>(null),[generationError,setGenerationError]=useState('');
 const [generating,setGenerating]=useState(false),[touched,setTouched]=useState(false);
 const generationLock=useRef(false),request=useRef<{id:string;signature:string;retryOf?:string}|null>(null),textId=useId();
 const source=custom?.playbook.recordingReplies?.openingSource;
 const asset=custom?.playbook.recordingReplies?.entries['opening-recordings']?.clips[0];
 const currentReady=mode==='generated'&&source==='generated'&&!!asset&&custom?.playbook.opening.trim()===text.trim()&&asset.voiceId===value;
 const draftPending=mode==='generated'&&!currentReady;
 const invalidText=!text.trim()?'请填写开场白。':text.trim().length>300?'开场白最多 300 字。':/\{\{/.test(text)?'生成开场白请使用固定文字，去掉姓名等动态变量。':'';
 const correcting=useMutation({mutationFn:(input:{voiceId:string;text:string;updatedAt:string})=>telephonyApi.saveVoiceOpening(org,input.voiceId,input.text.trim(),input.updatedAt),onSuccess:(result,input)=>{
  qc.setQueryData(['voice-opening',org,user,input.voiceId],result);
  void qc.invalidateQueries({queryKey:['my-voice',user,org]});
  if(custom&&value===input.voiceId&&mode==='library')custom.onChange({opening:result.text,...(custom.playbook.canvas?{canvas:{...custom.playbook.canvas,nodes:custom.playbook.canvas.nodes.map(n=>n.id===custom.playbook.canvas!.entry?{...n,text:result.text}:n)}}:{}),...(custom.playbook.publishedFlow?{publishedFlow:{...custom.playbook.publishedFlow,nodes:custom.playbook.publishedFlow.nodes.map(n=>n.id===custom.playbook.publishedFlow!.entry?{...n,text:result.text}:n)}}:{})});
  setCorrection(null);setCorrected(true);
 }});
 useEffect(()=>{custom?.onDraftChange?.(draftPending||!!correction,generating||correcting.isPending);},[draftPending,correction,generating,correcting.isPending,custom?.onDraftChange]);
 useEffect(()=>()=>custom?.onDraftChange?.(false,false),[custom?.onDraftChange]);
 useEffect(()=>{setAudio('');setCorrected(false);setCorrection(null);if(url.current){URL.revokeObjectURL(url.current);url.current='';}return()=>{if(url.current)URL.revokeObjectURL(url.current);};},[value]);
 function showAudio(blob:Blob,audioLabel:string){if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio(url.current);setLabel(audioLabel);}
 const detail=useQuery({queryKey:['voice-opening',org,user,value],queryFn:()=>telephonyApi.voiceOpening(org,value),enabled:!!org&&!!value&&!voiceOnly,retry:false});
 const play=useMutation({mutationFn:(kind:'opening'|'ai'|'generated')=>kind==='opening'?telephonyApi.openingAudio(org,value):kind==='generated'&&custom&&asset?customOpenings.audio(org,custom.agentId,asset.assetId):telephonyApi.currentVoicePreview(org,value),onSuccess:(blob,kind)=>showAudio(blob,kind==='opening'?'原声开场白':kind==='generated'?'自定义开场白':'当前调试的 AI 试听')});
 function selectMode(next:'library'|'generated'){
  if(generating||disabled)return;setMode(next);setAudio('');setGenerationError('');
  if(next==='library'&&custom){const text=detail.data?.text||custom.playbook.opening;const entries={...custom.playbook.recordingReplies?.entries};delete entries['opening-recordings'];custom.onChange({opening:text,...(custom.playbook.canvas?{canvas:{...custom.playbook.canvas,nodes:custom.playbook.canvas.nodes.map(n=>n.id===custom.playbook.canvas!.entry?{...n,text}:n)}}:{}),...(custom.playbook.publishedFlow?{publishedFlow:{...custom.playbook.publishedFlow,nodes:custom.playbook.publishedFlow.nodes.map(n=>n.id===custom.playbook.publishedFlow!.entry?{...n,text}:n)}}:{}),recordingReplies:{version:1,...custom.playbook.recordingReplies,voiceId:value,openingSource:'library',entries}});}
 }
 async function generate(){
  if(!custom||generationLock.current||disabled)return;setTouched(true);if(invalidText||!value)return;
  const signature=JSON.stringify([custom.agentId,custom.scope,value,text.trim()]);
  const previous=request.current;
  const token=previous?.signature===signature?previous:{id:crypto.randomUUID(),signature};request.current=token;
  generationLock.current=true;setGenerating(true);setGenerationError('');
  try{
   const result=await customOpenings.generate(org,custom.agentId,{scope:custom.scope,voiceId:value,text:text.trim(),requestId:token.id,...(token.retryOf?{retryOf:token.retryOf}:{}),confirmed:true});setGeneration(result);
   if(result.status==='READY'&&result.asset){
    const clip={assetId:result.asset.id,voiceId:result.asset.voiceId,textHash:result.asset.textHash};
    custom.onChange({opening:text.trim(),...(custom.playbook.publishedFlow?{publishedFlow:{...custom.playbook.publishedFlow,nodes:custom.playbook.publishedFlow.nodes.map(node=>node.id===custom.playbook.publishedFlow!.entry?{...node,text:text.trim()}:node)}}:{}),...(custom.playbook.canvas?{canvas:{...custom.playbook.canvas,nodes:custom.playbook.canvas.nodes.map(node=>node.id===custom.playbook.canvas!.entry?{...node,text:text.trim()}:node)}}:{}),recordingReplies:{version:1,...custom.playbook.recordingReplies,voiceId:value,openingSource:'generated',entries:{...custom.playbook.recordingReplies?.entries,'opening-recordings':{mode:'recording-first',clips:[clip],openingPlayback:'fixed',selectedOpeningId:result.asset.id}}}});
    const blob=result.audio?new Blob([Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0))],{type:'audio/wav'}):await customOpenings.audio(org,custom.agentId,result.asset.id);showAudio(blob,'自定义开场白');
   }else if(result.status==='NEEDS_REVIEW')setGenerationError(result.error||'生成未完成，可点击重新生成。');
  }catch(error){setGenerationError(error instanceof Error?error.message:'生成结果暂时无法确认，请点击查询生成结果。');}
  finally{generationLock.current=false;setGenerating(false);}
 }
 function retry(){if(!generation||generation.status!=='NEEDS_REVIEW')return;request.current={id:crypto.randomUUID(),signature:JSON.stringify([custom?.agentId,custom?.scope,value,text.trim()]),retryOf:generation.requestId};void generate();}
 const locked=disabled||generating||play.isPending||!!correction;
 return <div className="max-w-3xl space-y-4">
 <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-52 max-w-sm flex-1 gap-2 text-sm font-medium">通话声音<NativeSelect aria-label="开场白与AI回答的声音" value={value} disabled={locked} onChange={e=>{onChange(e.target.value);setGeneration(null);setGenerationError('');setAudio('');}}><option value="">请选择声音</option>{value&&!options.some(o=>o.voiceId===value)&&<option value={value} disabled>原声音暂不可用，请重新选择</option>}{options.map(o=><option key={o.voiceId} value={o.voiceId}>{o.name}</option>)}</NativeSelect></label>{canManage&&<Link href="/voices" className="py-2 text-xs text-primary hover:underline">管理声音库</Link>}</div>
 {!voiceOnly&&custom&&<div className="flex flex-wrap items-center gap-2" role="group" aria-label="开场白来源"><Button type="button" size="sm" variant={mode==='library'?'secondary':'ghost'} aria-pressed={mode==='library'} disabled={locked} onClick={()=>selectMode('library')}>原声录音</Button><Button type="button" size="sm" variant={mode==='generated'?'secondary':'ghost'} aria-pressed={mode==='generated'} disabled={locked} onClick={()=>selectMode('generated')}>文字生成</Button></div>}
 {voiceOnly?<div className="space-y-3 rounded-md border p-4"><p className="text-sm text-muted-foreground">新通话使用管理员发布的开场话术。声音与统一录音不同时，开场由所选声音实时朗读，效果可能与原声录音不同。</p>{value&&<Button type="button" size="sm" variant="outline" disabled={play.isPending} onClick={()=>play.mutate('ai')}><Headphones className="size-3.5"/>试听声音</Button>}</div>:mode==='generated'&&custom?<div className="space-y-3 rounded-md border p-4">
  <div className="flex items-center justify-between gap-3"><label htmlFor={textId} className="text-sm font-medium">自定义开场白</label><span className="text-xs text-muted-foreground">{text.length} / 300</span></div>
  <Textarea id={textId} rows={4} maxLength={300} value={text} disabled={locked} placeholder="输入接通电话后要说的第一句话" aria-invalid={touched&&!!invalidText} aria-describedby={touched&&invalidText?`${textId}-error`:undefined} onBlur={()=>setTouched(true)} onChange={e=>{setText(e.target.value);setGeneration(null);setGenerationError('');setAudio('');}}/>
  {touched&&invalidText&&<p id={`${textId}-error`} className="text-xs text-destructive">{invalidText}</p>}
  <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" disabled={locked||!value||!text.trim()} onClick={()=>generation?.status==='NEEDS_REVIEW'?retry():void generate()}>{generating?<Loader2 className="size-3.5 animate-spin"/>:<AudioLines className="size-3.5"/>}{generating?'正在生成…':generation?.status==='NEEDS_REVIEW'?'重新生成':generation?.status==='GENERATING'||generationError&&request.current?'查询生成结果':currentReady?'重新生成':'生成开场白'}</Button>{currentReady&&<Button type="button" size="sm" variant="outline" disabled={play.isPending||generating} onClick={()=>play.mutate('generated')}><Headphones className="size-3.5"/>试听</Button>}<span className="text-xs text-muted-foreground" role="status">{generating?'使用所选复刻声音生成，请稍候。':currentReady?'已生成，请保存话术。':'生成并试听后，再保存话术。'}</span></div>
  {generationError&&<p role="alert" className="text-xs text-destructive">{generationError}</p>}
  {generation?.status==='GENERATING'&&<p role="status" className="text-xs text-muted-foreground">声音仍在生成，点击“查询生成结果”查看进度。</p>}
 </div>:value&&detail.data?<div className="rounded-md border bg-muted/10 p-4"><div className="mb-3 flex flex-wrap items-center gap-2"><AudioLines className="size-4 text-muted-foreground"/><span className="text-sm font-medium">原声开场白</span><span className="text-xs text-muted-foreground">{detail.data.durationSeconds.toFixed(1)} 秒</span><Button type="button" size="icon-sm" variant="ghost" className="ml-auto size-7" aria-label="试听原声开场白" disabled={play.isPending} onClick={()=>play.mutate('opening')}><Headphones className="size-3.5"/></Button>{canManage&&detail.data.ready&&!correction&&<Button type="button" size="sm" variant="ghost" disabled={locked} onClick={()=>{setCorrection({voiceId:value,text:detail.data.text,updatedAt:detail.data.updatedAt});setCorrected(false);correcting.reset();}}><Pencil className="size-3.5"/>编辑文字</Button>}</div>
 {correction?<div className="space-y-3"><label className="grid gap-2 text-sm">开场白转写文字<Textarea rows={5} maxLength={4000} value={correction.text} disabled={correcting.isPending} onChange={e=>setCorrection({...correction,text:e.target.value})}/></label><p className="text-xs leading-5 text-muted-foreground">保存会更正声音库中共享的转写文字，原录音保持原样。当前话术的修改还需保存话术。</p>{correcting.error&&<p role="alert" className="text-xs text-destructive">{correcting.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={correcting.isPending} onClick={()=>{setCorrection(null);correcting.reset();}}>取消</Button><Button type="button" size="sm" disabled={correcting.isPending||!correction.text.trim()||correction.text.trim()===detail.data.text} onClick={()=>correcting.mutate(correction)}>{correcting.isPending?<Loader2 className="size-3.5 animate-spin"/>:<Save className="size-3.5"/>}{correcting.isPending?'保存中…':'保存文字'}</Button></div></div>:<><p className="whitespace-pre-wrap text-sm leading-7">{detail.data.text||'开场文字识别中…'}</p>{corrected&&<p role="status" className="mt-2 text-xs text-muted-foreground">转写文字已保存</p>}</>}
 <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground"><span>AI 回答使用本人的复刻声音</span><Button type="button" size="sm" variant="ghost" disabled={play.isPending||correcting.isPending} onClick={()=>play.mutate('ai')}><Headphones className="size-3.5"/>AI 试听</Button></div></div>:<p className="text-sm text-muted-foreground">{value?detail.isPending?'正在读取开场白…':detail.error?.message:'选择后使用本人的开场白和 AI 声音。'}</p>}
 {play.error&&<p role="alert" className="text-xs text-destructive">{play.error.message}</p>}{audio&&<div className="flex flex-wrap items-center gap-3"><span className="text-xs text-muted-foreground">{label}</span><audio autoPlay controls className="h-8 max-w-full" src={audio}/></div>}
 </div>;
}
