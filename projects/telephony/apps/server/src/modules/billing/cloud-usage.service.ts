/*
 * 中文导读：用量与费用：cloud-usage.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import prisma from '../../config/prisma.js';
import {companyContext} from '../workspace/company-access.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {presets} from '../telephony/models.service.js';
import {modelPlatforms} from '../telephony/model-platforms.js';
import {crmDb} from '../crm/crm.db.js';
import {withCallCosts,sumCallCosts,modelCost} from './call-costs.js';
import type {Row} from '../crm/crm.service.js';

export async function cloudUsage(organizationId:string,userId:string){
 const context=await companyContext(organizationId,userId);
 if(!context.canManage)throw new ForbiddenError('仅全公司授权管理员可以查看公司用量。');
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
 const start=new Date(month+'-01T00:00:00+08:00'),[year,n]=month.split('-').map(Number),next=new Date(Date.UTC(year!,n!,1)-8*3600000);
 const [calls,summaryRuns,modelSettings,observations]=await Promise.all([
  crmDb.query(`SELECT "callId","callerId","startTime","status","durationSeconds","metadata"->>'mode' AS mode FROM "CallLog" WHERE "organizationId"=$1 AND "deleted"=false AND "startTime">=$2 AND "startTime"<$3 ORDER BY "startTime" DESC,"callId" DESC`,[organizationId,start,next]),
  prisma.automationRun.count({where:{organizationId,kind:'CALL_SUMMARY',status:'SUCCESS',createdAt:{gte:start,lt:next}}}),
  prisma.$queryRaw<Array<{settings:{enabled?:string[];summaryModel?:string}}>>`SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=${organizationId}`,
  crmDb.query(`SELECT "provider","modelId","purpose","callId","requests","missingUsage","inputTokens","outputTokens","totalTokens","inputAudioTokens","outputAudioTokens","cachedTokens" FROM "ModelUsageRecord" WHERE "workspaceId"=$1 AND "createdAt">=$2 AND "createdAt"<$3`,[organizationId,start,next]),
 ]);
 const costed=await withCallCosts(crmDb,organizationId,calls as Array<Row&{callId:string}>);
 const groups=new Map<string,typeof costed>();
 for(const c of costed){const group=groups.get(c.cost.provider)||[];group.push(c);groups.set(c.cost.provider,group);}
 const lines=Array.from(groups,([name,rows])=>{const costs=sumCallCosts(rows);return {provider:name,name,calls:rows.length,completed:rows.filter(c=>c.status==='COMPLETED').length,recordedSeconds:rows.reduce((n,c)=>n+Math.max(c.durationSeconds||0,0),0),missingDuration:rows.filter(c=>c.status==='COMPLETED'&&c.durationSeconds===null).length,digitalCalls:rows.filter(c=>c.mode!=='MANUAL').length,manualCalls:rows.filter(c=>c.mode==='MANUAL').length,estimatedCny:costs.phoneCny,knownCny:costs.knownPhoneCny,unpricedCalls:costs.pendingPhoneCalls,billableMinutes:costs.billableMinutes};});
 const modelGroups=new Map<string,Row[]>();
 for(const row of observations){const key=row.provider+':'+row.modelId;const list=modelGroups.get(key)||[];list.push(row);modelGroups.set(key,list);}
 const modelUsage=Array.from(modelGroups.values(),rows=>{const r=rows[0]!,costs=rows.map(modelCost),sum=(key:string)=>{const values=rows.filter(r=>r[key]!==null);return values.length?values.reduce((n,r)=>n+Number(r[key]),0):null;};const knownCny=costs.reduce((n,c)=>n+c.knownCny,0);return {provider:r.provider,modelId:r.modelId,name:presets.find(p=>p.id===r.modelId)?.name||r.modelId,providerName:modelPlatforms.find(p=>p.id===r.provider)?.name||r.provider,billingUrl:modelPlatforms.find(p=>p.id===r.provider)?.billingUrl||null,requests:sum('requests')||0,missingUsage:sum('missingUsage')||0,totalTokens:sum('totalTokens'),inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),estimatedCny:costs.some(c=>c.amountCny===null)?null:knownCny,knownCny,pendingRecords:costs.filter(c=>c.amountCny===null).length};});
 const authorized=modelSettings[0]?.settings.enabled||[];
 return {month,calls:calls.length,completed:lines.reduce((n,r)=>n+r.completed,0),recordedSeconds:lines.reduce((n,r)=>n+r.recordedSeconds,0),missingDuration:lines.reduce((n,r)=>n+r.missingDuration,0),summaryRuns,lines,costs:sumCallCosts(costed),recentCosts:costed.slice(0,20).map(c=>({callId:c.callId,phone:c.callerId,startTime:c.startTime,durationSeconds:c.durationSeconds,cost:c.cost})),
  models:presets.filter(p=>authorized.includes(p.id)).map(p=>({id:p.id,name:p.name,vendor:p.vendor,kind:p.kind})),modelUsage,publicKnownCny:observations.filter(r=>!r.callId).map(modelCost).reduce((n,c)=>n+c.knownCny,0),
  summaryModel:presets.find(p=>p.id===modelSettings[0]?.settings.summaryModel)?.name??null,updatedAt:new Date().toISOString()};
}
