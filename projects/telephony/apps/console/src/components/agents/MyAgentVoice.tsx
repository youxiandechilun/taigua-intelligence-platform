/*
 * 中文导读：数字员工与话术的 MyAgentVoice 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {AudioLines} from 'lucide-react';
import {Button} from '../ui/button';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '../ui/sheet';
import {PersonalVoiceSettings} from '../telephony/PersonalVoiceSettings';

export function MyAgentVoice({agentId,name}:{agentId:string;name:string}) {
 const [open,setOpen]=useState(false),[provider,setProvider]=useState<'HAOKEHU_SIP'|'ALIYUN_ENGINE'>('HAOKEHU_SIP'),[dirty,setDirty]=useState(false);
 return <>
  <button type="button" onClick={()=>setOpen(true)} className="flex items-center justify-center gap-1.5 py-4 text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"><AudioLines className="size-3.5"/>我的声音</button>
  <Sheet open={open} onOpenChange={next=>{if(!next&&dirty&&!window.confirm('声音修改尚未保存，是否放弃修改？'))return;setOpen(next);}}>
   <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
    <SheetHeader><SheetTitle>{name}的通话声音</SheetTitle><SheetDescription>仅应用于我的账号</SheetDescription></SheetHeader>
    <div className="space-y-5 p-5">
     <div className="flex gap-2" role="group" aria-label="声音使用线路">
      {([{id:'HAOKEHU_SIP',name:'好客呼线路'},{id:'ALIYUN_ENGINE',name:'阿里云线路'}] as const).map(p=><Button key={p.id} size="sm" variant={provider===p.id?'default':'outline'} aria-pressed={provider===p.id} onClick={()=>{if(dirty&&!window.confirm('声音修改尚未保存，是否放弃修改？'))return;setProvider(p.id);}}>{p.name}</Button>)}
     </div>
     <PersonalVoiceSettings key={agentId+provider} agentId={agentId} provider={provider} onDirtyChange={setDirty}/>
    </div>
   </SheetContent>
  </Sheet>
 </>;
}
