/*
 * 中文导读：线路与语音外呼的 VoiceLibraryRow 组件，封装该界面的展示与交互。
 */
"use client";
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Headphones,MoreHorizontal,Pause,Play,RotateCcw,Trash2,Users} from 'lucide-react';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type Voice} from '@/src/lib/api/resources/telephony';
import {toast} from '@/src/lib/toast';
import {Button} from '../ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '../ui/alert-dialog';
import {VoiceControlCenter} from './VoiceControlCenter';
import {VoiceAccessDialog} from './VoiceAccessDialog';
import {refreshVoiceLibrary} from './voice-library-cache';

function voiceState(voice:Voice,removed:boolean){
 if(removed)return '已删除';
 if(voice.enabled===false)return '已禁用';
 if(['ANALYZING','TRANSCRIBING'].includes(voice.opening?.status||''))return '识别中';
 if(voice.status==='SUBMITTING'||voice.opening?.status==='ENROLLING')return '复刻中';
 if(voice.status==='FAILED')return '复刻失败';
 if(voice.status==='NEEDS_REVIEW'||voice.opening?.status==='NEEDS_REVIEW')return '待核对';
 if(voice.opening?.ready&&voice.status==='READY')return '已就绪';
 return voice.opening?'待处理':'缺少开场白';
}
export function VoiceLibraryRow({voice,canManage,canManageAccess,employeeNames,removed=false,activeVoiceId,onPlay}:{
 voice:Voice;canManage:boolean;canManageAccess:boolean;employeeNames:Map<string,string>;removed?:boolean;activeVoiceId:string;onPlay:(id:string)=>void;
}){
 const {org}=useAliyunIdentity(),client=useQueryClient();
 const [audio,setAudio]=useState(''),[audioLabel,setAudioLabel]=useState(''),[accessOpen,setAccessOpen]=useState(false);
 const [confirm,setConfirm]=useState<'remove'|'enroll'|null>(null),url=useRef('');
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current);},[]);
 const refresh=()=>refreshVoiceLibrary(client),enabled=voice.enabled!==false;
 const play=useMutation({mutationFn:(kind:'opening'|'ai')=>kind==='opening'?(voice.opening?telephonyApi.openingAudio(org,voice.id):telephonyApi.voiceSample(org,voice.id)):telephonyApi.currentVoicePreview(org,voice.id),onSuccess:(blob,kind)=>{
  if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);setAudio(url.current);setAudioLabel(kind==='opening'?(voice.opening?'开场原声':'参考录音'):'当前设置的 AI 试听');onPlay(voice.id);
 },onError:(error:Error)=>toast.error(error.message)});
 const enroll=useMutation({mutationFn:()=>telephonyApi.enrollVoice(org,voice.id),onSuccess:result=>{refresh();if(result.status==='READY')toast.success('声音复刻已完成');else toast.error(result.error||'复刻结果待核对');},onError:(error:Error)=>{refresh();toast.error(error.message);}});
 const remove=useMutation({mutationFn:()=>telephonyApi.removeVoice(org,voice.id),onSuccess:()=>{refresh();toast.success('声音已移至已删除，可恢复');},onError:(error:Error)=>toast.error(error.message)});
 const toggle=useMutation({mutationFn:()=>telephonyApi.setVoiceEnabled(org,voice.id,!enabled),onSuccess:()=>{refresh();toast.success(enabled?'声音已禁用':'声音已启用');},onError:(error:Error)=>toast.error(error.message)});
 const restore=useMutation({mutationFn:()=>telephonyApi.restoreVoice(org,voice.id),onSuccess:()=>{refresh();toast.success('声音已恢复，启用后即可选择');},onError:(error:Error)=>toast.error(error.message)});
 const busy=remove.isPending||enroll.isPending||toggle.isPending||restore.isPending||voice.status==='SUBMITTING'||['ANALYZING','TRANSCRIBING','ENROLLING'].includes(voice.opening?.status||'')||voice.previewStatus==='GENERATING';
 const status=voiceState(voice,removed),ready=status==='已就绪';
 const audience=!voice.employeeVisible?'未开放选择':voice.assignedUserIds.length?voice.assignedUserIds.map(id=>employeeNames.get(id)||'指定员工').join('、'):'全体员工可选';
 return <>
  <tr className="border-t align-top transition-colors hover:bg-muted/20">
   <td className="px-5 py-4"><p className="break-words font-medium">{voice.name}</p><p className="mt-1 text-xs text-muted-foreground">{voice.gender==='male'?'男声':voice.gender==='female'?'女声':'真人声音'}</p></td>
   <td className="px-5 py-4"><p className="line-clamp-2 max-w-md text-sm leading-6 text-muted-foreground" title={voice.opening?.text}>{voice.opening?.text||'暂无开场文字'}</p>{voice.opening&&<span className="mt-1 inline-block text-xs text-muted-foreground">{voice.opening.durationSeconds.toFixed(1)} 秒</span>}{audio&&activeVoiceId===voice.id&&<div className="mt-3 space-y-1"><p className="text-xs text-muted-foreground">{audioLabel}</p><audio controls autoPlay src={audio} className="h-8 w-full max-w-72" aria-label={voice.name+'试听'}/></div>}</td>
   <td className="px-5 py-4"><p className="line-clamp-2 max-w-44 text-sm leading-6" title={audience}>{audience}</p>{voice.assignedUserIds.length>0&&voice.employeeVisible&&<p className="mt-1 text-xs text-muted-foreground">{voice.assignedUserIds.length} 名员工可选</p>}</td>
   <td className="px-5 py-4"><span className={'inline-flex items-center gap-1.5 whitespace-nowrap text-xs '+(ready?'text-primary':'text-muted-foreground')}><span aria-hidden="true" className={'size-1.5 rounded-full '+(ready?'bg-primary':'bg-muted-foreground/50')}/>{status}</span>{(voice.error||voice.opening?.error)&&<p role="status" className="mt-2 max-w-52 text-xs leading-5 text-destructive">{voice.error||voice.opening?.error}</p>}</td>
   <td className="px-4 py-3"><div className="flex items-center justify-end gap-1 whitespace-nowrap">
    {removed?canManage&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>restore.mutate()}><RotateCcw aria-hidden="true" className="size-3.5"/>恢复</Button>:<>
     <Button type="button" size="sm" variant="ghost" disabled={play.isPending} onClick={()=>play.mutate('opening')}><Headphones aria-hidden="true" className="size-3.5"/>{play.isPending?'加载中…':'试听'}</Button>
     {canManage&&<><VoiceControlCenter voice={voice} label="编辑" canManageAccess={canManageAccess}/><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={voice.name+'的更多操作'}><MoreHorizontal aria-hidden="true" className="size-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40">
      {voice.status==='READY'&&<DropdownMenuItem disabled={play.isPending||busy||!enabled} onSelect={()=>play.mutate('ai')}><Headphones/>AI 效果试听</DropdownMenuItem>}
      {canManageAccess&&<DropdownMenuItem onSelect={()=>setAccessOpen(true)}><Users/>设置使用员工</DropdownMenuItem>}
      {voice.status==='DRAFT'&&<DropdownMenuItem disabled={busy||!enabled} onSelect={()=>setConfirm('enroll')}>开始复刻</DropdownMenuItem>}
      <DropdownMenuSeparator/><DropdownMenuItem disabled={busy} onSelect={()=>toggle.mutate()}>{enabled?<Pause/>:<Play/>}{enabled?'禁用声音':'启用声音'}</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" disabled={busy} onSelect={()=>setConfirm('remove')}><Trash2/>删除声音</DropdownMenuItem>
     </DropdownMenuContent></DropdownMenu></>}
    </>}
   </div></td>
  </tr>
  {canManageAccess&&!removed&&<VoiceAccessDialog voice={voice} open={accessOpen} onOpenChange={setAccessOpen} hideTrigger/>}
  <AlertDialog open={confirm!==null} onOpenChange={next=>{if(!next)setConfirm(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm==='remove'?'删除声音':'提交声音复刻'}</AlertDialogTitle><AlertDialogDescription>{confirm==='remove'?'将“'+voice.name+'”移至已删除？历史通话保留，可在已删除声音中恢复。':'将“'+voice.name+'”的授权录音提交阿里云复刻？云服务可能收费，结果未确认时不会自动重试。'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className={confirm==='remove'?'bg-destructive text-white hover:bg-destructive/90':''} onClick={()=>{if(confirm==='remove')remove.mutate();else enroll.mutate();}}>{confirm==='remove'?'确认删除':'确认提交'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </>;
}
