/*
 * 中文导读：线路与语音外呼的 TaskRetryFields 组件，封装该界面的展示与交互。
 */
"use client";
import type {TaskRetryPolicy} from '@/src/lib/api/resources/telephony';
import {NativeSelect} from '../ui/native-select';
import {Input} from '../ui/input';
export function TaskRetryFields({value,onChange,disabled=false}:{value:TaskRetryPolicy;onChange:(value:TaskRetryPolicy)=>void;disabled?:boolean}){
 return <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-medium">未接通自动重拨</legend>
  <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">最多重拨次数<NativeSelect value={value.retries} onChange={event=>onChange({...value,retries:Number(event.target.value)})}><option value={0}>关闭</option>{[1,2,3].map(count=><option key={count} value={count}>最多重拨 {count} 次</option>)}</NativeSelect></label>
  <label className="grid gap-2 text-sm">重拨间隔（分钟）<Input type="number" min={1} max={720} step={1} disabled={disabled||!value.retries} value={Number.isNaN(value.retryIntervalMinutes)?'':value.retryIntervalMinutes} onChange={event=>onChange({...value,retryIntervalMinutes:event.target.valueAsNumber})}/></label></div>
  <p className="text-xs leading-5 text-muted-foreground">仅重拨无人接听、忙线或临时网络故障的号码；已接通、明确拒接、无效号码、语音助手接听和结果未回传的号码不自动重拨。重拨仍受任务有效期、允许时段与线路频次限制。</p>
 </fieldset>;
}
export function validRetryPolicy(value:TaskRetryPolicy){return Number.isInteger(value.retries)&&value.retries>=0&&value.retries<=3&&Number.isInteger(value.retryIntervalMinutes)&&value.retryIntervalMinutes>=1&&value.retryIntervalMinutes<=720;}
