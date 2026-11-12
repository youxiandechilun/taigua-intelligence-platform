/*
 * 中文导读：业务线索：business.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { crmDbFor } from "../crm/crm.db.js";
import { importPrepared,legacyImportRow } from "../crm/crm.import.js";
import { crmService } from "../crm/crm.service.js";
import { randomUUID } from "node:crypto";
import { exportWorkbook } from "@repo/spreadsheets";
import prisma from "../../config/prisma.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { customerVisibleSql,scopedOwnerSql,grants } from "../workspace/company-policy.js";
import {memberAccess} from "../crm/crm.service.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import {
  researchCompanyDetailed,
  searchCompanyPages,
  publicCompanyUrl,
  type Lead,
} from "./business.research.js";

export type Scope = {
  organizationId: string;
  ownerId: string;
  companyWide?: boolean;
};
export type Contact = Lead & {
  id: string;
  ownerId: string;
  ownerName: string;
  status: string;
  notes: string;
  nextFollowUp: Date | null;
  wecomStatus: string;
  handoffStatus: string;
  handoffReason: string;
  updatedAt: Date;
};
type Job = Scope & {
  id: string;
  industry: string;
  region: string;
  target: number;
  status: string;
  message: string;
  cursor: number;
  sources: string[];
  visited: string[];
  results: Lead[];
  diagnostics: Diagnostics;
  nextSearchAt: Date | null;
  updatedAt: Date;
};
type Diagnostics = {
  since?: string; historicalAttempts?: number; attempted?: number; fetchedPages?: number;
  accepted?: number; irrelevant?: number; region?: number; noCompany?: number; noPhone?: number;
  unavailable?: number; duplicates?: number; searchCandidates?: number; searchFiltered?: number;
  searchFailures?: number; consecutiveEmpty?: number; query?: string; provider?: string; seenHosts?: string[];
};
function contactVisibleSql(alias='b'){
 return `((NOT EXISTS (SELECT 1 FROM "CrmLead" l WHERE l."workspaceId"=$1 AND l."sourceContactId"=${alias}."id") AND ${scopedOwnerSql(alias+'."ownerId"')}) OR EXISTS (SELECT 1 FROM "CrmLead" l JOIN "CrmCompany" c ON c."workspaceId"=l."workspaceId" AND c."id"=l."companyId" WHERE l."workspaceId"=$1 AND l."sourceContactId"=${alias}."id" AND c."deletedAt" IS NULL AND ${customerVisibleSql()}))`;
}
async function contactAction(db:ReturnType<typeof crmDbFor>,s:Scope,action:string){
 const access=await memberAccess(db,{workspaceId:s.organizationId,userId:s.ownerId});if(!grants(access.permissions,'crm',action))throw new ForbiddenError('当前角色未授权此客户操作。');
}
export async function listContacts(s: Scope) {
 await memberAccess(crmDbFor(prisma),{workspaceId:s.organizationId,userId:s.ownerId});
 return crmDbFor(prisma).query(`SELECT c.*,COALESCE(cc."ownerId",c."ownerId") AS "ownerId",u."name" AS "ownerName",CASE WHEN cc."id" IS NULL THEN c."status" ELSE CASE cc."status"::text WHEN 'INTERESTED' THEN 'INTERESTED' WHEN 'FOLLOW_UP' THEN 'FOLLOW_UP' WHEN 'OPT_OUT' THEN 'OPT_OUT' WHEN 'INVALID' THEN 'NO_NEED' WHEN 'WON' THEN 'NO_NEED' ELSE 'NEW' END END AS "status",CASE WHEN cc."id" IS NULL THEN c."nextFollowUp" ELSE cc."nextFollowUp" END AS "nextFollowUp",cc."id" AS "crmCompanyId" FROM "BusinessContact" c LEFT JOIN LATERAL (SELECT co.* FROM "CrmLead" l JOIN "CrmCompany" co ON co."workspaceId"=l."workspaceId" AND co."id"=l."companyId" WHERE l."workspaceId"=c."organizationId" AND l."sourceContactId"=c."id" LIMIT 1) cc ON true LEFT JOIN "User" u ON u."id"=COALESCE(cc."ownerId",c."ownerId") WHERE c."organizationId"=$1 AND c."deletedAt" IS NULL AND ((cc."id" IS NULL AND ${scopedOwnerSql('c."ownerId"')}) OR (cc."id" IS NOT NULL AND cc."deletedAt" IS NULL AND ${customerVisibleSql('cc')})) ORDER BY c."updatedAt" DESC LIMIT 5000`,[s.organizationId,s.ownerId]) as Promise<Contact[]>;
}
export async function saveContact(s: Scope, lead: Lead) {
  return prisma.$transaction(async tx=>{
  const rows=await tx.$queryRaw<
    Contact[]
  >`INSERT INTO "BusinessContact" ("id","organizationId","ownerId","companyName","phone","industry","address","business","sourceUrl","deletedAt") VALUES (${randomUUID()},${s.organizationId},${s.ownerId},${lead.companyName},${lead.phone},${lead.industry},${lead.address},${lead.business},${lead.sourceUrl},NULL) ON CONFLICT ("organizationId","ownerId","phone") DO UPDATE SET "address"=CASE WHEN "BusinessContact"."address"='' THEN EXCLUDED."address" ELSE "BusinessContact"."address" END, "business"=CASE WHEN "BusinessContact"."business"='' THEN EXCLUDED."business" ELSE "BusinessContact"."business" END, "deletedAt"=NULL, "updatedAt"=NOW() RETURNING *`;
  if(rows[0]){
   const db=crmDbFor(tx);const result=await importPrepared(db,{workspaceId:s.organizationId,userId:s.ownerId},[legacyImportRow(rows[0])],rows);
   if(result.errors.length)throw new BadRequestError('客户暂未归档，请稍后重试。');
  }
  return rows;
 },{maxWait:10000,timeout:60000});
}
export async function deleteContacts(s:Scope,ids:string[]){
 return prisma.$transaction(async tx=>{
 const db=crmDbFor(tx);await contactAction(db,s,'delete');
 const rows=await db.query(`UPDATE "BusinessContact" b SET "deletedAt"=NOW(),"updatedAt"=NOW(),"handoffStatus"='NONE',"nextFollowUp"=NULL WHERE b."organizationId"=$1 AND b."deletedAt" IS NULL AND b."id"=ANY($3::text[]) AND ${contactVisibleSql()} RETURNING b."id"`,[s.organizationId,s.ownerId,ids]);
 if(!rows.length)throw new BadRequestError('没有可删除的客户，可能已被删除或无权访问。');return{deleted:rows.length};
 });
}
export async function updateContact(
  s: Scope,
  id: string,
  p: Pick<
    Contact,
    | "status"
    | "notes"
    | "nextFollowUp"
    | "wecomStatus"
    | "handoffStatus"
    | "handoffReason"
  >,
) {
  if (p.status === "OPT_OUT") {
    p.wecomStatus = "NONE";
    p.handoffStatus = "NONE";
    p.nextFollowUp = null;
  }
  return prisma.$transaction(async tx=>{
  const db=crmDbFor(tx);await contactAction(db,s,'update');
  const rows=await db.query(`UPDATE "BusinessContact" b SET "status"=$4,"notes"=$5,"nextFollowUp"=$6,"wecomStatus"=$7,"handoffStatus"=$8,"handoffReason"=$9,"updatedAt"=NOW() WHERE b."id"=$3 AND b."organizationId"=$1 AND b."deletedAt" IS NULL AND ${contactVisibleSql()} RETURNING b.*`,[s.organizationId,s.ownerId,id,p.status,p.notes,p.nextFollowUp,p.wecomStatus,p.handoffStatus,p.handoffReason]);
  if (!rows.length) throw new BadRequestError("客户不存在或不属于当前账号。");
  const linked=await tx.$queryRaw<Array<{companyId:string}>>`SELECT l."companyId" FROM "CrmLead" l JOIN "CrmCompany" c ON c."workspaceId"=l."workspaceId" AND c."id"=l."companyId" WHERE l."workspaceId"=${s.organizationId} AND l."sourceContactId"=${id} AND c."deletedAt" IS NULL LIMIT 1`;
  if(linked[0])await crmService(crmDbFor(tx)).follow({workspaceId:s.organizationId,userId:s.ownerId},linked[0].companyId,{status:({NEW:'REVIEW',INTERESTED:'INTERESTED',FOLLOW_UP:'FOLLOW_UP',NO_NEED:'INVALID',OPT_OUT:'OPT_OUT'} as Record<string,string>)[p.status],notes:p.notes||'更新客户跟进状态',nextFollowUp:p.nextFollowUp?.toISOString()||null});
  return rows[0];
 },{maxWait:10000,timeout:60000});
}
export async function assignContact(
  s: Scope,
  id: string,
  targetUserId: string,
) {

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"company-policy:"+s.organizationId}))::text AS locked`;
    const access=await memberAccess(crmDbFor(tx),{workspaceId:s.organizationId,userId:s.ownerId});
    const actor = await tx.member.findFirst({
      where: {
        organizationId: s.organizationId,
        userId: s.ownerId,
        enabled: true,
        user: { banned: false },
      },
    });
    if (!actor || !grants(access.permissions,'crm','assign'))
      throw new ForbiddenError("公司管理权限已变更。");
    // Lock recipient membership so a concurrent suspension cannot race assignment.
    await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "organizationId"=${s.organizationId} AND "userId"=${targetUserId} FOR UPDATE`;
    const recipient = await tx.member.findFirst({
      where: {
        organizationId: s.organizationId,
        userId: targetUserId,
        enabled: true,
        user: { banned: false },
      },
    });
    if (!recipient || !(await crmDbFor(tx).query(`SELECT 1 FROM "Member" m WHERE m."organizationId"=$1 AND m."userId"=$3 AND ${scopedOwnerSql('m."userId"')}`,[s.organizationId,s.ownerId,targetUserId])).length) throw new BadRequestError("只能分配给授权组织内已启用的员工。");
    const rows = await tx.$queryRaw<
      Contact[]
    >`SELECT * FROM "BusinessContact" WHERE "id"=${id} AND "organizationId"=${s.organizationId} AND "deletedAt" IS NULL FOR UPDATE`;
    const contact = rows[0];
    if (!contact || !((await crmDbFor(tx).query(`SELECT b."id" FROM "BusinessContact" b WHERE b."organizationId"=$1 AND b."id"=$3 AND ${contactVisibleSql()}`,[s.organizationId,s.ownerId,id])).length)) throw new BadRequestError("客户不存在或不在授权范围。");
    const linked=await tx.$queryRaw<Array<{companyId:string;ownerId:string}>>`SELECT l."companyId",c."ownerId" FROM "CrmLead" l JOIN "CrmCompany" c ON c."workspaceId"=l."workspaceId" AND c."id"=l."companyId" WHERE l."workspaceId"=${s.organizationId} AND l."sourceContactId"=${id} AND c."deletedAt" IS NULL LIMIT 1`;
    const previousOwnerId=linked[0]?.ownerId||contact.ownerId;
    if (previousOwnerId === targetUserId) return { id, ownerId: targetUserId };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${s.organizationId + ":" + targetUserId + ":" + contact.phone}))::text AS locked`;
    const duplicates = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "BusinessContact" WHERE "organizationId"=${s.organizationId} AND "deletedAt" IS NULL AND "ownerId"=${targetUserId} AND "phone"=${contact.phone} AND "id"<>${id}`;
    if (duplicates.length&&!linked[0])
      throw new BadRequestError(
        "该员工已有相同电话号码的客户。请先核对两条记录，本次未覆盖或合并资料。",
      );
    if(linked[0])await crmService(crmDbFor(tx)).assign({workspaceId:s.organizationId,userId:s.ownerId},[linked[0].companyId],targetUserId);
    if(!linked[0])await tx.$executeRaw`UPDATE "BusinessContact" SET "ownerId"=${targetUserId},"updatedAt"=NOW() WHERE "id"=${id} AND "organizationId"=${s.organizationId}`;
    await tx.$executeRaw`INSERT INTO "ContactAssignment" ("id","organizationId","contactId","actorId","previousOwnerId","ownerId") VALUES (${randomUUID()},${s.organizationId},${id},${s.ownerId},${previousOwnerId},${targetUserId})`;
    return { id, ownerId: targetUserId };
  });
}
export async function assignmentHistory(s: Scope, id: string) {
  const visible=await crmDbFor(prisma).query(`SELECT b."id" FROM "BusinessContact" b WHERE b."organizationId"=$1 AND b."id"=$3 AND b."deletedAt" IS NULL AND ${contactVisibleSql()}`,[s.organizationId,s.ownerId,id]);
  if (!visible.length) throw new BadRequestError("客户不存在或无权查看。");
  return prisma.$queryRaw`SELECT a."id",a."createdAt",u."name" AS "actorName",p."name" AS "previousOwnerName",n."name" AS "ownerName" FROM "ContactAssignment" a LEFT JOIN "User" u ON u."id"=a."actorId" LEFT JOIN "User" p ON p."id"=a."previousOwnerId" LEFT JOIN "User" n ON n."id"=a."ownerId" WHERE a."organizationId"=${s.organizationId} AND a."contactId"=${id} ORDER BY a."createdAt" DESC LIMIT 100`;
}
const present = (j: Job) => ({
  id: j.id,
  industry: j.industry,
  region: j.region,
  target: j.target,
  status: j.status,
  message: j.message,
  cursor: j.cursor,
  results: j.results,
  updatedAt: j.updatedAt,
  sourceCount: j.sources.length,
  visitedCount: j.visited.length,
  companyCount: new Set(j.results.map(r => r.companyName.normalize("NFKC").replace(/\s/g, ""))).size,
  phoneCount: new Set(j.results.map(r => r.phone)).size,
  diagnostics: { ...j.diagnostics, seenHosts: undefined },
  nextSearchAt: j.nextSearchAt,
});
export async function listJobs(s: Scope) {
  const rows = await prisma.$queryRaw<
    Job[]
  >`SELECT * FROM "LeadSearchJob" WHERE "organizationId"=${s.organizationId} AND "ownerId"=${s.ownerId} ORDER BY "createdAt" DESC LIMIT 20`;
  return rows.map(present);
}
export async function ownedJob(s: Scope, id: string) {
  const rows = await prisma.$queryRaw<
    Job[]
  >`SELECT * FROM "LeadSearchJob" WHERE "id"=${id} AND "organizationId"=${s.organizationId} AND "ownerId"=${s.ownerId}`;
  if (!rows[0]) throw new BadRequestError("线索任务不存在或不属于当前账号。");
  return rows[0];
}
export async function createJob(
  s: Scope,
  industry: string,
  region: string,
  target: number,
) {
  // Lock on the owner to prevent two simultaneous clicks creating duplicate running jobs.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${s.organizationId + ":" + s.ownerId}))::text AS locked`;
    const active = await tx.$queryRaw<
      Job[]
    >`SELECT * FROM "LeadSearchJob" WHERE "organizationId"=${s.organizationId} AND "ownerId"=${s.ownerId} AND "status"='SEARCHING' LIMIT 1`;
    if (active.length)
      throw new BadRequestError("已有线索任务正在搜索，请先暂停该任务。");
    return tx.$queryRaw<
      Job[]
    >`INSERT INTO "LeadSearchJob" ("id","organizationId","ownerId","industry","region","target") VALUES (${randomUUID()},${s.organizationId},${s.ownerId},${industry},${region},${target}) RETURNING *`;
  });
  return present(rows[0]!);
}
export async function changeJob(
  s: Scope,
  id: string,
  action: "pause" | "resume",
  sources: string[],
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${s.organizationId + ":" + s.ownerId}))::text AS locked`;
    const jobs = await tx.$queryRaw<
      Job[]
    >`SELECT * FROM "LeadSearchJob" WHERE "id"=${id} AND "organizationId"=${s.organizationId} AND "ownerId"=${s.ownerId} FOR UPDATE`;
    const job = jobs[0];
    if (!job) throw new BadRequestError("线索任务不存在或不属于当前账号。");
    if (job.status === "COMPLETE")
      throw new BadRequestError("该任务已达到目标，请新建任务。");
    if (action === "resume") {
      const active = await tx.$queryRaw<
        Job[]
      >`SELECT * FROM "LeadSearchJob" WHERE "organizationId"=${s.organizationId} AND "ownerId"=${s.ownerId} AND "status"='SEARCHING' AND "id"<>${id} LIMIT 1`;
      if (active.length)
        throw new BadRequestError("请先暂停当前正在搜索的任务。");
    }
    const normalized = sources.map(publicCompanyUrl);
    if (normalized.some((u) => !u))
      throw new BadRequestError("请填写企业公开官网地址。");
    const combined = [...new Set([...job.sources, ...normalized])].filter(
      (u) => !job.visited.includes(u),
    );
    const status = action === "pause" ? "PAUSED" : "SEARCHING";
    const rows = await tx.$queryRaw<
      Job[]
    >`UPDATE "LeadSearchJob" SET "status"=${status},"nextSearchAt"=NULL,"sources"=${JSON.stringify(combined)}::jsonb,"message"=${action === "pause" ? "已暂停，结果已保留" : "继续搜索，未达到目标不会标为完成"},"updatedAt"=NOW() WHERE "id"=${id} RETURNING *`;
    return present(rows[0]!);
  });
}

let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
let stopping = false;
async function processOne() {
  const rows = await prisma.$queryRaw<
    Job[]
  >`UPDATE "LeadSearchJob" SET "lockedUntil"=NOW()+INTERVAL '10 minutes' WHERE "id"=(SELECT "id" FROM "LeadSearchJob" WHERE "status"='SEARCHING' AND ("lockedUntil" IS NULL OR "lockedUntil"<NOW()) AND ("nextSearchAt" IS NULL OR "nextSearchAt"<=NOW()) ORDER BY "updatedAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
  const job = rows[0];
  if (!job) return;
  if (
    !(await prisma.member.findFirst({
      where: {
        organizationId: job.organizationId,
        userId: job.ownerId,
        enabled: true,
        user: { banned: false },
      },
    }))
  ) {
    await prisma.$executeRaw`UPDATE "LeadSearchJob" SET "status"='PAUSED',"lockedUntil"=NULL,"message"='账号已停用，任务已暂停' WHERE "id"=${job.id}`;
    return;
  }
  const results = new Map(job.results.map((r) => [r.phone, r]));
  let sources = [...job.sources];
  const visited = new Set(job.visited);
  const stats: Diagnostics = { ...job.diagnostics };
  const recheck = new Set<string>();
  if (!stats.since) {
    stats.since = new Date().toISOString();
    stats.historicalAttempts = job.visited.length;
    // Revisit previously accepted official pages once with the improved phone extractor.
    for (const lead of job.results) if (publicCompanyUrl(lead.sourceUrl)) recheck.add(lead.sourceUrl);
    sources = [...new Set([...recheck, ...sources])];
  }
  const hosts = new Set(stats.seenHosts || []);
  const add = (key: keyof Diagnostics, amount = 1) => {
    (stats as Record<string, unknown>)[key] = Number(stats[key] || 0) + amount;
  };
  let cursor = job.cursor;
  let retryAt: Date | null = null;
  try {
    if (!sources.length) {
      const search = await searchCompanyPages(job.industry, job.region, cursor);
      cursor++;
      stats.query = search.query;
      stats.provider = search.provider;
      add("searchCandidates", search.candidates);
      add("searchFiltered", search.filtered);
      add("searchFailures", search.unavailable);
      sources = search.urls.filter(url => !visited.has(url) && !hosts.has(new URL(url).hostname));
      stats.consecutiveEmpty = sources.length ? 0 : (stats.consecutiveEmpty || 0) + 1;
      if (!sources.length) retryAt = new Date(Date.now() + Math.min(900000, 15000 * 2 ** Math.min(stats.consecutiveEmpty, 6)));
    }
    const batch = sources.filter((url, i, all) => all.findIndex(other => new URL(other).hostname === new URL(url).hostname) === i).slice(0, 3);
    const research = await Promise.allSettled(batch.map(url => researchCompanyDetailed(url, job.industry, job.region)));
    for (let i=0; i<batch.length; i++) {
      if (stopping) break;
      const active = await prisma.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "LeadSearchJob" WHERE "id"=${job.id}`;
      if (active[0]?.status !== "SEARCHING") break;
      const url=batch[i]!;
      sources=sources.filter(s => s !== url);
      if(visited.has(url) && !recheck.has(url))continue;
      visited.add(url);add("attempted");
      const result=research[i]!;
      if(result.status === "rejected" || result.value.reason === "UNAVAILABLE") { add("unavailable"); continue; }
      const found=result.value;add("fetchedPages",found.pages);
      hosts.add(new URL(url).hostname);
      const reasons = {IRRELEVANT:"irrelevant",REGION:"region",NO_COMPANY:"noCompany",NO_PHONE:"noPhone",ACCEPTED:"accepted"} as const;
      if(found.reason !== "UNAVAILABLE") add(reasons[found.reason]);
      for(const lead of found.leads) {
        if(results.size >= job.target)break;
        if(results.has(lead.phone)) {add("duplicates");continue;}
        await saveContact(job,lead);
        results.set(lead.phone,lead);
      }
      if(results.size >= job.target)break;
    }
    sources=sources.filter(url => !hosts.has(new URL(url).hostname));
    stats.seenHosts=[...hosts];
    const complete=results.size>=job.target;
    const message=complete
      ? `已收集 ${results.size} 个不重复的国内企业电话，任务已完成`
      : retryAt
        ? `已收集 ${results.size}/${job.target} 个电话；本轮暂无新来源，系统将在 ${retryAt.toLocaleTimeString("zh-CN", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit"})} 自动继续搜索`
        : `已收集 ${results.size}/${job.target} 个电话，继续查找匹配行业的国内企业`;
    await prisma.$executeRaw`UPDATE "LeadSearchJob" SET "results"=${JSON.stringify([...results.values()])}::jsonb,"diagnostics"=${JSON.stringify(stats)}::jsonb,"nextSearchAt"=CASE WHEN "status"='SEARCHING' THEN ${complete ? null : retryAt} ELSE "nextSearchAt" END,"sources"=(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements("sources" || ${JSON.stringify(sources)}::jsonb) WHERE NOT (${JSON.stringify([...visited])}::jsonb @> jsonb_build_array(value)) AND NOT (${JSON.stringify(job.sources.filter(url => hosts.has(new URL(url).hostname)))}::jsonb @> jsonb_build_array(value))),"visited"=${JSON.stringify([...visited])}::jsonb,"cursor"=${cursor},"status"=CASE WHEN "status"='SEARCHING' AND ${complete} THEN 'COMPLETE' ELSE "status" END,"message"=CASE WHEN "status"='SEARCHING' THEN ${message} ELSE "message" END,"lockedUntil"=NULL,"updatedAt"=NOW() WHERE "id"=${job.id}`;
  } catch {
    // Keep the job unfinished and retry automatically; never substitute invented numbers.
    await prisma.$executeRaw`UPDATE "LeadSearchJob" SET "nextSearchAt"=NOW()+INTERVAL '1 minute',"message"=CASE WHEN "status"='SEARCHING' THEN '搜索暂未成功，已保留进度，系统将在一分钟后自动重试' ELSE "message" END,"lockedUntil"=NULL,"updatedAt"=NOW() WHERE "id"=${job.id}`;
  }
}
export function startBusinessWorker() {
  stopping = false;
  timer = setInterval(() => {
    if (running || stopping) return;
    running = processOne()
      .catch(() => console.warn("[business] lead worker unavailable"))
      .finally(() => {
        running = undefined;
      });
  }, 5000);
  timer.unref();
}
export async function stopBusinessWorker() {
  stopping = true;
  if (timer) clearInterval(timer);
  await running;
}

export function leadWorkbook(leads: Lead[], contacts = false, task?: Pick<Job, "target" | "status" | "region">) {
  const headers = [
    "公司名称",
    "地址",
    "经营业务",
    "联系电话",
    "行业",
    "来源网址",
    ...(contacts ? ["负责人", "客户意向", "跟进备注", "下次跟进时间"] : []),
  ];
  const rows = [
    ...leads.map((r) => [
      r.companyName,
      r.address || "暂未公开",
      r.business || "暂未公开",
      r.phone,
      r.industry,
      r.sourceUrl,
      ...(contacts
        ? [
            (r as Contact).ownerName || "",
            (
              {
                NEW: "待跟进",
                INTERESTED: "有意向",
                FOLLOW_UP: "继续跟进",
                NO_NEED: "暂无需求",
                OPT_OUT: "拒绝联系",
              } as Record<string, string>
            )[(r as Contact).status] || "",
            (r as Contact).notes || "",
            (r as Contact).nextFollowUp
              ? new Date((r as Contact).nextFollowUp!).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })
              : "",
          ]
        : []),
    ]),
  ];
  return Buffer.from(exportWorkbook(headers, rows, contacts ? '客户跟进' : '国内企业线索', [['数据范围', contacts ? '当前工作区授权客户的跟进数据。' : '本次行业搜索结果，可导入客户库。'], ['号码说明','按联系电话去重，同一家企业的不同号码分别占一行；座机已包含区号。'], ...(task ? [['搜索进度', `${new Set(leads.map(r => r.phone)).size}/${task.target} 个电话；${task.status === 'COMPLETE' ? '已达到目标' : '任务尚未完成，下载不影响继续搜索'}；地区：${task.region}`]] : []), ['客户核对','企业公开联系方式；导入客户库后仍须核对业务联系和拒呼状态。']]));
}
