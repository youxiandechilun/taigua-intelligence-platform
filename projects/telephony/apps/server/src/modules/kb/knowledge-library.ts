/*
 * 中文导读：知识库：knowledge-library.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type Scope, type CrmDb, type Row } from '../crm/crm.service.js';
import { grants } from '../workspace/company-policy.js';
import { assertAgentUse, canTrain } from '../agent/agent.release.js';
import { playbookSchema, seedPlaybook } from '../agent/agent.playbook.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import { checkedKnowledgeText } from './knowledge-files.js';
import { markCandidateQuality } from './knowledge-lifecycle.js';

export const knowledgeHash = (s: string) => createHash('sha256').update(s).digest('hex');
export const normalizedKnowledge = (s: string) => s.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,c=>/[.%‰+\-/:<>=≤≥]/.test(c)?c:'').toLowerCase();
const categoryNames = ['公司业务','产品服务','合作条件','常见问答','异议处理','其他'];
const idSchema = z.string().min(1).max(200);
const categoryId = z.string().max(200).nullable().default(null);
const tags = z.array(z.string().trim().min(1).max(30)).max(12).default([]).transform(v => [...new Set(v)]);
export async function knowledgeAccess(s: Scope, action = 'read', db: CrmDb = crmDb) {
  const access = await memberAccess(db,s);
  if (!grants(access.permissions,'knowledgeSource',action)) throw new ForbiddenError('当前角色没有此知识库操作权限。');
  return access;
}
export async function writeKnowledge<T>(s: Scope, action: string, fn: (db: CrmDb) => Promise<T>) {
  return crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['company-policy:'+s.workspaceId]);
    await knowledgeAccess(s,action,db);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['knowledge-library:'+s.workspaceId]);
    await db.query('SELECT set_config(\'taigua.knowledge_actor\',$1,true) AS actor',[s.userId]);
    return fn(db);
  });
}
const write=writeKnowledge;
async function checkScope(db: CrmDb, s: Scope, agentId: string|null, category: string|null) {
  if (agentId && !(await db.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "deletionRequestedAt" IS NULL',[s.workspaceId,agentId])).length) throw new BadRequestError('请选择当前公司的数字员工。');
  if (category && !(await db.query('SELECT "id" FROM "WorkspaceKnowledgeCategory" WHERE "organizationId"=$1 AND "id"=$2',[s.workspaceId,category])).length) throw new BadRequestError('分类已变化，请刷新后选择。');
}
export async function knowledgeCategories(s: Scope, db: CrmDb = crmDb) {
  return db.query('SELECT "id","name" FROM "WorkspaceKnowledgeCategory" WHERE "organizationId"=$1 ORDER BY "createdAt","name"',[s.workspaceId]);
}
export async function saveKnowledgeCategory(s: Scope, id: string, input: unknown) {
  const {name} = z.object({name:z.string().trim().min(1).max(30)}).strict().parse(input);
  return write(s,'update',async db => {
    if ((await knowledgeCategories(s,db)).some(c=>c.name===name&&c.id!==id)) throw new BadRequestError('已有同名分类。');
    if (id==='new') {
      if ((await knowledgeCategories(s,db)).length>=50) throw new BadRequestError('最多创建50个分类。');
      id=randomUUID();
      await db.query('INSERT INTO "WorkspaceKnowledgeCategory" ("id","organizationId","name") VALUES ($1,$2,$3) RETURNING "id"',[id,s.workspaceId,name]);
    } else if (!(await db.query('UPDATE "WorkspaceKnowledgeCategory" SET "name"=$3 WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,idSchema.parse(id),name])).length) throw new BadRequestError('分类不存在。');
    return {id};
  });
}
export async function removeKnowledgeCategory(s: Scope, id: string) {
  return write(s,'delete',async db => {
    for (const table of ['WorkspaceKnowledge','WorkspaceKnowledgeDocument']) await db.query(`UPDATE "${table}" SET "categoryId"=NULL,"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "categoryId"=$2 RETURNING "id"`,[s.workspaceId,id]);
    await db.query('DELETE FROM "WorkspaceKnowledgeCategory" WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,id]);
    return {removed:true};
  });
}

// Sources are views of existing material. Reading the library never copies or rewrites a live script.
async function knowledgeSources(s: Scope, trash=false, db:CrmDb=crmDb) {
  const access=await knowledgeAccess(s,'read',db), draft=canTrain(access.permissions);
  const [agents,categories]=await Promise.all([
    db.query(`SELECT a."agentId",a."name",a."isActive",c."conversationPlaybook",c."firstMessage",c."systemPrompt",c."update_at" AS "updatedAt",r."snapshot",r."createdAt" AS "publishedAt" FROM "Agent" a LEFT JOIN "AgentConfiguration" c ON c."agentId"=a."agentId" LEFT JOIN "AgentDeployment" d ON d."workspaceId"=a."organizationId" AND d."agentId"=a."agentId" LEFT JOIN "AgentRelease" r ON r."id"=d."releaseId" WHERE a."organizationId"=$1 AND a."deletionRequestedAt" IS NULL ORDER BY a."createdAt"`,[s.workspaceId]),
    knowledgeCategories(s,db),
  ]);
  const sources: Row[]=[];
  function add(ref:string,title:string,content:string,agentId:string|null,categoryName:string,sourceLink:string,updatedAt:unknown,sourceKind='AGENT',organizable=true) {
    if (!content.trim()) return;
    sources.push({id:ref,kind:'source',title,content,agentId,categoryId:categories.find(c=>c.name===categoryName)?.id||null,categoryName,tags:[],enabled:true,status:'SOURCE',sourceKind,sourceLink,updatedAt,contentHash:knowledgeHash(content),organizable});
  }
  for (const a of agents) {
    if(!access.isSystemAdmin&&!a.isActive)continue;
    if (!draft) { try { await assertAgentUse(s,a.agentId); } catch { continue; } }
    const parsed=playbookSchema.safeParse(draft?a.conversationPlaybook:a.snapshot?.playbook);
    const p=parsed.success?parsed.data:draft?seedPlaybook(a.firstMessage||'',a.systemPrompt||'',a.name):null;
    if (!p) continue;
    const link='/agents/'+a.agentId+'?tab=behavior',when=draft?a.updatedAt:a.publishedAt;
    add('agent:'+a.agentId+':business',a.name+' / 业务资料',[p.identity,p.purpose,p.baseInstructions].filter(Boolean).join('\n\n'),a.agentId,'公司业务',link,when);
    add('agent:'+a.agentId+':faq',a.name+' / 常见问答',p.faq.map(f=>'问：'+f.question+'\n答：'+f.answer).join('\n\n'),a.agentId,'常见问答',link,when);
    add('agent:'+a.agentId+':objections',a.name+' / 异议处理',p.objections.map(o=>'客户：'+o.trigger+'\n回应：'+o.response).join('\n\n'),a.agentId,'异议处理',link,when);
  }
  if (grants(access.permissions,'knowledgeSource','update')) {
    const [recordings,legacy,cloud]=await Promise.all([
      db.query(`SELECT r."id",r."agentId",r."name",r."analysis",r."updatedAt" FROM "AgentLearningRecording" r WHERE r."workspaceId"=$1 AND r."deletedAt" IS NULL AND r."analysis"->>'reviewedAt' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "WorkspaceKnowledgeDocument" d WHERE d."organizationId"=r."workspaceId" AND d."sourceRef"='recording:'||r."id") ORDER BY r."updatedAt" DESC LIMIT 100`,[s.workspaceId]),
      db.query('SELECT "kbId","name","agentId","originalFileName","status","uploadedAt" FROM "KnowledgeSource" WHERE "organizationId"=$1 ORDER BY "uploadedAt" DESC LIMIT 150',[s.workspaceId]),
      db.query(`SELECT "settings"->>'approvedKnowledge' AS content,"updatedAt" FROM "AliyunConnection" WHERE "organizationId"=$1`,[s.workspaceId]),
    ]);
    for (const r of recordings) {
      const a=r.analysis||{};
      const content=[a.summary,...(a.faqs||[]).map((f:Row)=>'问：'+f.question+'\n答：'+f.answer),...(a.objections||[]).map((o:Row)=>'客户：'+o.trigger+'\n回应：'+o.response)].filter(Boolean).join('\n\n');
      add('recording:'+r.id,r.name+' / 已审核整理',content,r.agentId,'其他','/kb/recordings/'+encodeURIComponent(r.agentId)+'/'+encodeURIComponent(r.id),r.updatedAt,'RECORDING');
    }
    for(const r of legacy) add('legacy:'+r.kbId,r.name,'文件：'+(r.originalFileName||r.name)+'\n此资料沿用原文件登记。',r.agentId,'其他',r.agentId?'/agents/'+r.agentId+'?tab=knowledge':'/kb',r.uploadedAt,'LEGACY',false);
    if(cloud[0]?.content) add('cloud:approved','已确认业务知识',cloud[0].content,null,'公司业务','/settings/telephony',cloud[0].updatedAt,'BUSINESS');
  }
  const prepared=await db.query('SELECT "sourceRef","contentHash" FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "deletedAt" IS NULL',[s.workspaceId]);
  const overrides=await db.query('SELECT * FROM "KnowledgeSourceOverride" WHERE "organizationId"=$1',[s.workspaceId]);
  const combined=sources.map(source=>{
    const old=overrides.find(r=>r.sourceRef===source.id),originStamp=source.contentHash;
    return {...source,...old?.payload,id:source.id,kind:'source',editable:grants(access.permissions,'knowledgeSource','update'),revision:old?.revision||1,originStamp,originalTitle:source.title,upstreamChanged:!!old&&old.originHash!==originStamp,deletedAt:old?.deletedAt||null,updatedAt:old?.updatedAt||source.updatedAt,contentHash:knowledgeHash(old?.payload.content??source.content)};
  }).filter(source=>source.deletedAt||!prepared.some(p=>p.sourceRef===source.id&&p.contentHash===source.contentHash));
  if(trash&&grants(access.permissions,'knowledgeSource','update'))for(const old of overrides.filter(o=>o.deletedAt&&!combined.some(c=>c.id===o.sourceRef)))combined.push({...old.payload,id:old.sourceRef,kind:'source',editable:true,revision:old.revision,originStamp:old.originHash,originalTitle:old.payload.title,upstreamChanged:false,deletedAt:old.deletedAt,updatedAt:old.updatedAt,contentHash:knowledgeHash(old.payload.content||'')});
  return combined.filter(source=>trash?!!source.deletedAt:!source.deletedAt);

}
const meta=(r:Row)=>({editable:r.editable,originStamp:r.originStamp,originalTitle:r.originalTitle,upstreamChanged:r.upstreamChanged,id:r.id,kind:r.kind,title:r.title||r.name,agentId:r.agentId,categoryId:r.categoryId,tags:r.tags||[],enabled:r.enabled!==false,status:r.status||(r.validUntil&&new Date(r.validUntil).getTime()<=Date.now()?'EXPIRED':r.enabled?'ENABLED':'DISABLED'),updatedAt:r.updatedAt,deletedAt:r.deletedAt,revision:r.revision,sourceKind:r.sourceKind,sourceLink:r.sourceLink,sourceTitle:r.sourceTitle,validUntil:r.validUntil,contentHash:r.contentHash,organizable:r.organizable!==false,characters:r.content?.length||0,preview:(r.content||'').replace(/\s+/g,' ').slice(0,140)});
async function readableAgentIds(s:Scope) {
  const rows=await crmDb.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "deletionRequestedAt" IS NULL',[s.workspaceId]);
  const allowed:string[]=[];for(const row of rows)try{await assertAgentUse(s,row.agentId);allowed.push(row.agentId);}catch{}
  return allowed;
}
export async function listKnowledgeNotes(s:Scope) {
  const access=await knowledgeAccess(s),manage=grants(access.permissions,'knowledgeSource','update');
  const allowed=manage?[]:await readableAgentIds(s);
  return crmDb.query(`SELECT * FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "deletedAt" IS NULL AND ($2 OR "enabled"=true AND ("validUntil" IS NULL OR "validUntil">NOW()) AND ("agentId" IS NULL OR "agentId"=ANY($3::text[]))) ORDER BY "updatedAt" DESC`,[s.workspaceId,manage,allowed]);
}
export async function knowledgeLibrary(s:Scope, trash=false, search='') {
  const term=z.string().trim().max(100).parse(search).toLowerCase();
  const access=await knowledgeAccess(s),manage=grants(access.permissions,'knowledgeSource','update');
  if(trash&&!manage)throw new ForbiddenError('回收站由知识库负责人管理。');
  const [categories,notes,documents,sources]=await Promise.all([
    knowledgeCategories(s),trash?crmDb.query('SELECT * FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "deletedAt" IS NOT NULL ORDER BY "updatedAt" DESC',[s.workspaceId]):listKnowledgeNotes(s),
    manage?crmDb.query(`SELECT "id","name","agentId","categoryId","status","sourceKind","revision","updatedAt","deletedAt",length("content") AS characters,left("content",140) AS preview FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "deletedAt" IS ${trash?'NOT ':''}NULL AND ($2='' OR position($2 in lower("name"||' '||"content"))>0) ORDER BY "updatedAt" DESC`,[s.workspaceId,term]):Promise.resolve([]),
    knowledgeSources(s,trash),
  ]);
  return {canManage:manage,canDelete:grants(access.permissions,'knowledgeSource','delete'),categories,items:[...notes.filter(n=>!term||[n.title,n.content,...n.tags].join(' ').toLowerCase().includes(term)).map(n=>meta({...n,kind:'note'})),...documents.map(d=>({...d,kind:'document',title:d.name,tags:[]})),...sources.filter(n=>!term||(n.title+' '+n.content).toLowerCase().includes(term)).map(meta)]};
}
export async function knowledgeItem(s:Scope,kind:string,id:string,trash=false):Promise<Row> {
  await knowledgeAccess(s);
  if(kind==='source') {
    const source=(await knowledgeSources(s,trash)).find(r=>r.id===id);
    if(!source)throw new BadRequestError('资料不存在或未授权。');return source;
  }
  if(kind==='note'&&!trash) {
    const note=(await listKnowledgeNotes(s)).find(n=>n.id===id);
    if(!note)throw new BadRequestError('知识不存在或未授权。');return {...note,kind};
  }
  await knowledgeAccess(s,'update');
  const table=kind==='document'?'WorkspaceKnowledgeDocument':kind==='note'?'WorkspaceKnowledge':null;
  if(!table)throw new BadRequestError('资料类型不正确。');
  const rows=await crmDb.query(`SELECT * FROM "${table}" WHERE "organizationId"=$1 AND "id"=$2 AND "deletedAt" IS ${trash?'NOT ':''}NULL`,[s.workspaceId,idSchema.parse(id)]);
  const row=rows[0];if(!row)throw new BadRequestError('资料不存在或已变化。');
  delete row.fileData;return {...row,kind,title:row.title||row.name};
}
const validUntil=z.string().datetime().nullable().default(null);
const noteSchema=z.object({title:z.string().trim().min(1).max(100),content:z.string().trim().min(1).max(30000),agentId:z.string().min(1).max(200).nullable(),enabled:z.boolean(),categoryId,tags,validUntil,revision:z.number().int().positive().optional()}).strict();
export async function saveKnowledgeNote(s:Scope,id:string,input:unknown) {
  const data=noteSchema.parse(input);
  if(data.enabled&&data.validUntil&&Date.parse(data.validUntil)<=Date.now())throw new BadRequestError('有效期已过，请调整日期或停用此知识。');
  return write(s,'update',async db=>{
    await checkScope(db,s,data.agentId,data.categoryId);
    if(id==='new') {
      const count=(await db.query('SELECT count(*)::int AS n FROM "WorkspaceKnowledge" WHERE "organizationId"=$1',[s.workspaceId]))[0]?.n||0;
      if(count>=1000)throw new BadRequestError('知识条目已达到1000条，请联系技术人员整理。');
      id=randomUUID();await db.query('INSERT INTO "WorkspaceKnowledge" ("id","organizationId","agentId","title","content","enabled","categoryId","tags","validUntil") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::timestamptz) RETURNING "id"',[id,s.workspaceId,data.agentId,data.title,data.content,data.enabled,data.categoryId,data.tags,data.validUntil]);
    } else {
      if(!data.revision)throw new BadRequestError('请刷新知识条目后再保存。');
      if(!(await db.query('UPDATE "WorkspaceKnowledge" SET "title"=$3,"content"=$4,"agentId"=$5,"enabled"=$6,"categoryId"=$7,"tags"=$8::text[],"validUntil"=$10::timestamptz,"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$9 AND "deletedAt" IS NULL RETURNING "id"',[s.workspaceId,idSchema.parse(id),data.title,data.content,data.agentId,data.enabled,data.categoryId,data.tags,data.revision,data.validUntil])).length)throw new BadRequestError('此知识已被修改或删除，请刷新后再编辑。');
    }
    return {saved:true,id};
  });
}
export async function saveKnowledgeDocument(s:Scope,input:unknown,file?:{name:string;bytes:Buffer}) {
  const data=z.object({name:z.string().trim().min(1).max(160),content:z.string().min(1).max(60000),agentId:z.string().max(200).nullable(),categoryId,sourceKind:z.enum(['TEXT','FILE','AGENT','RECORDING','BUSINESS']).default('TEXT'),sourceRef:z.string().max(200).optional()}).strict().parse(input);
  const content=checkedKnowledgeText(data.content),hash=knowledgeHash(content);
  return write(s,'update',async db=>{
    await checkScope(db,s,data.agentId,data.categoryId);
    const ref=data.sourceRef||'upload:'+hash;
    const prior=(await db.query('SELECT "id","deletedAt" FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "sourceRef"=$2 AND "contentHash"=$3',[s.workspaceId,ref,hash]))[0];
    if(prior){if(prior.deletedAt)throw new BadRequestError('相同资料已在回收站，请先恢复。');return {id:prior.id,duplicate:true};}
    const size=(await db.query('SELECT count(*)::int AS n,COALESCE(sum(COALESCE(octet_length("fileData"),0)+octet_length("content")),0)::bigint AS bytes FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1',[s.workspaceId]))[0];
    if(Number(size?.n)>=150||Number(size?.bytes)+(file?.bytes.length||0)+Buffer.byteLength(content)>200*1024*1024)throw new BadRequestError('资料库已达到150份或200MB上限，请联系技术人员整理。');
    const id=randomUUID();
    await db.query('INSERT INTO "WorkspaceKnowledgeDocument" ("id","organizationId","agentId","categoryId","createdBy","name","content","contentHash","sourceKind","sourceRef","fileName","fileData") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING "id"',[id,s.workspaceId,data.agentId,data.categoryId,s.userId,data.name,content,hash,data.sourceKind,ref,file?.name||null,file?.bytes||null]);
    return {id,duplicate:false};
  });
}
export async function changeKnowledgeDocument(s:Scope,id:string,input:unknown) {
  const data=z.object({name:z.string().trim().min(1).max(160),agentId:z.string().max(200).nullable(),categoryId,revision:z.number().int().positive()}).strict().parse(input);
  return write(s,'update',async db=>{
    await checkScope(db,s,data.agentId,data.categoryId);
    const previous=(await db.query('SELECT "agentId","categoryId" FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$3 AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,id,data.revision]))[0];
    if(!previous)throw new BadRequestError('资料已变化，请刷新后操作。');
    const changed=await db.query(`UPDATE "WorkspaceKnowledgeDocument" SET "name"=$3,"agentId"=$4,"categoryId"=$5,"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$6 AND "deletedAt" IS NULL AND "status" NOT IN ('QUEUED','PROCESSING') RETURNING "id"`,[s.workspaceId,id,data.name,data.agentId,data.categoryId,data.revision]);
    if(!changed.length)throw new BadRequestError('资料已变化或正在整理，请刷新后操作。');
    if(previous.agentId!==data.agentId||previous.categoryId!==data.categoryId)await db.query('UPDATE "WorkspaceKnowledge" SET "agentId"=CASE WHEN "agentId" IS NOT DISTINCT FROM $3::text THEN $4::text ELSE "agentId" END,"categoryId"=CASE WHEN "categoryId" IS NOT DISTINCT FROM $5::text THEN $6::text ELSE "categoryId" END,"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "documentId"=$2 AND ("agentId" IS NOT DISTINCT FROM $3::text OR "categoryId" IS NOT DISTINCT FROM $5::text) RETURNING "id"',[s.workspaceId,id,previous.agentId,data.agentId,previous.categoryId,data.categoryId]);
    return {saved:true};
  });
}
export async function recycleKnowledge(s:Scope,kind:string,id:string,revision:number,restore=false,originStamp?:string) {
  if(kind==='source')return recycleKnowledgeSource(s,id,revision,restore,originStamp);
  const table=kind==='note'?'WorkspaceKnowledge':kind==='document'?'WorkspaceKnowledgeDocument':null;
  if(!table)throw new BadRequestError('现有话术资料请在原入口维护。');
  return write(s,restore?'update':'delete',async db=>{
    const changed=await db.query(`UPDATE "${table}" SET "deletedAt"=${restore?'NULL':'NOW()'},"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$3 AND "deletedAt" IS ${restore?'NOT ':''}NULL ${kind==='document'?`AND "status" NOT IN ('QUEUED','PROCESSING')`:''} RETURNING "id"`,[s.workspaceId,id,revision]);
    if(!changed.length)throw new BadRequestError('条目已变化或正在整理，请刷新后操作。');return {saved:true};
  });
}
export const candidateSchema=z.object({id:z.string().max(100),title:z.string().trim().min(1).max(100),content:z.string().trim().min(1).max(4000),category:z.string().max(30),tags,quote:z.string().min(2).max(1800),needsConfirmation:z.boolean().default(false),requiresExpiry:z.boolean().default(false)}).strict();
export const analysisSchema=z.object({summary:z.string().max(1500),keywords:z.array(z.string().max(30)).max(20),removed:z.array(z.string().max(150)).max(20),warnings:z.array(z.string().max(300)).max(20),candidates:z.array(candidateSchema).max(60)}).strict();
export async function reviewKnowledge(s:Scope,id:string,input:unknown) {
  const data=z.object({revision:z.number().int().positive(),entries:z.array(candidateSchema.extend({categoryId,confirmed:z.boolean().default(false),validUntil})).max(60)}).strict().parse(input);
  const result=await write(s,'update',async db=>{
    const doc=(await db.query(`SELECT * FROM "WorkspaceKnowledgeDocument" WHERE "organizationId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "status"='REVIEW' AND "revision"=$3 FOR UPDATE`,[s.workspaceId,id,data.revision]))[0];
    if(!doc)throw new BadRequestError('整理结果已变化，请刷新后审核。');
    const analysis=analysisSchema.parse(doc.analysis),existing=await db.query('SELECT "content" FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "agentId" IS NOT DISTINCT FROM $2 AND "deletedAt" IS NULL',[s.workspaceId,doc.agentId]);
    const checked=data.entries.map(e=>({...e}));await markCandidateQuality(s.workspaceId,doc.agentId,checked);
    if(checked.some(e=>e.needsConfirmation&&!e.confirmed))throw new BadRequestError('知识可能与现有资料冲突，请核实内容并勾选“已核实业务内容”后发布。');
    const seen=new Set(existing.map(n=>normalizedKnowledge(n.content))),chosen=new Set<string>();let inserted=0,duplicates=0;
    const total=(await db.query('SELECT count(*)::int AS n FROM "WorkspaceKnowledge" WHERE "organizationId"=$1',[s.workspaceId]))[0]?.n||0;
    if(total+data.entries.length>1000)throw new BadRequestError('知识条目达到上限，请先整理。');
    for(const entry of checked) {
      const original=analysis.candidates.find(c=>c.id===entry.id);
      if(!original||(original.needsConfirmation&&!entry.confirmed)||((original.requiresExpiry||entry.requiresExpiry)&&!entry.validUntil)||(entry.validUntil&&Date.parse(entry.validUntil)<=Date.now())||chosen.has(entry.id)||entry.quote!==original.quote||!normalizedKnowledge(doc.content).includes(normalizedKnowledge(entry.quote)))throw new BadRequestError('所选知识缺少可靠依据或仍需确认，请核对整理结果。');
      if((original.requiresExpiry||entry.requiresExpiry)&&/(今晚|今天|明天|明晚|后天|本周|这周|下周|本月|下个月)/.test(entry.content))throw new BadRequestError('请把临时时间改成明确日期，再设置有效期。');
      chosen.add(entry.id);await checkScope(db,s,doc.agentId,entry.categoryId);
      const key=normalizedKnowledge(entry.content);if(seen.has(key)){duplicates++;continue;}seen.add(key);
      await db.query('INSERT INTO "WorkspaceKnowledge" ("id","organizationId","agentId","title","content","enabled","categoryId","tags","sourceTitle","sourceQuote","documentId","validUntil") VALUES ($1,$2,$3,$4,$5,true,$6,$7::text[],$8,$9,$10,$11::timestamptz) RETURNING "id"',[randomUUID(),s.workspaceId,doc.agentId,entry.title,entry.content,entry.categoryId,entry.tags,doc.name,entry.quote,doc.id,entry.validUntil]);inserted++;
    }
    await db.query(`UPDATE "WorkspaceKnowledgeDocument" SET "status"='COMPLETED',"analysis"=$3::jsonb,"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"`,[s.workspaceId,id,JSON.stringify({...analysis,reviewedEntries:data.entries,acceptedIds:[...chosen],inserted,duplicates,reviewedBy:s.userId,reviewedAt:new Date().toISOString()})]);
    return {inserted,duplicates};
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'knowledge.reviewed',resourceType:'knowledgeSource',resourceId:id,metadata:result});return result;
}
export async function snapshotKnowledgeSource(s:Scope,id:string,expectedHash:string) {
  await knowledgeAccess(s,'update');
  const source=await knowledgeItem(s,'source',id);
  if(source.organizable===false||source.contentHash!==expectedHash)throw new BadRequestError('原资料已变化或不能直接整理，请重新打开。');
  return saveKnowledgeDocument(s,{name:source.title,content:source.content,agentId:source.agentId,categoryId:source.categoryId,sourceKind:source.sourceKind,sourceRef:id});
}
export { categoryNames };

export async function changeKnowledgeSource(s:Scope,id:string,input:unknown){
 const data=noteSchema.omit({content:true}).extend({content:z.string().trim().min(1).max(60000).optional(),originStamp:z.string().length(64)}).strict().parse(input);
 return write(s,'update',async db=>{
  const source=(await knowledgeSources(s,false,db)).find(r=>r.id===id);
  if(!source||source.revision!==data.revision||source.originStamp!==data.originStamp)throw new BadRequestError('原资料已变化，请刷新后编辑。');
  await checkScope(db,s,data.agentId,data.categoryId);
  const payload={...source,...data,content:source.organizable===false?source.content:data.content??source.content};delete payload.originStamp;
  await db.query('INSERT INTO "KnowledgeSourceOverride"("organizationId","sourceRef","payload","revision","originHash") VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT ("organizationId","sourceRef") DO UPDATE SET "payload"=EXCLUDED."payload","revision"=EXCLUDED."revision","originHash"=EXCLUDED."originHash","updatedAt"=NOW() RETURNING "sourceRef"',[s.workspaceId,id,JSON.stringify(payload),source.revision+1,source.originStamp]);
  return {saved:true,id};
 });
}
async function recycleKnowledgeSource(s:Scope,id:string,revision:number,restore:boolean,originStamp?:string){
 return write(s,restore?'update':'delete',async db=>{
  const source=(await knowledgeSources(s,restore,db)).find(r=>r.id===id);
  if(!source||source.revision!==revision||source.originStamp!==originStamp)throw new BadRequestError('资料已变化，请刷新后操作。');
  await db.query('INSERT INTO "KnowledgeSourceOverride"("organizationId","sourceRef","payload","revision","originHash","deletedAt") VALUES ($1,$2,$3::jsonb,$4,$5,$6::timestamptz) ON CONFLICT ("organizationId","sourceRef") DO UPDATE SET "payload"=EXCLUDED."payload","revision"=EXCLUDED."revision","deletedAt"=EXCLUDED."deletedAt","updatedAt"=NOW() RETURNING "sourceRef"',[s.workspaceId,id,JSON.stringify(source),revision+1,source.originStamp,restore?null:new Date().toISOString()]);
  return {saved:true};
 });
}
