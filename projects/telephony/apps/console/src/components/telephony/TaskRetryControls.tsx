/*
 * 中文导读：线路与语音外呼的 TaskRetryControls 组件，封装该界面的展示与交互。
 */
"use client";
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useAliyunIdentity} from '@/src/hooks/queries/aliyun';
import {telephonyApi,type SipTask,type TaskRetryPolicy} from '@/src/lib/api/resources/telephony';
import {toast} from '@/src/lib/toast';
import {Button} from '../ui/button';
import {TaskRetryFields,validRetryPolicy} from './TaskRetryFields';
const fallback:TaskRetryPolicy={retries:0,retryIntervalMinutes:30};
export function TaskRetryControls({task,canManage}:{task:SipTask;canManage:boolean}){
 const {org}=useAliyunIdentity(),qc=useQueryClient();
 const current=task.retryPolicy??fallback;
 const [editing,setEditing]=useState(false),[value,setValue]=useState(current),[expected,setExpected]=useState(current),[includePrevious,setIncludePrevious]=useState(false);
 const canEdit=canManage&&!task.localPreview&&!task.localRemoved&&task.kind!=='MANUAL'&&(task.provider||'HAOKEHU_SIP')==='HAOKEHU_SIP'&&['DRAFT','RUNNING','PAUSED','NEEDS_REVIEW','COMPLETED'].includes(task.status)&&(!task.endTime||Date.parse(task.endTime)>Date.now());
 const save=useMutation({mutationFn:()=>telephonyApi.retry(org,task.id,{policy:value,expectedPolicy:expected,includePrevious:includePrevious&&value.retries>0}),onSuccess:result=>{setEditing(false);void qc.invalidateQueries({queryKey:['telephony']});toast.success(`重拨设置已保存${result.scheduled?'，安排 '+result.scheduled+' 个号码重拨':''}${result.requiresContinue?'；请点击继续任务':''}`);},onError:(error:Error)=>toast.error(error.message),retry:false});
 if(task.retrySupported===false||task.kind==='MANUAL'||(task.provider||'HAOKEHU_SIP')!=='HAOKEHU_SIP')return null;
 return <section aria-label="任务自动重拨" className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-medium">未接通自动重拨</h3><p className="mt-1 text-xs text-muted-foreground">{current.retries?`最多重拨 ${current.retries} 次，每次至少间隔 ${current.retryIntervalMinutes} 分钟`:'已关闭'}</p></div>{canEdit&&!editing&&<Button type="button" size="sm" variant="outline" onClick={()=>{setValue(current);setExpected(current);setIncludePrevious(false);setEditing(true);}}>设置重拨</Button>}</div>
 {editing&&<div className="space-y-3 border-t pt-3"><TaskRetryFields value={value} onChange={setValue} disabled={save.isPending}/>{value.retries>0&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={includePrevious} disabled={save.isPending} onChange={event=>setIncludePrevious(event.target.checked)}/>同时安排本任务之前未接通的号码</label>}<p className="text-xs leading-5 text-muted-foreground">保存后用于后续失败通话；已排队重拨的等待时间保持原安排。勾选历史号码后，从保存时间开始等待。关闭或减少次数会取消超出次数且尚未发起的重拨。重拨产生线路和模型费用；暂停任务需手动继续。</p><div className="flex gap-2"><Button type="button" size="sm" disabled={save.isPending||!validRetryPolicy(value)} onClick={()=>save.mutate()}>{save.isPending?'保存中…':includePrevious&&value.retries?'保存并安排重拨':'保存设置'}</Button><Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={()=>setEditing(false)}>取消</Button></div></div>}</section>;
}
