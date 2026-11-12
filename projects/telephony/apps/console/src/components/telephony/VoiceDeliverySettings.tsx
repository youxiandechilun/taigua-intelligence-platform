/*
 * 中文导读：线路与语音外呼的 VoiceDeliverySettings 组件，封装该界面的展示与交互。
 */
"use client";

import {useEffect,useState,type ReactNode} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {SlidersHorizontal,RotateCcw,MessageCircle,AudioLines,Timer,Volume2,Mic} from 'lucide-react';
import {useCompanyContext} from '@/src/lib/api/resources/company';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {apiClient,unwrap} from '@/src/lib/api/client';
import {Button} from '../ui/button';
import {Textarea} from '../ui/textarea';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '../ui/tabs';
import {Input} from '../ui/input';
import {NativeSelect} from '../ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '../ui/dialog';
import {toast} from '@/src/lib/toast';

import type {AdvancedStyle,VoiceTuningSettings as Delivery} from '@/src/lib/api/resources/telephony';
export type {AdvancedStyle,VoiceTuningSettings as Delivery} from '@/src/lib/api/resources/telephony';
const advancedDefaults:AdvancedStyle={intonation:'inherit',emphasis:'inherit',sentenceEnding:'inherit',onset:'inherit',articulation:'inherit',paceVariation:'inherit',fillerWords:'inherit',acknowledgement:'inherit',questionStyle:'inherit',numberReading:'inherit',empathy:'inherit'};
const defaultDelivery:Delivery={enhanceQuietSpeech:true,noiseReduction:'mild',responseSpeed:'balanced',responseWaitMs:0,sensitivity:'sensitive',noInputSeconds:10,deliveryStyle:'warm',speakingPace:'natural',pauseStyle:'natural',emotionLevel:'balanced',conversationalStyle:'everyday',replyLength:'short',followCustomerEmotion:true,customDirection:'',backgroundScene:'off',backgroundVolume:6,advancedStyle:advancedDefaults};
function normalize(value:Delivery){return {...defaultDelivery,...value,advancedStyle:{...advancedDefaults,...value.advancedStyle}};}
const presets:{name:string;settings:Partial<Delivery>}[]=[
 {name:'自然交流',settings:{}},
 {name:'耐心解释',settings:{deliveryStyle:'warm',speakingPace:'slow',pauseStyle:'clear',replyLength:'balanced'}},
 {name:'轻快邀约',settings:{deliveryStyle:'bright',speakingPace:'brisk',emotionLevel:'expressive'}},
 {name:'沉稳商务',settings:{deliveryStyle:'calm',conversationalStyle:'polished',emotionLevel:'subtle',pauseStyle:'clear'}},
];
const groups=[{id:'emotion',name:'语气情绪',icon:AudioLines},{id:'rhythm',name:'语速停顿',icon:Mic},{id:'wording',name:'口语习惯',icon:MessageCircle},{id:'listening',name:'接话速度',icon:Timer},{id:'scene',name:'音量背景',icon:Volume2}];
const waits=[{label:'敏捷',ms:400},{label:'快速',ms:800},{label:'自然',ms:1100},{label:'耐心',ms:1600}];
type Option=readonly [string,string];
function Choice({label,value,options,onChange}:{label:string;value:string;options:readonly Option[];onChange:(value:string)=>void}){
 return <label className="grid content-start gap-1.5 text-sm">{label}<NativeSelect aria-label={label} className="h-9" value={value} onChange={e=>onChange(e.target.value)}>{options.map(([id,name])=><option key={id} value={id}>{name}</option>)}</NativeSelect></label>;
}
export function VoiceDeliverySettings({label='统一声音效果',navigation=false,open:controlledOpen,onOpenChange,hideTrigger=false}:{label?:string;navigation?:boolean;open?:boolean;onOpenChange?:(open:boolean)=>void;hideTrigger?:boolean}){
 const {data:access}=useCompanyContext();const [localOpen,setLocalOpen]=useState(false),open=controlledOpen??localOpen;const setOpen=onOpenChange??setLocalOpen;
 if(!access?.isSystemAdmin)return null;
 return <>{!hideTrigger&&<Button type="button" variant={navigation?'ghost':'outline'} className={navigation?'h-10 rounded-none px-4 text-sm text-muted-foreground':''} size="sm" onClick={()=>setOpen(true)}><SlidersHorizontal className="size-4"/>{label}</Button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>默认声音设置</DialogTitle><DialogDescription>新人物使用这些默认设置，已单独调试的人物保留自己的设置。</DialogDescription></DialogHeader>{open&&<DeliveryLoader close={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}
function DeliveryLoader({close}:{close:()=>void}){
 const {org,user}=useAliyunIdentity();
 const query=useQuery({queryKey:['voice-delivery',org,user],queryFn:()=>unwrap<{settings:Delivery;canConfigure:boolean;revision:string}>(apiClient.get('/telephony/voice-policy',{headers:{'x-workspace-id':org}})),retry:false});
 if(query.isPending)return <p className="text-sm">正在读取设置…</p>;
 return <>{query.error&&<div role="alert" className="text-sm text-destructive">{query.data?'刷新失败，当前草稿已保留：':''}{query.error.message}<Button type="button" variant="outline" onClick={()=>void query.refetch()}>重试</Button></div>}{query.data&&<DeliveryForm key={org+user} initial={query.data.settings} revision={query.data.revision} close={close}/>}</>;
}
export function DeliveryForm({initial,revision,close,voice,onSaved,onDirtyChange,preview}:{initial:Delivery;revision?:string;close:()=>void;voice?:{id:string;name:string;volume:number;updatedAt:string|null};onSaved?:()=>void;onDirtyChange?:(dirty:boolean)=>void;preview?:(draft:{settings:Delivery;volume:number})=>ReactNode}){
 const [base,setBase]=useState(()=>({settings:normalize(initial),volume:voice?.volume??100,updatedAt:voice?.updatedAt??null,revision}));
 const [value,setValue]=useState(()=>normalize(initial));const [volume,setVolume]=useState(voice?.volume??100);
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const patch=(next:Partial<Delivery>)=>setValue(old=>({...old,...next,advancedStyle:next.advancedStyle||old.advancedStyle}));
 const fine=(key:keyof AdvancedStyle,choice:string)=>setValue(old=>({...old,advancedStyle:{...old.advancedStyle,[key]:choice}}));
 const changed=JSON.stringify(value)!==JSON.stringify(base.settings)||volume!==base.volume;
 const waitMs=value.responseWaitMs||({fast:500,balanced:750,patient:1600}[value.responseSpeed]);
 useEffect(()=>{onDirtyChange?.(changed);const warn=(event:BeforeUnloadEvent)=>event.preventDefault();if(changed)window.addEventListener('beforeunload',warn);return()=>{onDirtyChange?.(false);window.removeEventListener('beforeunload',warn);};},[changed,onDirtyChange]);
 const remoteChanged=voice?voice.updatedAt!==base.updatedAt&&Date.parse(voice.updatedAt||'')>=Date.parse(base.updatedAt||'1970-01-01'):revision!==base.revision;
 const save=useMutation({mutationFn:()=>unwrap<{settings:Delivery;volume?:number;updatedAt?:string|null;revision?:string}>(apiClient.put(voice?'/telephony/voices/'+voice.id+'/tuning':'/telephony/voice-policy',voice?{settings:value,volume,expectedUpdatedAt:base.updatedAt}:{...value,expectedRevision:base.revision},{headers:{'x-workspace-id':org}})),onSuccess:result=>{
  const settings=normalize(result.settings),savedVolume=result.volume??volume;
  setValue(settings);setVolume(savedVolume);setBase({settings,volume:savedVolume,updatedAt:result.updatedAt??null,revision:result.revision});
  void qc.invalidateQueries({queryKey:['voice-delivery']});void qc.invalidateQueries({queryKey:['my-playbook']});toast.success(voice?voice.name+'的声音调试已保存':'默认声音设置已保存');if(onSaved)onSaved();else close();
 }});
 function reset(){setValue(base.settings);setVolume(base.volume);}
 function loadLatest(){if(changed&&!window.confirm('读取最新设置会放弃本次未保存的参数，是否继续？'))return;const settings=normalize(initial),latestVolume=voice?.volume??100;setBase({settings,volume:latestVolume,updatedAt:voice?.updatedAt??null,revision});setValue(settings);setVolume(latestVolume);save.reset();}

 function preset(settings:Partial<Delivery>){setValue(old=>({...old,deliveryStyle:'warm',speakingPace:'natural',pauseStyle:'natural',emotionLevel:'balanced',conversationalStyle:'everyday',replyLength:'short',advancedStyle:{...advancedDefaults},...settings}));}
 const advanced=(key:keyof AdvancedStyle,label:string,options:Option[])=> <Choice label={label} value={value.advancedStyle[key]} options={[["inherit","沿用原声风格"],...options]} onChange={v=>fine(key,v)}/>;
 return <form onSubmit={e=>{e.preventDefault();e.stopPropagation();save.mutate();}} className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{voice?voice.name+' · 保存后，后续起呼使用最新设置；已接通通话保持原设置':'新人物默认设置'}</span><span role="status">{changed?'有未保存修改':'已保存'}</span></div>
  {remoteChanged&&<div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>其他页面已更新声音参数，当前草稿已保留。</span><Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={loadLatest}>读取最新设置</Button></div>}
  <div className={preview?"grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]":""}>
  <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
   <div className="flex flex-wrap items-center gap-2" aria-label="声音风格预设"><span className="mr-1 text-xs text-muted-foreground">快捷风格</span>{presets.map(p=><Button key={p.name} type="button" size="sm" variant="outline" onClick={()=>preset(p.settings)}>{p.name}</Button>)}</div>
   <Tabs defaultValue="emotion" orientation="vertical" className="gap-4 sm:flex-row">
    <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/40 p-1 sm:w-36 sm:shrink-0 sm:grid-cols-1 sm:self-start">{groups.map(g=><TabsTrigger key={g.id} value={g.id} className="justify-start gap-2 px-2 py-2.5 text-xs sm:text-sm"><g.icon aria-hidden="true" className="size-3.5 shrink-0"/>{g.name}</TabsTrigger>)}</TabsList>
    <div className="min-w-0 flex-1">
     <TabsContent value="emotion" className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <Choice label="表达语气" value={value.deliveryStyle} options={[["warm","温和亲切"],["calm","沉稳可信"],["bright","轻快积极"]]} onChange={v=>patch({deliveryStyle:v as Delivery['deliveryStyle']})}/>
      <Choice label="情绪强弱" value={value.emotionLevel} options={[["subtle","轻微克制"],["balanced","自然适中"],["expressive","更有表现力"]]} onChange={v=>patch({emotionLevel:v as Delivery['emotionLevel']})}/>
      {advanced('intonation','语调起伏',[["restrained","克制起伏"],["varied","随语义变化"]])}
      {advanced('emphasis','重音方式',[["soft","柔和表达"],["keypoints","突出关键信息"]])}
      {advanced('sentenceEnding','句尾语气',[["settled","自然收住"],["gentle","轻柔收尾"]])}
      {advanced('empathy','回应顾虑',[["restrained","平实回应"],["supportive","先体谅再解释"]])}
      <label className="flex items-center gap-2 py-1 text-sm sm:col-span-2"><input type="checkbox" checked={value.followCustomerEmotion} onChange={e=>patch({followCustomerEmotion:e.target.checked})}/>跟随客户情绪调整表达</label>
     </TabsContent>
     <TabsContent value="rhythm" className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <Choice label="说话语速" value={value.speakingPace} options={[["slow","比本人原声稍慢"],["natural","跟随本人原声"],["brisk","比本人原声稍快"]]} onChange={v=>patch({speakingPace:v as Delivery['speakingPace']})}/>
      <Choice label="停顿习惯" value={value.pauseStyle} options={[["connected","连贯表达"],["natural","自然停顿"],["clear","重点停顿"]]} onChange={v=>patch({pauseStyle:v as Delivery['pauseStyle']})}/>
      {advanced('paceVariation','句内节奏',[["steady","平稳连贯"],["adaptive","重点慢、连接词轻带"]])}
      {advanced('onset','开口方式',[["soft","柔和起音"],["direct","直接进入回答"]])}
      {advanced('articulation','咬字习惯',[["relaxed","放松连读"],["clear","清晰易懂"]])}
      {advanced('numberReading','数字与专有名词',[["careful","稍慢说清"],["grouped","长号码分组读"]])}
     </TabsContent>
     <TabsContent value="wording" className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <Choice label="口语化程度" value={value.conversationalStyle} options={[["concise","直接简洁"],["everyday","日常口语"],["polished","专业易懂"]]} onChange={v=>patch({conversationalStyle:v as Delivery['conversationalStyle']})}/>
      <Choice label="回答长短" value={value.replyLength} options={[["short","简短优先"],["balanced","适度说明"],["detailed","按需详细解释"]]} onChange={v=>patch({replyLength:v as Delivery['replyLength']})}/>
      {advanced('fillerWords','口语衔接词',[["none","不额外添加"],["occasional","少量自然使用"]])}
      {advanced('acknowledgement','回应客户的方式',[["minimal","简短确认"],["contextual","接住当前意思"]])}
      {advanced('questionStyle','提问习惯',[["one","一次一个问题"],["confirm","有歧义才确认"]])}
      <label className="grid gap-1.5 text-sm sm:col-span-2">补充调教要求<Textarea rows={3} maxLength={600} placeholder="写下这个人特有的表达习惯，例如：解释时轻松一点，少用宣传词。" value={value.customDirection} onChange={e=>patch({customDirection:e.target.value})}/></label>
     </TabsContent>
     <TabsContent value="listening" className="space-y-4">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
       <div className="mb-2 flex items-center justify-between"><label htmlFor="voice-response-wait" className="text-sm font-medium">客户停顿后等待</label><output htmlFor="voice-response-wait" className="text-sm font-semibold tabular-nums text-primary">{waitMs} ms</output></div>
       <div className="mb-3 grid grid-cols-4 gap-1.5">{waits.map(w=><Button key={w.ms} size="sm" variant={waitMs===w.ms?'default':'outline'} type="button" aria-pressed={waitMs===w.ms} className="h-auto flex-col gap-0.5 px-1 py-1.5" onClick={()=>patch({responseWaitMs:w.ms})}><span>{w.label}</span><span className="text-[11px] opacity-75">{w.ms} ms</span></Button>)}</div>
       <input id="voice-response-wait" aria-label="客户停顿后等待毫秒" type="range" min={200} max={2000} step={100} value={waitMs} onChange={e=>patch({responseWaitMs:Number(e.target.value)})} className="w-full accent-primary"/>
       <div className="flex justify-between text-xs text-muted-foreground"><span>更快接话 · 200 ms</span><span>更耐心 · 2000 ms</span></div>
       <p className="mt-2 text-xs leading-5 text-muted-foreground">只控制判断客户说完的等待时间，模型生成还需要时间。调得太短容易抢话；噪声较多时建议从 800 ms 开始。</p>
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
       <Choice label="背景降噪" value={value.noiseReduction} options={[["mild","轻度降噪"],["off","关闭"]]} onChange={v=>patch({noiseReduction:v as Delivery['noiseReduction']})}/>
       <Choice label="收音灵敏度" value={value.sensitivity} options={[["normal","标准"],["sensitive","灵敏"]]} onChange={v=>patch({sensitivity:v as Delivery['sensitivity']})}/>
       <label className="grid gap-1.5 text-sm">无回应等待（秒）<Input aria-label="无回应等待秒数" className="h-9" type="number" required min={1} max={30} step={1} value={value.noInputSeconds} onChange={e=>patch({noInputSeconds:Number(e.target.value)})}/></label>
       <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enhanceQuietSpeech} onChange={e=>patch({enhanceQuietSpeech:e.target.checked})}/>增强轻声识别</label>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">客户插话时暂停当前语音，听清后接话。接话速度与打断效果请通过测试电话确认。</p>
     </TabsContent>
     <TabsContent value="scene" className="space-y-4">
      {voice&&<label className="grid gap-2 text-sm">通话音量<span className="flex items-center gap-3"><input type="range" aria-label="此人物通话音量" min={50} max={150} step={5} value={volume} onChange={e=>setVolume(Number(e.target.value))} className="min-w-0 flex-1 accent-primary"/><output className="w-12 text-right text-xs tabular-nums">{volume}%</output></span></label>}
      <Choice label="背景场景" value={value.backgroundScene} options={[["off","关闭"],["opening","跟随开场底噪（轻微环境声）"],["office","办公室（环境声、偶尔键盘声）"]]} onChange={v=>patch({backgroundScene:v as Delivery['backgroundScene']})}/>
      <label className="grid gap-2 text-sm">背景音量<span className="flex items-center gap-3"><input aria-label="背景音量" className="min-w-0 flex-1 accent-primary" type="range" min={1} max={12} step={1} disabled={value.backgroundScene==='off'} value={value.backgroundVolume} onChange={e=>patch({backgroundVolume:Number(e.target.value)})}/><output className="w-10 text-right text-xs tabular-nums">{value.backgroundVolume}%</output></span></label>
      <p className="text-xs leading-5 text-muted-foreground">右侧试听会同步应用音量与背景，修改这些项目不消耗模型额度。原开场保持原声。</p>
     </TabsContent>
    </div>
   </Tabs>
  </fieldset>
  {preview&&<aside className="min-w-0 space-y-4 border-t pt-4 lg:sticky lg:top-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">{preview({settings:value,volume})}</aside>}
  </div>
  {save.error&&<p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
  <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t bg-background py-3">
   <Button type="button" size="sm" variant="ghost" disabled={!changed||save.isPending} onClick={reset}><RotateCcw className="size-3.5"/>撤销本次修改</Button>
   <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={close}>关闭</Button><Button size="sm" disabled={!changed||save.isPending}>{save.isPending?'保存中…':voice?'保存此人设置':'保存默认设置'}</Button></div>
  </div>
 </form>;
}
