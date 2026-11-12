/*
 * 中文导读：声音库调试与语音参数设置界面。
 */
"use client";
import {useCallback,useEffect,useRef,useState,type MutableRefObject} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Headphones,SlidersHorizontal,Loader2,Save,RefreshCw,Play,Pencil,ChevronDown} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type Voice,type VoiceOpeningDetail} from '@/src/lib/api/resources/telephony';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {ApiError} from '@/src/lib/errors';
import {toast} from '@/src/lib/toast';
import {DeliveryForm,type Delivery} from './VoiceDeliverySettings';
import {Button} from '../ui/button';
import {Textarea} from '../ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '../ui/dialog';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '../ui/tabs';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '../ui/alert-dialog';

import {VoiceAccessDialog} from './VoiceAccessDialog';
import {refreshVoiceLibrary} from './voice-library-cache';
import {VoiceTrainingRoom} from './VoiceTrainingRoom';

export function VoiceControlCenter({voice,label='调试声音',canManageAccess=false}:{voice:Voice;label?:string;canManageAccess?:boolean}){
 const [open,setOpen]=useState(false),[discard,setDiscard]=useState(false),[advanced,setAdvanced]=useState(false);
 const guard=useRef({opening:false,tuning:false,training:false});
 function close(){if(guard.current.opening||guard.current.tuning||guard.current.training)setDiscard(true);else setOpen(false);}
 return <><Button type="button" size="sm" variant="ghost" onClick={()=>{guard.current={opening:false,tuning:false,training:false};setAdvanced(false);setOpen(true);}}><Pencil aria-hidden="true" className="size-3.5"/>{label}</Button>
 <Dialog open={open} onOpenChange={next=>next?setOpen(true):close()}><DialogContent className={'flex max-h-[90dvh] flex-col gap-4 overflow-hidden '+(advanced?'sm:max-w-6xl':'sm:max-w-2xl')}><DialogHeader><DialogTitle>{voice.name}</DialogTitle><DialogDescription>编辑开场文字和使用范围，声音参数在更多设置中调整。</DialogDescription></DialogHeader>{open&&<VoiceControls voice={voice} close={close} guard={guard} advanced={advanced} setAdvanced={setAdvanced} canManageAccess={canManageAccess}/>}</DialogContent></Dialog>
 <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>有修改尚未保存</AlertDialogTitle><AlertDialogDescription>关闭将放弃开场文字或声音调试的未保存修改。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><AlertDialogAction onClick={()=>{guard.current={opening:false,tuning:false,training:false};setOpen(false);}}>放弃修改并关闭</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
function VoiceControls({voice,close,guard,advanced,setAdvanced,canManageAccess}:{voice:Voice;close:()=>void;guard:MutableRefObject<{opening:boolean;tuning:boolean;training:boolean}>;advanced:boolean;setAdvanced:(value:boolean)=>void;canManageAccess:boolean}){
 const {org,user}=useAliyunIdentity(),qc=useQueryClient();
 const [audio,setAudio]=useState(''),url=useRef(''),[tab,setTab]=useState('tuning');
 const openingDirty=useCallback((changed:boolean)=>{guard.current.opening=changed;},[guard]);
 const tuningDirty=useCallback((changed:boolean)=>{guard.current.tuning=changed;},[guard]);
 const trainingDirty=useCallback((changed:boolean)=>{guard.current.training=changed;},[guard]);
 const q=useQuery({queryKey:['voice-control',org,user,voice.id],queryFn:()=>telephonyApi.voiceOpening(org,voice.id).catch(e=>{if(e instanceof ApiError&&e.status===404)return null;throw e;}),retry:false,refetchOnWindowFocus:false,refetchInterval:query=>['ANALYZING','TRANSCRIBING','ENROLLING'].includes(query.state.data?.status||'')?3000:false});
 const tuningQuery=useQuery({queryKey:['voice-control-tuning',org,user,voice.id],queryFn:()=>unwrap<{settings:Delivery;volume:number;updatedAt:string|null;source:string}>(apiClient.get('/telephony/voices/'+voice.id+'/tuning',{headers:{'x-workspace-id':org}})),enabled:advanced,retry:false,refetchOnWindowFocus:false});
 const historyQuery=useQuery({queryKey:['voice-control-history',org,user,voice.id],queryFn:()=>telephonyApi.voiceAuditions(org,voice.id),enabled:advanced,retry:false,refetchOnWindowFocus:false,refetchInterval:query=>query.state.data?.some(row=>row.status==='GENERATING')?3000:false});
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 function refresh(){void q.refetch();if(advanced){void tuningQuery.refetch();void historyQuery.refetch();}refreshVoiceLibrary(qc);void qc.invalidateQueries({queryKey:['voice-delivery']});}
 const play=useMutation({mutationFn:()=>telephonyApi.openingAudio(org,voice.id),onSuccess:blob=>{if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio(url.current);},onError:(e:Error)=>toast.error(e.message)});
 if(q.isPending)return <p role="status" className="py-8 text-sm text-muted-foreground">正在读取声音…</p>;
 if(q.isError&&q.data===undefined)return <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{q.error.message}</p><Button size="sm" onClick={()=>void q.refetch()}>重新加载</Button></div>;
 const opening=q.data,tuning=tuningQuery.data,history=historyQuery.data??[];
 return <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
  {q.isError&&<p role="alert" className="text-sm text-destructive">刷新文字失败，当前输入已保留。<Button type="button" size="sm" variant="ghost" onClick={()=>void q.refetch()}>重新读取</Button></p>}
  {opening?<section className="space-y-4" aria-label="开场白">
   <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{opening.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{opening.durationSeconds.toFixed(1)} 秒</p></div><Button type="button" size="sm" variant="outline" disabled={play.isPending} onClick={()=>play.mutate()}><Headphones aria-hidden="true" className="size-3.5"/>{play.isPending?'加载中…':'试听录音'}</Button></div>
   {audio&&<audio controls autoPlay src={audio} className="h-9 w-full" aria-label={voice.name+'开场原录音'}/>}
   <OpeningText key={voice.id} voiceId={voice.id} opening={opening} onSaved={refresh} onDirtyChange={openingDirty}/>
   {opening.error&&<p role="alert" className="text-sm text-destructive">{opening.error}</p>}
  </section>:<p className="rounded-md border p-4 text-sm text-muted-foreground">这条声音尚无开场原录音，可从声音库上传建立。</p>}
  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4"><div className="space-y-1"><p className="text-sm font-medium">可使用员工</p><p className="text-xs text-muted-foreground">{!voice.employeeVisible?'未开放选择':voice.assignedUserIds.length?'指定 '+voice.assignedUserIds.length+' 名员工可选':'全体员工可选'}</p></div>{canManageAccess&&<VoiceAccessDialog voice={voice} label="设置使用员工"/>}</div>
  <section className="border-t pt-4"><Button type="button" size="sm" variant="ghost" aria-expanded={advanced} aria-controls={'voice-advanced-'+voice.id} className="w-full justify-between px-0" onClick={()=>{if(advanced&&guard.current.training){toast.error('请先结束并保存或放弃这轮录音。');return;}setAudio('');setAdvanced(!advanced);}}>更多设置<ChevronDown aria-hidden="true" className={'size-4 transition-transform '+(advanced?'rotate-180':'')}/></Button>
   <div id={'voice-advanced-'+voice.id} hidden={!advanced} className="space-y-4 pt-3">
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>模型：{voice.targetModel}</span>{opening&&<><span>测得音量 {opening.analysis.rmsDb} dBFS</span><span>典型停顿 {opening.analysis.medianPauseMs} ms</span></>}</div>
    {historyQuery.isError&&<p role="alert" className="text-sm text-destructive">试听历史读取失败，开场文字仍可编辑。<Button type="button" size="sm" variant="ghost" onClick={()=>void historyQuery.refetch()}>重新读取</Button></p>}
    {tuningQuery.isError&&tuning&&<p role="alert" className="text-sm text-destructive">刷新声音参数失败，当前草稿已保留。</p>}
    {tuningQuery.isError&&!tuning?<div role="alert" className="space-y-2 text-sm text-destructive"><p>{tuningQuery.error.message}</p><Button type="button" size="sm" variant="outline" onClick={()=>void tuningQuery.refetch()}>重新读取声音参数</Button></div>:!tuning?<p role="status" className="text-sm text-muted-foreground">正在读取声音参数…</p>:<Tabs value={tab} onValueChange={next=>{if(guard.current.training){toast.error('请先结束并保存或放弃这轮录音。');return;}if(next==='training'&&guard.current.tuning){toast.error('请先保存或撤销声音参数，再进入训练室。');return;}setTab(next);}}>
     <TabsList><TabsTrigger value="tuning">声音调试与试听</TabsTrigger><TabsTrigger value="training">声音训练室</TabsTrigger></TabsList>
     <TabsContent value="tuning" forceMount hidden={tab!=='tuning'}><DeliveryForm key={voice.id} initial={tuning.settings} voice={{id:voice.id,name:voice.name,volume:tuning.volume,updatedAt:tuning.updatedAt}} close={close} onSaved={refresh} onDirtyChange={tuningDirty} preview={draft=><VoiceAuditionPanel voice={voice} settings={draft.settings} volume={draft.volume} openingReady={opening?.status==='READY'} history={history} refresh={refresh} active={advanced&&tab==='tuning'}/>}/></TabsContent>
     <TabsContent value="training">{tab==='training'&&<VoiceTrainingRoom voice={voice} tuning={tuning} refresh={refresh} onDirtyChange={trainingDirty}/>}</TabsContent>
    </Tabs>}
   </div>
  </section>
 </div>;
}
function VoiceAuditionPanel({voice,settings,volume,openingReady,history,refresh,active}:{voice:Voice;settings:Delivery;volume:number;openingReady:boolean;history:Awaited<ReturnType<typeof telephonyApi.voiceAuditions>>;refresh:()=>void;active:boolean}){
 const {org}=useAliyunIdentity();
 const [text,setText]=useState('可以，我加您微信，把直播间发过去，您点进去看就行。');
 const [audio,setAudio]=useState(''),[audioLabel,setAudioLabel]=useState(''),[sampleKey,setSampleKey]=useState<string|null>(null),url=useRef('');
 const expression=JSON.stringify([settings.deliveryStyle,settings.speakingPace,settings.pauseStyle,settings.emotionLevel,settings.conversationalStyle,settings.replyLength,settings.followCustomerEmotion,settings.customDirection,settings.advancedStyle]);
 const draftKey=JSON.stringify([text.trim(),expression]);
 const [sampleId,setSampleId]=useState(''),[retryId,setRetryId]=useState(''),[rendering,setRendering]=useState(false);
 const playbackKey=JSON.stringify([volume,settings.backgroundScene,settings.backgroundVolume]);
 useEffect(()=>{if(!sampleId||!active)return;let live=true;setRendering(true);const timer=setTimeout(()=>{void apiClient.post<Blob>('/telephony/voices/'+voice.id+'/render-audition',{auditionId:sampleId,volume,scene:settings.backgroundScene,backgroundVolume:settings.backgroundVolume},{headers:{'x-workspace-id':org},responseType:'blob'}).then(r=>{if(live)playBlob(r.data,'电话效果试听 · 含音量和背景',sampleKey);}).catch((e:Error)=>{if(live)toast.error(e.message);}).finally(()=>{if(live)setRendering(false);});},250);return()=>{live=false;clearTimeout(timer);};},[sampleId,playbackKey,active,org,voice.id]);
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 function playBlob(blob:Blob,label:string,key:string|null){if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio(url.current);setAudioLabel(label);setSampleKey(key);}
 const play=useMutation({mutationFn:({kind,id}:{kind:'opening'|'saved'|'history';id?:string})=>kind==='opening'?telephonyApi.openingAudio(org,voice.id):kind==='saved'?telephonyApi.cachedVoicePreview(org,voice.id):telephonyApi.voiceAuditionAudio(org,voice.id,id!),onSuccess:(blob,args)=>{if(args.kind==='history'){setAudio('');setSampleKey(null);setSampleId(args.id!);}else{setSampleId('');playBlob(blob,args.kind==='opening'?'原声开场白':'当前已保存参数的 AI 试听',null);}},onError:(e:Error)=>toast.error(e.message)});
 const generate=useMutation({mutationFn:(request:{text:string;settings:Delivery;key:string;retryOf?:string})=>telephonyApi.generateVoiceAudition(org,voice.id,request.text,crypto.randomUUID(),request.settings,request.retryOf),onSuccess:(r,request)=>{
  refresh();setRetryId(r.status==='NEEDS_REVIEW'?r.id:'');if(r.status==='READY'&&r.audio){setAudio('');setSampleKey(request.key);setSampleId('');queueMicrotask(()=>setSampleId(r.id));toast.success(r.cached?'已读取缓存，未重新调用模型':'试听已生成，设置尚未自动保存');}else toast.error(r.error||'试听正在处理，请稍后查看记录');
 },onError:(e:Error)=>{refresh();toast.error(e.message);}});
 return <>
  <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">听听调整效果</h3><Button type="button" size="sm" variant="ghost" disabled={!openingReady||play.isPending||generate.isPending} onClick={()=>play.mutate({kind:'opening'})}><Headphones className="size-3.5"/>听原声</Button></div>
  <div className="flex flex-wrap gap-1.5">{[
   {name:'加微信',text:'可以，我加您微信，把直播间发过去，您点进去看就行。'},
   {name:'回答疑问',text:'您想了解课程讲什么，对吧？您具体想了解哪一块？'},
   {name:'结束通话',text:'好，那就先不打扰您了。谢谢，再见。'},
  ].map(sample=><Button type="button" size="sm" variant="outline" key={sample.name} onClick={()=>setText(sample.text)}>{sample.name}</Button>)}</div>
  <label className="grid gap-2 text-sm">试听文案<Textarea aria-label="试听文案" rows={5} maxLength={300} value={text} onChange={e=>setText(e.target.value)} placeholder="输入一句话，听听当前参数的效果"/></label>
  <Button type="button" className="w-full" disabled={!openingReady||!text.trim()||generate.isPending||play.isPending} onClick={()=>generate.mutate({text:text.trim(),settings:structuredClone(settings),key:draftKey})}>{generate.isPending?<Loader2 className="size-4 animate-spin"/>:<Play className="size-4"/>}{generate.isPending?'正在生成试听…':'按当前参数试听'}</Button>
  <p className="text-xs leading-5 text-muted-foreground">无需先保存。首次生成消耗模型额度，相同文案与表达参数直接播放缓存；音量、背景调整会自动刷新电话效果，不调用模型。</p>
  {retryId&&<Button type="button" variant="outline" disabled={generate.isPending} onClick={()=>{if(window.confirm('上次请求结果未确认。请先核对模型账单，再确认重新生成，可能再次消耗额度。'))generate.mutate({text:text.trim(),settings:structuredClone(settings),key:draftKey,retryOf:retryId});}}>核对后重新生成</Button>}{rendering&&<p role="status" className="text-xs text-muted-foreground">正在应用音量和背景…</p>}{audio&&<div className="space-y-2 border-t pt-3"><p role="status" className="text-xs text-muted-foreground">{sampleKey&&sampleKey!==draftKey?'参数或文案已调整，请重新生成试听。':audioLabel}</p>{active&&<audio controls autoPlay src={audio} className="h-9 w-full"/>}</div>}
  <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">历史试听（{history.length}）</summary>
   <div className="mt-2 max-h-48 overflow-y-auto">{openingReady&&<Button type="button" size="sm" variant="ghost" disabled={play.isPending||generate.isPending} onClick={()=>play.mutate({kind:'saved'})}>试听当前已保存参数</Button>}
   {history.length?history.map(row=><div key={row.id} className="flex items-center gap-2 border-b py-2 last:border-0"><p className="min-w-0 flex-1 text-xs leading-5">{row.text}</p>{row.status==='READY'?<Button type="button" size="icon-sm" variant="ghost" aria-label={'播放历史试听：'+row.text} disabled={play.isPending||generate.isPending} onClick={()=>play.mutate({kind:'history',id:row.id})}><Play className="size-3.5"/></Button>:<Button type="button" size="sm" variant="ghost" disabled={row.status==='GENERATING'} onClick={()=>{setText(row.text);setRetryId(row.id);toast.info('请保持失败时的表达参数，核对后可重新生成。');}}>{row.status==='GENERATING'?'生成中':'核对重试'}</Button>}</div>):<p className="py-3 text-xs text-muted-foreground">生成的试听会自动保存在这里。</p>}
   </div><Button type="button" variant="ghost" size="sm" onClick={refresh}><RefreshCw className="size-3.5"/>刷新记录</Button>
  </details>
  <p className="text-xs leading-5 text-muted-foreground">试听包含表达、音量、背景及电话编码效果。接话和打断涉及实时收音，请通过“测试模型”验证。</p>
 </>;
}
function OpeningText({voiceId,opening,onSaved,onDirtyChange}:{voiceId:string;opening:VoiceOpeningDetail;onSaved:()=>void;onDirtyChange:(dirty:boolean)=>void}){
 const {org}=useAliyunIdentity(),[base,setBase]=useState(opening),[text,setText]=useState(opening.text);
 const changed=text!==base.text;
 const remoteChanged=(opening.revision??opening.updatedAt)!==(base.revision??base.updatedAt)&&Date.parse(opening.updatedAt)>=Date.parse(base.updatedAt);
 useEffect(()=>{onDirtyChange(changed);const warn=(event:BeforeUnloadEvent)=>event.preventDefault();if(changed)window.addEventListener('beforeunload',warn);return()=>{onDirtyChange(false);window.removeEventListener('beforeunload',warn);};},[changed,onDirtyChange]);
 const save=useMutation({mutationFn:()=>telephonyApi.saveVoiceOpening(org,voiceId,text,base.updatedAt,base.revision),onSuccess:result=>{setBase(result);setText(result.text);toast.success('识别文字已保存，原录音和声音设置保持原样');onSaved();},onError:(e:Error)=>toast.error(e.message)});
 return <div className="space-y-2"><label className="grid gap-2 text-sm">开场识别文字<Textarea rows={4} maxLength={4000} value={text} disabled={save.isPending} onChange={e=>setText(e.target.value)}/></label>
  {remoteChanged&&<div role="status" className="space-y-2 rounded-md border p-3 text-sm"><p>线上文字已有更新，当前草稿已保留。</p><details><summary className="cursor-pointer">查看最新文字</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{opening.text}</p></details><Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={()=>{if(!changed||window.confirm('采用最新文字会放弃本次未保存的修改，是否继续？')){setBase(opening);setText(opening.text);save.reset();}}}>采用最新文字</Button></div>}
  {save.isError&&<p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
  <div className="flex justify-end"><Button type="button" size="sm" variant="outline" disabled={!text.trim()||save.isPending||!changed} onClick={()=>save.mutate()}><Save aria-hidden="true" className="size-3.5"/>{save.isPending?'保存中…':'保存识别文字'}</Button></div></div>;
}
