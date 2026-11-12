/*
 * 中文导读：线路与语音外呼：task-continuation.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type {Row} from '../crm/crm.service.js';

// Only recipients that have never reached dispatch can be recovered here.
// Submitted, uncertain, answered and retry attempts belong to other workflows.
export function taskContinuationIndices(task:Row, attempts:Row[], now=Date.now()):number[] {
  const snapshot=task.snapshot||{};
  if(task.deletedAt || snapshot.mode==='MANUAL' || snapshot.testCall ||
    (snapshot.provider||'HAOKEHU_SIP')!=='HAOKEHU_SIP' ||
    !['DRAFT','RUNNING','PAUSED','NEEDS_REVIEW','COMPLETED','FAILED'].includes(task.status) ||
    !(new Date(task.endTime).getTime()<=now)) return [];
  const grouped=new Map<number,Row[]>();
  for(const attempt of attempts){
    const rows=grouped.get(attempt.recipientIndex)||[];
    rows.push(attempt);grouped.set(attempt.recipientIndex,rows);
  }
  return task.recipients.flatMap((_recipient:Row,index:number)=>{
    const rows=grouped.get(index)||[];
    if(!rows.length)return task.status==='DRAFT'?[index]:[];
    if(rows.some(row=>row.startedAt || row.result?.dispatchedLine || row.result?.wasConnected ||
      row.result?.optOutRequested || Number(row.result?.durationSeconds)>0 || Number(row.attemptNumber)!==1))return [];
    return rows.every(row=>row.status==='QUEUED' ||
      row.status==='CANCELLED' && (row.result?.taskExpired===true || row.result?.reason==='任务拨打期限已过'))?[index]:[];
  });
}
