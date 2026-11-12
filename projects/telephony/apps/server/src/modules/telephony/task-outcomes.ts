/*
 * 中文导读：线路与语音外呼：task-outcomes.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {Row} from '../crm/crm.service.js';
import {retryEligible} from './task-retry.js';

export type TaskOutcome='ANSWERED'|'UNANSWERED'|'FAILED'|'ASSISTANT'|'PENDING'|'ACTIVE'|'UNCERTAIN'|'CANCELLED';
export function taskRecipientOutcomes(task:Row,attempts:Row[],reserved=new Set<string>()){
 const recipients:Row[]=task.recipients;
 const grouped=new Map<number,Row[]>();
 for(const attempt of attempts){
  if(attempt.status==='CANCELLED'&&attempt.result?.retryPolicyCancelled&&!attempt.startedAt)continue;
  // Older SQL-indexed receipts may address an array element from its end.
  const index=attempt.recipientIndex<0?recipients.length+attempt.recipientIndex:attempt.recipientIndex;
  if(!Number.isInteger(index)||index<0||index>=recipients.length)continue;
  const rows=grouped.get(index)||[];rows.push(attempt);grouped.set(index,rows);
 }
 return recipients.map((_recipient:Row,recipientIndex:number)=>{
  const rows=grouped.get(recipientIndex)||[],latest=rows.reduce<Row|undefined>((prior,row)=>!prior||row.attemptNumber>prior.attemptNumber?row:prior,undefined);
  const assistant=rows.some(a=>a.result?.reason==='ANSWERING_MACHINE');
  const answered=rows.some(a=>a.status==='COMPLETED'||a.status==='CONNECTED'||a.result?.wasConnected||Number(a.result?.durationSeconds)>0);
  const active=rows.some(a=>['DISPATCHING','DIALING','CONNECTED'].includes(a.status));
  const uncertain=rows.some(a=>a.status==='NEEDS_REVIEW');
  const pending=latest?.status==='QUEUED';
  const outcome:TaskOutcome=active?'ACTIVE':uncertain?'UNCERTAIN':assistant?'ASSISTANT':answered?'ANSWERED':pending||!latest?'PENDING':latest.status==='NOT_ANSWERED'?'UNANSWERED':latest.status==='FAILED'?'FAILED':'CANCELLED';
  const blocked=!!latest&&reserved.has(latest.id);
  const redialEligible=!!latest&&!active&&!uncertain&&!pending&&!assistant&&!answered&&!blocked&&!rows.some(a=>a.result?.optOutRequested)&&(retryEligible(latest)||(latest.result?.manualRedial===true&&latest.result?.carrierSkipped===true&&!latest.startedAt));
  return {recipientIndex,attemptId:latest?.id||null,outcome,redialEligible,redialBlockedReason:blocked?'已安排重拨':undefined};
 });
}
export function taskOutcomeCounts(results:ReturnType<typeof taskRecipientOutcomes>){
 const counts:Record<TaskOutcome,number>={ANSWERED:0,UNANSWERED:0,FAILED:0,ASSISTANT:0,PENDING:0,ACTIVE:0,UNCERTAIN:0,CANCELLED:0};
 for(const result of results)counts[result.outcome]++;
 return counts;
}

export type TaskResultStats={dialed:number;answered:number;unanswered:number;assistant:number;pending:number};
export function emptyTaskResultStats():TaskResultStats{return {dialed:0,answered:0,unanswered:0,assistant:0,pending:0};}
const positiveDuration=/^[0-9]+([.][0-9]+)?$/;
function attemptAnswered(attempt:Row){
 const duration=String(attempt.result?.durationSeconds??'');
 return attempt.status==='COMPLETED'||attempt.status==='CONNECTED'||attempt.result?.wasConnected===true||(positiveDuration.test(duration)&&Number(duration)>0);
}
function attemptDialed(attempt:Row){
 // FAILED may be a preflight rejection. DISPATCHING/NEEDS_REVIEW alone
 // cannot prove dispatch; current workers persist startedAt when claiming.
 return attempt.startedAt!=null||attempt.status==='DIALING'||attempt.status==='NOT_ANSWERED'||attemptAnswered(attempt)||attempt.result?.reason==='ANSWERING_MACHINE';
}
// Independent recipient facts for presentation; keep legacy outcomes and redial
// classification unchanged. A queued retry can also have an earlier result.
export function taskResultStats(task:Row,attempts:Row[]):TaskResultStats{
 const recipients:Row[]=task.recipients,grouped=new Map<number,Row[]>();
 for(const attempt of attempts){
  if(attempt.status==='CANCELLED'&&String(attempt.result?.retryPolicyCancelled??'false')==='true'&&attempt.startedAt==null)continue;
  const index=attempt.recipientIndex<0?recipients.length+attempt.recipientIndex:attempt.recipientIndex;
  if(!Number.isInteger(index)||index<0||index>=recipients.length)continue;
  const rows=grouped.get(index)||[];rows.push(attempt);grouped.set(index,rows);
 }
 const counts=emptyTaskResultStats();
 for(let index=0;index<recipients.length;index++){
  const rows=grouped.get(index)||[];
  const latest=rows.reduce<Row|undefined>((prior,row)=>!prior||row.attemptNumber>prior.attemptNumber||(row.attemptNumber===prior.attemptNumber&&row.recipientIndex<prior.recipientIndex)?row:prior,undefined);
  const assistant=rows.some(row=>row.result?.reason==='ANSWERING_MACHINE');
  const answered=assistant||rows.some(attemptAnswered);
  const dialed=answered||rows.some(attemptDialed);
  const active=rows.some(row=>['DISPATCHING','DIALING','CONNECTED'].includes(row.status));
  const uncertain=rows.some(row=>row.status==='NEEDS_REVIEW');
  const unanswered=!answered&&!active&&!uncertain&&rows.some(row=>attemptDialed(row)&&['NOT_ANSWERED','FAILED','CANCELLED'].includes(row.status));
  if(dialed)counts.dialed++;
  if(answered)counts.answered++;
  if(unanswered)counts.unanswered++;
  if(assistant)counts.assistant++;
  if(!latest||latest.status==='QUEUED')counts.pending++;
 }
 return counts;
}
