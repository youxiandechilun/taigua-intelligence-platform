/*
 * 中文导读：线路与语音外呼：test-calls.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type Scope } from '../crm/crm.service.js';
import { grants } from '../workspace/company-policy.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { recipientSchema } from '../aliyun/aliyun.schema.js';
import { createTask, taskAction } from './sip.service.js';
import { dialSelectionSchema } from './sip.schema.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';

export const testCallSchema=z.object({
 requestId:z.string().uuid(), agentId:z.string().uuid(),
 phoneNumber:recipientSchema.shape.phoneNumber,
 ...dialSelectionSchema.shape,
 requestedAt:z.iso.datetime({offset:true}),
 confirmation:z.literal('拨打测试电话'),
}).strict();

export async function testCallStatus(s:Scope,id:string){
 const row=(await crmDb.query('SELECT "id","agentId","status","snapshot","error" FROM "SipTask" WHERE "workspaceId"=$1 AND "createdBy"=$2 AND "id"=$3 AND "deletedAt" IS NULL',[s.workspaceId,s.userId,id]))[0];
 if(!row||row.snapshot.testCall!==true)throw new NotFoundError('测试记录不存在或不属于当前账号。');
 const attempts=await crmDb.query('SELECT "id","status","result" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 ORDER BY "attemptNumber" DESC LIMIT 1',[s.workspaceId,id]);
 const attempt=attempts[0];
 return {id:row.id,agentId:row.agentId,taskStatus:row.status,status:attempt?.status||row.status,
  attemptId:attempt?.id||null,error:row.error||attempt?.result?.reason||'',
  diagnostics:attempt?.result?.diagnostics||null,
  durationSeconds:attempt?.result?.durationSeconds||0, agentName:row.snapshot.agentName,
  voiceName:row.snapshot.employeeVoice?.name||'',maxDurationSeconds:row.snapshot.maxDurationSeconds};
}
export async function startTestCall(s:Scope,raw:unknown){
 if(!grants((await memberAccess(crmDb,s)).permissions,'outboundCalls','create'))throw new ForbiddenError('当前账号不能发起外呼。');
 const data=testCallSchema.parse(raw);
 // Stable input and task id survive a lost HTTP response. Repeating this POST
 // can never resume a paused task or create a second attempt.
 const existing=(await crmDb.query('SELECT "id" FROM "SipTask" WHERE "id"=$1',[data.requestId]))[0];
 if(!existing&&Math.abs(Date.now()-Date.parse(data.requestedAt))>5*60000)throw new BadRequestError('测试请求已过期，请重新打开测试窗口。');
 const draft=await createTask(s,{
  requestId:data.requestId,agentId:data.agentId,name:'模型测试',parallelism:1,provider:'HAOKEHU_SIP',
  ...(data.lineId?{lineId:data.lineId}:{}),...(data.province?{province:data.province}:{}),
  recipients:[{phoneNumber:data.phoneNumber,name:'测试接听人',variables:{}}],
  startTime:data.requestedAt,endTime:new Date(Date.parse(data.requestedAt)+5*60000).toISOString(),
 },{testCall:true});
 const state=await testCallStatus(s,draft.id);
 if(state.taskStatus==='DRAFT'){
  try{await taskAction(s,draft.id,'start',draft.id);}
  catch(error){
   // A concurrent identical request may already have started this task.
   const current=await testCallStatus(s,draft.id);
   if(current.taskStatus==='DRAFT')throw error;
  }
 }
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'agent.test-call.requested',resourceType:'SipTask',resourceId:draft.id,metadata:{agentId:data.agentId}});
 return testCallStatus(s,draft.id);
}

export async function discardTestCallDraft(s:Scope,id:string){
 const current=await testCallStatus(s,id);
 if(current.taskStatus!=='DRAFT')throw new BadRequestError('测试已提交线路，不能重新拨号；请先核对通话状态。');
 const {deleteDraft}=await import('./sip.service.js');return deleteDraft(s,id);
}
