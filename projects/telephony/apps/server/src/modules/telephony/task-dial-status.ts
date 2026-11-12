/*
 * 中文导读：线路与语音外呼：task-dial-status.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {CrmDb,Row} from '../crm/crm.service.js';
import {resolveSipAttemptRoutes} from './redial-line.js';
import {inDialWindow,holidayStatus} from './dial-policy.js';
import {carrierWindowOpen} from './carrier-policy.js';
import type {LineSettings} from './sip.schema.js';

const dayMs=86400000,chinaOffset=8*3600000;
type Policy=LineSettings['dialPolicy'];
function nextWindow(policy:Policy,line:LineSettings,earliest:number,end:number) {
 const localDay=Math.floor((earliest+chinaOffset)/dayMs)*dayMs-chinaOffset;
 const minute=(clock:string)=>Number(clock.slice(0,2))*60+Number(clock.slice(3,5));
 const startMinute=Math.max(policy.timeRestricted===false?0:minute(policy.start),line.carrierPolicy?minute(line.carrierPolicy.start):0);
 const endMinute=Math.min(policy.timeRestricted===false?1440:minute(policy.end),line.carrierPolicy?minute(line.carrierPolicy.end):1440);
 if(startMinute>=endMinute)return {at:null,message:'线路拨打时段与服务商时段没有交集'};
 for(let day=localDay;day<end&&day<localDay+366*dayMs;day+=dayMs){
  const at=Math.max(earliest,day+startMinute*60000),date=new Date(at);
  if(at>=Math.min(end,day+endMinute*60000)||!inDialWindow(policy,date))continue;
  const holiday=holidayStatus(policy,date);
  if(!holiday.calendarReady)return {at:null,message:holiday.message};
  if(holiday.allowed&&carrierWindowOpen(line,date))return {at,message:''};
 }
 return {at:null,message:'任务结束前没有符合线路规则的拨打时段'};
}

// Read-only explanation of time gates. Raw task status remains RUNNING so the
// worker automatically continues under the administrator's current line rules.
export async function taskDialStatus(db:CrmDb,task:Row,attempts:Row[],now=new Date()) {
 const snapshot=task.snapshot;
 if(task.status!=='RUNNING'||snapshot.mode==='MANUAL'||(snapshot.provider||'HAOKEHU_SIP')!=='HAOKEHU_SIP')return null;
 const queued=attempts.filter(a=>a.status==='QUEUED');
 if(!queued.length||attempts.some(a=>['DISPATCHING','DIALING','CONNECTED'].includes(a.status)))return null;
 const blocked=(message:string)=>({state:'BLOCKED',label:'等待处理',message,nextDialAt:null});
 if(Date.parse(task.endTime)<=now.getTime())return blocked('任务已超过结束时间，正在整理剩余号码');
 try{
  const checks=new Map<string,{line:LineSettings;earliest:number}>();
  const unavailable: string[] = [];
  const hasOverrides = queued.some(attempt => attempt.result?.lineOverride !== undefined);
  for (const resolved of await resolveSipAttemptRoutes(db, task, queued)) {
   const attempt = resolved.attempt;
   if (!resolved.route) {
    const message = '线路分配已变化，等待系统更新任务状态';
    if (!hasOverrides) return blocked(message);
    unavailable.push(message); continue;
   }
   const line = resolved.route.line;
   const issue = !line.liveEnabled ? '所选线路已关闭，请联系超级管理员启用' : !line.serverIp || !line.whitelistConfirmed || (line.callerMode !== 'provider' && !line.callerNumber) ? '所选线路配置尚未完成，请联系超级管理员' : '';
   if (issue) {
    if (!hasOverrides) return blocked(issue);
    unavailable.push(issue); continue;
   }
   const earliest=Math.max(now.getTime(),Date.parse(task.startTime),Date.parse(attempt.nextAttemptAt)||0);
   const key=JSON.stringify([snapshot.policyOverride||line.dialPolicy,line.carrierPolicy]);
   const prior=checks.get(key);if(!prior||earliest<prior.earliest)checks.set(key,{line,earliest});
  }
  if (!checks.size) return blocked(unavailable[0] || '暂无可用重拨线路');
  const windows=[...checks.values()].map(({line,earliest})=>nextWindow(snapshot.policyOverride||line.dialPolicy,line,earliest,Date.parse(task.endTime)));
  const available=windows.flatMap(w=>w.at===null?[]:[w.at]);
  if(!available.length)return blocked(windows[0]?.message||'暂无可用拨打时段');
  const next=Math.min(...available);
  if(next<=now.getTime())return null; // Other capacity/readiness gates are evaluated by the worker.
  const scheduled=Date.parse(task.startTime)>now.getTime();
  const due=[...checks.values()].some(({line,earliest})=>!inDialWindow(snapshot.policyOverride||line.dialPolicy,new Date(earliest))||!holidayStatus(snapshot.policyOverride||line.dialPolicy,new Date(earliest)).allowed||!carrierWindowOpen(line,new Date(earliest)));
  return {state:due?'WAITING_WINDOW':scheduled?'WAITING_START':'WAITING_RETRY',label:due?'等待拨打时段':scheduled?'等待开始时间':'等待重拨时间',message:due?'当前不符合线路的拨打时间、星期或节假日规则，到时自动继续':scheduled?'尚未到任务开始时间，到时自动继续':'尚未到重拨时间，到时自动继续',nextDialAt:new Date(next).toISOString()};
 }catch{return blocked('暂时无法读取任务线路，请稍后重试或联系管理员');}
}
