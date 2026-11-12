/*
 * 中文导读：数据看板：dashboard.repository.ts。封装数据库读写操作。
 */
import { Prisma } from "../../../prisma/generated/prisma/client.js";
import prisma from "../../config/prisma.js";
import { crmDb } from "../crm/crm.db.js";
import { customerIntentCounts } from "../crm/customer-intent.repository.js";
import {companyContext,callVisibilityWhere,resolveDataOwner} from "../workspace/company-access.js";
import {grants} from "../workspace/company-policy.js";

// Only current provider receipts/results enter the sales dashboard.
const cloudCalls: Prisma.CallLogWhereInput = {
  OR: ["ALIYUN", "ALIYUN_AICCS", "ALIYUN_ENGINE", "HAOKEHU_SIP", "HAOKEHU_CALLBACK"].map(provider => ({ metadata: { path: ["provider"], equals: provider } })),
};

async function demoCallIds(organizationId:string,from:Date,to:Date){
  const rows=await prisma.$queryRaw<Array<{callId:string}>>`SELECT "callId" FROM "CallLog" WHERE "organizationId"=${organizationId} AND "startTime">=${from} AND "startTime"<${to} AND "metadata"->>'demoCall'='true'`;
  return rows.map(row=>row.callId);
}
const analyticsSelect = {
  callId: true,
  agentId: true,
  startTime: true,
  durationSeconds: true,
  status: true,
  direction: true,
} satisfies Prisma.CallLogSelect;

export const listAnalyticsCalls = async ({
  organizationId,
  from,
  to,
  viewerId,
  ownerId='mine',
}: {
  organizationId: string;
  from: Date;
  to: Date;
  viewerId?:string;
  ownerId?:string;
}) => {
  return prisma.callLog.findMany({
    where: {
      organizationId,
      ...cloudCalls,
      AND:[await callVisibilityWhere(organizationId,viewerId,ownerId),{callId:{notIn:await demoCallIds(organizationId,from,to)}}],
      deleted: false,
      startTime: {
        gte: from,
        lt: to,
      },
    },
    select: analyticsSelect,
    orderBy: [{ startTime: "asc" }, { callId: "asc" }],
  });
};

export const listRecentCalls = async (organizationId: string, from: Date, to: Date,viewerId?:string,ownerId='mine') => {
  return prisma.callLog.findMany({
    where: {
      organizationId,
      ...cloudCalls,
      AND:[await callVisibilityWhere(organizationId,viewerId,ownerId),{callId:{notIn:await demoCallIds(organizationId,from,to)}}],
      deleted: false,
      startTime: { gte: from, lt: to },
    },
    orderBy: [{ startTime: "desc" }, { callId: "desc" }],
    take: 10,
  });
};

export async function operationalSummary(organizationId: string, ownerId: string, from: Date, to: Date,requestedOwner='mine') {
  const access=await companyContext(organizationId,ownerId);
  const selectedOwner=await resolveDataOwner(organizationId,ownerId,requestedOwner);
  const manager=selectedOwner===undefined;
  const ids=selectedOwner?[selectedOwner]:[];
  const canCrm=grants(access.permissions,'crm','read');
  const canCloudTasks=grants(access.permissions,'campaigns','read');
  const canSipTasks=grants(access.permissions,'outboundCalls','read');
  const cloudTaskScope:Prisma.AliyunTaskWhereInput={organizationId,...(!manager?{executionPolicy:{path:['createdByUserId'],equals:selectedOwner}}:{})};
  const demoTasks=await prisma.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "SipTask" WHERE "workspaceId"=${organizationId} AND "deletedAt" IS NULL AND "snapshot"->>'demoCall'='true'`;
  const sipTaskScope:Prisma.SipTaskWhereInput={workspaceId:organizationId,deletedAt:null,id:{notIn:demoTasks.map(t=>t.id)},...(!manager?{createdBy:{in:ids}}:{})};
  const [agents, cloudTasks, sipTasks, cloudLatest, sipLatest, customers, handoffs, todos] = await Promise.all([
    !grants(access.permissions,'agent','read')?Promise.resolve([]):prisma.agent.findMany({ where: { organizationId, deletionRequestedAt: null }, select: { agentId: true, name: true, avatar: true, isActive: true, isConfigured: true }, orderBy: { createdAt: "asc" } }),
    !canCloudTasks?Promise.resolve([]):prisma.aliyunTask.groupBy({ by: ["status"], where: cloudTaskScope, _count: true }),
    !canSipTasks?Promise.resolve([]):prisma.sipTask.groupBy({by:["status"],where:sipTaskScope,_count:true}),
    !canCloudTasks?Promise.resolve([]):prisma.aliyunTask.findMany({ where: cloudTaskScope, select: { id: true, name: true, status: true, createdAt: true, syncedAt: true }, orderBy: [{ createdAt: "desc" },{id:"desc"}], take: 5 }),
    !canSipTasks?Promise.resolve([]):prisma.sipTask.findMany({where:sipTaskScope,select:{id:true,name:true,status:true,createdAt:true,updatedAt:true},orderBy:[{createdAt:"desc"},{id:"desc"}],take:5}),
    canCrm ? customerIntentCounts(crmDb, organizationId, selectedOwner||ownerId, !manager, from, to) : Promise.resolve({contacts:0,newContacts:0,interested:0,pending:0,added:0,sent:0,optOuts:0}),
    prisma.businessContact.count({ where: { organizationId,deletedAt:null,...(!canCrm?{id:{in:[]}}:!manager?{ownerId:{in:ids}}:{}),status:{notIn:["OPT_OUT","NO_NEED"]},handoffStatus: { in: ["PENDING", "ACCEPTED"] } } }),
    !grants(access.permissions,'automation','read')?Promise.resolve(0):prisma.automationTodo.count({ where: { organizationId,...(!manager?{ownerId:{in:ids}}:{}), status: "OPEN" } }),
  ]);
  const counts=new Map<string,number>();
  for(const row of [...cloudTasks,...sipTasks])counts.set(row.status,(counts.get(row.status)||0)+row._count);
  const taskCounts=Object.fromEntries(counts);
  const latestTasks=[...cloudLatest.map(task=>({...task,provider:'ALIYUN' as const,updatedAt:null})),...sipLatest.map(task=>({...task,provider:'HAOKEHU_SIP' as const,syncedAt:null}))]
    .sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id)).slice(0,5);
  return { agents, taskCounts, latestTasks, ...customers, customerScope: manager ? "all" as const : "mine" as const, handoffs, todos };
}
