/*
 * 中文导读：线路与语音外呼的 PersonalVoiceSettings 组件，封装该界面的展示与交互。
 */
"use client";

import {VoiceSelect, type VoiceSelectOption} from './VoiceSelect';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Headphones,Loader2,Volume2, Save, RefreshCw, UserRound, ChevronDown } from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {personalVoices,type CallVoiceProvider,type PersonalVoiceCatalog,type PersonalVoiceProvider,type PersonalVoicePreview} from '@/src/lib/api/resources/personal-voices';
import {voiceModelNames} from '@/src/lib/api/resources/telephony';
import {personalVoiceLabel} from '@/src/lib/voice-labels';
import {Button} from '../ui/button';
import {toast} from '@/src/lib/toast';
import {useVoiceExpressionPolicy} from './use-voice-expression-policy';
import {previewWav} from './employee-voice-audio';
import styles from '../agents/employee-settings.module.css';

const genders={neutral:'',female:'女声',male:'男声'};

function PersonalAudition({agentId,provider,choice,volume,playbackVolume,available}:{agentId:string;provider:CallVoiceProvider;choice:string;volume:number|null;playbackVolume:number;available:boolean}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<PersonalVoicePreview|null>(null);
 const [sample,setSample]=useState<Blob|null>(null),[url,setUrl]=useState('');
 const lock=useRef(false),request=useRef<string>(crypto.randomUUID()),audio=useRef<HTMLAudioElement>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let source='';
  try{
   const blob=result?.kind==='model'&&result.status==='READY'&&result.audio?previewWav(result.audio,playbackVolume):sample;
   if(blob)source=URL.createObjectURL(blob);
   setUrl(source);
  }catch(e){setError(e instanceof Error?e.message:'试听音频无法播放。');}
  return()=>{if(source)URL.revokeObjectURL(source);};
 },[result,sample,playbackVolume]);
 useEffect(()=>{if(audio.current)audio.current.volume=provider==='ALIYUN_ENGINE'?Math.max(0,Math.min(1,playbackVolume/100)):1;},[url,provider,playbackVolume]);
 async function audition(){
  if(lock.current||!available)return;
  lock.current=true;setBusy(true);setError('');
  const retryOf=result?.kind==='model'&&result.status==='NEEDS_REVIEW'?result.requestId:undefined;
  if(retryOf)request.current=crypto.randomUUID();
  try{
   const answer=await personalVoices.preview(org,agentId,{provider,choice,volume,requestId:request.current,...(retryOf?{retryOf}:{}),confirmed:true});
   if(!mounted.current)return;
   setResult(answer);
   if(answer.kind==='sample'){
    const clip=await personalVoices.sample(org,agentId,answer.voiceId);
    if(mounted.current)setSample(clip);
   }else request.current=answer.requestId;
   void qc.invalidateQueries({queryKey:['model-usage',user,org]});
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'试听暂不可用。');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 const waiting=result?.kind==='model'&&result.status==='GENERATING';
 const retry=result?.kind==='model'&&result.status==='NEEDS_REVIEW';
 return <div className="space-y-2">
  <Button type="button" size="sm" variant="outline" disabled={!available||busy} onClick={()=>{if(url&&audio.current){audio.current.currentTime=0;void audio.current.play().catch(()=>setError('请点击播放器播放。'));}else void audition();}}>
   {busy?<Loader2 aria-hidden="true" className="size-3.5 animate-spin"/>:<Headphones aria-hidden="true" className="size-3.5"/>}{busy?'准备中…':waiting?'查看结果':retry?'重新试听':'试听'}
  </Button>
  {url&&<audio ref={audio} key={url} aria-label="我的通话声音试听" controls autoPlay className="h-8 w-64 max-w-full" src={url}/>}
  {error&&<p role="alert" className="max-w-sm text-xs text-destructive">{error}</p>}
  {result?.kind==='model'&&result.status==='NEEDS_REVIEW'&&<p role="status" className="max-w-sm text-xs text-amber-700 dark:text-amber-300">{result.error}</p>}
  {waiting&&<p role="status" className="text-xs text-muted-foreground">试听正在生成，稍后点击查看结果。</p>}
 </div>;
}

function VoicePreferences({agentId,data,onSaved,compact,embedded,showVoiceLabel,onDirtyChange}:{agentId:string;data:PersonalVoiceProvider;onSaved:(value:PersonalVoiceCatalog)=>void;compact:boolean;embedded:boolean;showVoiceLabel:boolean;onDirtyChange?:(dirty:boolean)=>void}){
 const {org}=useAliyunIdentity();
 const policy=useVoiceExpressionPolicy();
 const [choice,setChoice]=useState(data.choice),[volume,setVolume]=useState(data.volume),[useAsDefault,setUseAsDefault]=useState(false);
 const maxVolume=data.provider==='ALIYUN_ENGINE'?100:150;
 const effectiveKey=choice||data.accountDefault?.choice||'company';
 const companyVoices=data.options.filter(v=>v.kind!=='builtin');
 const systemVoices=data.options.filter(v=>v.kind==='builtin');
 const selected=data.options.find(v=>v.key===effectiveKey);
 const sound=effectiveKey==='company'?data.companyDefault:selected;
 const describe=(voice:typeof sound)=>voice?`${personalVoiceLabel(voice)}${voice.model?' · '+(voiceModelNames[voice.model]||voice.model):''}`:'声音暂不可用';
 const inheritedChoice=data.accountDefault?.choice||'company';
 const inheritedSound=inheritedChoice==='company'?data.companyDefault:data.options.find(v=>v.key===inheritedChoice);
 const inheritedLabel=(data.accountDefault?.choice?'沿用账号偏好：':'沿用员工声音：')+describe(inheritedSound);
 const inheritedVolume=data.accountDefault?.volume??data.companyDefault?.volume??100;
 const playbackVolume=Math.min(maxVolume,volume??inheritedVolume);
 const changed=choice!==data.choice||volume!==data.volume||useAsDefault;
 useEffect(()=>{onDirtyChange?.(changed);return()=>onDirtyChange?.(false);},[changed,onDirtyChange]);
 const save=useMutation({mutationFn:()=>personalVoices.save(org,agentId,{provider:data.provider,choice,volume,useAsDefault,expectedUpdatedAt:data.updatedAt,expectedDefaultUpdatedAt:data.accountDefault?.updatedAt??null}),onSuccess:r=>{onSaved(r);toast.success(process.env.NEXT_PUBLIC_LOCAL_PREVIEW==='true'?'个人声音偏好已保存到本地':useAsDefault?'我的通话声音及默认音色已保存':'我的通话声音已保存');},onError:(e:Error)=>toast.error(e.message)});
 const voiceOptions:VoiceSelectOption[]=[
  {value:'',label:inheritedLabel,group:'沿用设置'},
  {value:'company',label:'员工已发布声音：'+describe(data.companyDefault),group:'沿用设置'},
  ...(choice&&choice!=='company'&&!data.options.some(v=>v.key===choice)?[{value:choice,label:'原音色已不可用，请重新选择',disabled:true}]:[]),
  ...companyVoices.map(v=>({value:v.key,label:personalVoiceLabel(v)+(genders[v.gender]?' · '+genders[v.gender]:'')+(v.available?'':'（暂不可用）'),group:data.provider==='HAOKEHU_SIP'?'公司真人复刻声音':'公司授权音色',disabled:!v.available,keywords:[v.voice,voiceModelNames[v.model]||v.model]})),
  ...systemVoices.map(v=>({value:v.key,label:personalVoiceLabel(v)+(genders[v.gender]?' · '+genders[v.gender]:'')+' · '+(voiceModelNames[v.model]||v.model)+(v.available?'':'（暂不可用）'),group:'系统音色',disabled:!v.available,keywords:[v.voice,v.model]})),
 ];
 const available=effectiveKey==='company'?!!data.companyDefault&& (data.provider==='HAOKEHU_SIP'||data.options.some(v=>v.voice===data.companyDefault?.ttsVoiceCode&&v.hasPreview&&v.available)):!!selected?.available&&!!selected.hasPreview;
 if(data.provider==='HAOKEHU_SIP')return <div className="flex flex-wrap items-center gap-3 text-sm"><span>当前声音：{data.effective?.name||'尚未选择'}</span><Button asChild size="sm" variant="outline"><a href={'/agents/'+agentId+'?tab=script'}>选择开场声音</a></Button><a href="/voices" className="text-xs text-primary hover:underline">管理声音库</a>{data.error&&<p role="alert" className="w-full text-xs text-destructive">{data.error}</p>}</div>;
 return <div className={compact?'space-y-3':'space-y-4'}>
  <div className={embedded?styles.personalGrid:'space-y-3'}>
  <div className={embedded?styles.personalSelection:'flex flex-wrap items-start gap-3'}>
   <div className="grid min-w-48 flex-1 gap-2 text-sm"><span className={showVoiceLabel?undefined:"sr-only"}>通话音色</span>
    <VoiceSelect label="我的通话音色" value={choice} options={voiceOptions} disabled={save.isPending} onChange={next=>{setChoice(next);if(!next)setUseAsDefault(false);}}/>
   </div>
   <div className={showVoiceLabel?"pt-7":undefined}><PersonalAudition key={data.provider+':'+choice+':'+effectiveKey+':'+policy.signature} agentId={agentId} provider={data.provider} choice={effectiveKey} volume={volume} playbackVolume={playbackVolume} available={available&&(data.provider==='ALIYUN_ENGINE'||policy.ready)}/></div>
  </div>
  <div className={embedded?styles.personalControls:'flex flex-wrap items-center gap-x-5 gap-y-3'}>
   <div className="flex flex-wrap items-center gap-2">
   <p className="text-xs text-muted-foreground">通话音量：{data.effective?.volume ?? 100}% · 跟随统一声音设置</p>
   </div>
   <div className={embedded?styles.personalActions:'flex flex-wrap items-center gap-3'}>
   <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-primary" disabled={!choice||save.isPending} checked={useAsDefault} onChange={e=>setUseAsDefault(e.target.checked)}/>同时设为我的默认</label>
   <Button type="button" size="sm" disabled={save.isPending||!changed||(effectiveKey!=='company'&&!selected?.available)} onClick={()=>save.mutate()}><Save aria-hidden="true" className="size-4" />{save.isPending?'保存中…':'保存我的声音'}</Button>
   </div>
  </div>
  </div>
  <div className="flex flex-wrap items-center gap-3 text-xs">
   {sound&&<span className="text-muted-foreground">{changed?'待保存':'当前使用'}：<span className="font-medium text-foreground">{personalVoiceLabel(sound)}</span>{genders[sound.gender]?' · '+genders[sound.gender]:''}</span>}
   {changed?<span role="status" className="text-amber-700 dark:text-amber-300">有未保存修改</span>:data.error?<span role="alert" className="text-destructive">{data.error}</span>:null}
   {!changed&&data.effective?.source==='default'&&<span className="text-muted-foreground">来自账号声音偏好</span>}
  </div>
 </div>;
}

export function PersonalVoiceSettings({agentId,provider,compact=false,embedded=false,showHeader=true,showVoiceLabel=true,onDirtyChange}:{agentId:string;provider?:CallVoiceProvider;compact?:boolean;embedded?:boolean;showHeader?:boolean;showVoiceLabel?:boolean;onDirtyChange?:(dirty:boolean)=>void}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const selectedProvider=provider??'HAOKEHU_SIP';
 const q=useQuery({queryKey:['my-voice',user,org,agentId],queryFn:()=>personalVoices.catalog(org,agentId),enabled:!!org&&!!user&&!!agentId,retry:false,staleTime:15000,refetchOnWindowFocus:false});
 const data=q.data?.providers.find(p=>p.provider===selectedProvider);
 const saved=(value:PersonalVoiceCatalog)=>{qc.setQueryData(['my-voice',user,org,agentId],value);void qc.invalidateQueries({queryKey:['my-voice',user,org]});};
 const content=<>
  {q.isPending?<p className="text-sm text-muted-foreground">正在读取我的声音…</p>:q.error?<div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{q.error.message}</p><Button type="button" size="xs" variant="ghost" onClick={()=>void q.refetch()}><RefreshCw aria-hidden="true" className="size-4" />重新加载</Button></div>:data?<VoicePreferences key={user+org+agentId+selectedProvider+JSON.stringify([data.choice,data.volume,data.updatedAt,data.accountDefault])} agentId={agentId} data={data} onSaved={saved} compact={compact} embedded={embedded} showVoiceLabel={showVoiceLabel} onDirtyChange={onDirtyChange}/>:<p role="status" className="text-sm text-muted-foreground">此线路暂未提供个人声音设置。</p>}
 </>;
 if(!showHeader)return <div className="min-w-0">{content}</div>;
 if(embedded)return <details className={styles.settings+' '+styles.personal+' group'}>
  <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><UserRound aria-hidden="true" className="size-4 text-primary"/>个人声音偏好<span className="ml-auto text-xs font-normal text-muted-foreground">{data?.effective?.source==='agent'?'已单独设置':data?.effective?.source==='default'?'沿用账号偏好':'沿用员工声音'}</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground group-open:rotate-180"/></summary>
  <div className="pt-4"><p className="mb-4 text-xs leading-5 text-muted-foreground">可选择公司已开放的真人复刻声音，保存后用于你新建的外呼任务。也可在新建任务时选择，仅影响你自己的声音。</p>{content}</div>
 </details>;
 return <section aria-label="我的通话声音" className={compact?'rounded-lg border bg-muted/10 p-4':'space-y-4 rounded-xl border bg-card p-5'}><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><UserRound aria-hidden="true" className="size-4 text-primary"/>我的通话声音</h3><p className="mb-4 text-xs leading-5 text-muted-foreground">选择公司开放的真人复刻声音；保存后本次新建任务采用此声音，也可沿用数字员工默认声音。</p>{content}</section>;
}
