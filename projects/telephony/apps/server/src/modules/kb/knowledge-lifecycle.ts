/*
 * 中文导读：知识库：knowledge-lifecycle.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {crmDb} from '../crm/crm.db.js';
import type {Scope,Row} from '../crm/crm.service.js';
import {assertAgentUse} from '../agent/agent.release.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {knowledgeAccess,knowledgeLibrary,knowledgeItem,saveKnowledgeNote,snapshotKnowledgeSource,writeKnowledge,normalizedKnowledge} from './knowledge-library.js';
import {queueKnowledgeAnalysis,knowledgeAnalysisCapability} from './knowledge-analysis.js';
import {retrieveKnowledge} from './knowledge-retrieval.js';
import {embeddingModel,semanticConnection} from './knowledge-semantic.js';

const id=z.string().min(1).max(200);
function grams(text:string){const s=normalizedKnowledge(text).slice(0,3500),out=new Set<string>();for(let i=0;i<s.length-2;i++)out.add(s.slice(i,i+3));return out;}
export function similarity(a:string,b:string){const x=grams(a),y=grams(b);if(!x.size||!y.size)return 0;let n=0;for(const k of x)if(y.has(k))n++;return n/(x.size+y.size-n);}
function facts(text:string){return {numbers:(text.normalize('NFKC').match(/\d+(?:\.\d+)?(?:[%元年月日天次个小时分钟]|万元|美元)?/g)||[]).sort().join('|'),negative:/不支持|不能|不提供|没有|不含|不包含|不可|禁止|不保证/.test(text)};}
export function possibleConflict(a:Row,b:Row){
 const sameTitle=normalizedKnowledge(a.title)===normalizedKnowledge(b.title),related=similarity(a.content,b.content)>=0.65;if(!sameTitle&&!related)return false;
 const x=facts(a.content),y=facts(b.content);return (x.numbers!==y.numbers&&!!(x.numbers||y.numbers))||x.negative!==y.negative;
}
export async function markCandidateQuality(org:string,agentId:string|null,candidates:Row[]){
 const existing=await crmDb.query('SELECT "title","content","agentId" FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "deletedAt" IS NULL AND ("agentId" IS NULL OR $2::text IS NULL OR "agentId"=$2) ORDER BY "id" LIMIT 1000',[org,agentId]);
 const warnings:string[]=[];for(const candidate of candidates){const conflict=existing.find(n=>possibleConflict(candidate,n));if(conflict){candidate.needsConfirmation=true;warnings.push('“'+candidate.title+'”与现有知识“'+conflict.title+'”的数字或条件可能冲突，请核实后发布。');}if(/今晚|今天|明天|明晚|后天|本周|这周|下周|本月|下个月/.test(candidate.content)){candidate.requiresExpiry=true;candidate.needsConfirmation=true;warnings.push('“'+candidate.title+'”含临时时间，请改成明确日期并设置有效期。');}}
 return warnings;
}
export async function importExistingSources(s:Scope,input:unknown){
 const data=z.object({items:z.array(z.object({id,contentHash:z.string().length(64)}).strict()).min(1).max(40),analyze:z.boolean().default(true)}).strict().parse(input);await knowledgeAccess(s,'update');
 const results:Row[]=[];for(const item of data.items){try{const source=await knowledgeItem(s,'source',item.id);if(data.analyze&&!(await knowledgeAnalysisCapability(s,source.agentId)).available)throw new BadRequestError('资料整理模型尚未配置。');const saved=await snapshotKnowledgeSource(s,item.id,item.contentHash);const document=await knowledgeItem(s,'document',saved.id);if(data.analyze&&document.status==='AVAILABLE')await queueKnowledgeAnalysis(s,saved.id,{revision:document.revision});results.push({id:saved.id,title:source.title,duplicate:saved.duplicate,status:data.analyze?'QUEUED':document.status});}catch(e){results.push({sourceId:item.id,error:e instanceof BadRequestError?e.message:'导入未完成，请刷新后核对。'});}}
 return {results,imported:results.filter(r=>!r.error&&!r.duplicate).length,failed:results.filter(r=>r.error).length};
}
export async function retrievalPreview(s:Scope,agentId:string|null,question:string){
 await knowledgeAccess(s);if(agentId)await assertAgentUse(s,agentId);
 return retrieveKnowledge(s.workspaceId,agentId,z.string().trim().min(2).max(1200).parse(question),{channel:'PREVIEW'});
}
export async function knowledgeHealth(s:Scope){
 await knowledgeAccess(s,'update');const org=s.workspaceId;
 const [jobs,settings,connection,notes,sourceLibrary,gapCount,usage]=await Promise.all([
  crmDb.query('SELECT "status",count(*)::int AS count FROM "KnowledgeIndexJob" WHERE "organizationId"=$1 GROUP BY "status"',[org]),
  crmDb.query('SELECT "semanticEnabled" FROM "KnowledgeRetrievalSettings" WHERE "organizationId"=$1',[org]),semanticConnection(org).catch(()=>null),
  crmDb.query('SELECT "id","title","content","agentId","enabled","validUntil","sourceTitle","updatedAt","revision" FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "deletedAt" IS NULL ORDER BY "updatedAt" DESC LIMIT 1000',[org]),
  knowledgeLibrary(s),crmDb.query('SELECT count(*)::int AS count FROM "KnowledgeGap" WHERE "organizationId"=$1 AND "status"=\'OPEN\'',[org]),
  crmDb.query('SELECT count(*)::int AS total,count(*) FILTER (WHERE "matched")::int AS matched FROM "KnowledgeRetrievalLog" WHERE "organizationId"=$1 AND "channel" IN (\'SIP\',\'ALIYUN\') AND "createdAt">NOW()-INTERVAL \'30 days\'',[org]),
 ]);
 const exact=new Map<string,Row[]>(),pairs:Row[]=[],compared=new Set<string>(),buckets=new Map<string,Row[]>();
 for(const n of notes){const key=(n.agentId||'shared')+':'+n.enabled+':'+(n.validUntil?new Date(n.validUntil).toISOString():'')+':'+normalizedKnowledge(n.content);const same=exact.get(key)||[];same.push(n);exact.set(key,same);const keys=[...new Set([normalizedKnowledge(n.title),...Array.from(grams(n.content)).filter((_,i)=>i%25===0).slice(0,12)])];const candidates=new Map<string,Row>();for(const k of keys)for(const p of buckets.get(k)||[])candidates.set(p.id,p);for(const p of [...candidates.values()].slice(-40)){if(p.agentId&&n.agentId&&p.agentId!==n.agentId)continue;const pair=[n.id,p.id].sort().join(':');if(compared.has(pair))continue;compared.add(pair);if(possibleConflict(n,p))pairs.push({id:n.id,title:n.title,otherId:p.id,otherTitle:p.title});}for(const k of keys){const list=buckets.get(k)||[];list.push(n);buckets.set(k,list.slice(-40));}}
 return {canMerge:sourceLibrary.canDelete,semanticEnabled:settings[0]?.semanticEnabled!==false,configured:!!connection,model:embeddingModel,index:jobs,active:notes.filter(n=>n.enabled&&(!n.validUntil||new Date(n.validUntil).getTime()>Date.now())).length,pendingSources:(sourceLibrary.items as Row[]).filter(n=>n.kind==='source'&&n.organizable!==false),duplicates:[...exact.values()].filter(g=>g.length>1).map(g=>g.map(n=>({id:n.id,title:n.title,agentId:n.agentId,revision:n.revision}))),conflicts:pairs.slice(0,100),expired:notes.filter(n=>n.enabled&&n.validUntil&&new Date(n.validUntil).getTime()<=Date.now()).map(n=>({id:n.id,title:n.title})),missingSource:notes.filter(n=>!n.sourceTitle).map(n=>({id:n.id,title:n.title})),gaps:gapCount[0]?.count||0,liveRetrievals:usage[0]||{total:0,matched:0}};
}
export async function setSemanticSettings(s:Scope,input:unknown){
 const data=z.object({enabled:z.boolean()}).strict().parse(input);return writeKnowledge(s,'update',async db=>{await db.query('INSERT INTO "KnowledgeRetrievalSettings" ("organizationId","semanticEnabled") VALUES ($1,$2) ON CONFLICT ("organizationId") DO UPDATE SET "semanticEnabled"=EXCLUDED."semanticEnabled","updatedAt"=NOW() RETURNING "organizationId"',[s.workspaceId,data.enabled]);return {saved:true};});
}
export async function retryKnowledgeIndex(s:Scope){return writeKnowledge(s,'update',async db=>{const rows=await db.query('UPDATE "KnowledgeIndexJob" SET "status"=\'PENDING\',"error"=\'\',"attemptId"=NULL,"leaseUntil"=NULL,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "status"=\'ERROR\' RETURNING "knowledgeId"',[s.workspaceId]);return {queued:rows.length};});}
export async function mergeDuplicateKnowledge(s:Scope,input:unknown){
 const data=z.object({targetId:id,items:z.array(z.object({id,revision:z.number().int().positive()}).strict()).min(2).max(30)}).strict().parse(input);await knowledgeAccess(s,'update');
 return writeKnowledge(s,'delete',async db=>{
  const ids=[...new Set(data.items.map(n=>n.id))];if(ids.length!==data.items.length||!ids.includes(data.targetId))throw new BadRequestError('请选择要保留的知识。');
  const rows=await db.query('SELECT * FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "id"=ANY($2::text[]) AND "deletedAt" IS NULL FOR UPDATE',[s.workspaceId,ids]);const target=rows.find(n=>n.id===data.targetId);
  if(!target||rows.length!==ids.length||rows.some(n=>n.revision!==data.items.find(v=>v.id===n.id)?.revision))throw new BadRequestError('条目已变化，请刷新后合并。');
  const until=(n:Row)=>n.validUntil?new Date(n.validUntil).toISOString():'';
  if(rows.some(n=>n.agentId!==target.agentId||n.enabled!==target.enabled||until(n)!==until(target)||normalizedKnowledge(n.content)!==normalizedKnowledge(target.content)))throw new BadRequestError('仅可合并内容、适用范围和有效期相同的知识。');
  await db.query('UPDATE "WorkspaceKnowledge" SET "tags"=$3::text[],"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,target.id,[...new Set(rows.flatMap(n=>n.tags||[]))].slice(0,12)]);
  await db.query('UPDATE "WorkspaceKnowledge" SET "deletedAt"=NOW(),"revision"="revision"+1,"updatedAt"=NOW() WHERE "organizationId"=$1 AND "id"=ANY($2::text[]) RETURNING "id"',[s.workspaceId,ids.filter(n=>n!==target.id)]);return {id:target.id,merged:rows.length-1};
 });
}
export async function knowledgeVersions(s:Scope,knowledgeId:string){await knowledgeAccess(s,'update');await knowledgeItem(s,'note',knowledgeId);return crmDb.query('SELECT "revision","actorId","createdAt","snapshot" FROM "KnowledgeRevision" WHERE "organizationId"=$1 AND "knowledgeId"=$2 ORDER BY "revision" DESC LIMIT 50',[s.workspaceId,knowledgeId]);}
export async function restoreKnowledgeVersion(s:Scope,knowledgeId:string,input:unknown){
 const data=z.object({revision:z.number().int().positive(),expectedRevision:z.number().int().positive()}).strict().parse(input);await knowledgeAccess(s,'update');const current=await knowledgeItem(s,'note',knowledgeId);if(current.revision!==data.expectedRevision)throw new BadRequestError('知识已被修改，请刷新后重试。');
 const row=(await crmDb.query('SELECT "snapshot" FROM "KnowledgeRevision" WHERE "organizationId"=$1 AND "knowledgeId"=$2 AND "revision"=$3',[s.workspaceId,knowledgeId,data.revision]))[0];if(!row)throw new BadRequestError('此版本不存在。');const n=row.snapshot;
 return saveKnowledgeNote(s,knowledgeId,{title:n.title,content:n.content,agentId:n.agentId,enabled:n.enabled&&(!n.validUntil||Date.parse(n.validUntil)>Date.now()),categoryId:n.categoryId,tags:n.tags,validUntil:n.validUntil,revision:current.revision});
}
export async function retrievalRecords(s:Scope,page:number,callId?:string){
 await knowledgeAccess(s,'update');const where='"organizationId"=$1'+(callId?' AND "callId"=$2':'');const args=callId?[s.workspaceId,callId]:[s.workspaceId];
 const [count,items]=await Promise.all([crmDb.query('SELECT count(*)::int AS total FROM "KnowledgeRetrievalLog" WHERE '+where,args),crmDb.query('SELECT * FROM "KnowledgeRetrievalLog" WHERE '+where+' ORDER BY "createdAt" DESC LIMIT 20 OFFSET $'+(args.length+1),[...args,(page-1)*20])]);return {total:count[0]?.total||0,items,page};
}
export async function knowledgeGaps(s:Scope,page:number,status:string){await knowledgeAccess(s,'update');const [count,items]=await Promise.all([crmDb.query('SELECT count(*)::int AS total FROM "KnowledgeGap" WHERE "organizationId"=$1 AND "status"=$2',[s.workspaceId,status]),crmDb.query('SELECT g.*,n."title" AS "knowledgeTitle" FROM "KnowledgeGap" g LEFT JOIN "WorkspaceKnowledge" n ON n."id"=g."knowledgeId" AND n."organizationId"=g."organizationId" WHERE g."organizationId"=$1 AND g."status"=$2 ORDER BY g."lastSeenAt" DESC LIMIT 20 OFFSET $3',[s.workspaceId,status,(page-1)*20])]);return {total:count[0]?.total||0,items,page};}
export async function updateKnowledgeGap(s:Scope,gapId:string,input:unknown){
 const data=z.object({revision:z.number().int().positive(),status:z.enum(['OPEN','IGNORED','RESOLVED']),knowledgeId:id.nullable().default(null)}).strict().parse(input);
 return writeKnowledge(s,'update',async db=>{
  const gap=(await db.query('SELECT * FROM "KnowledgeGap" WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$3 FOR UPDATE',[s.workspaceId,gapId,data.revision]))[0];if(!gap)throw new BadRequestError('问题记录已变化，请刷新后操作。');
  if(data.status==='RESOLVED'){const note=(await db.query('SELECT "id" FROM "WorkspaceKnowledge" WHERE "organizationId"=$1 AND "id"=$2 AND "enabled"=true AND "deletedAt" IS NULL AND ("validUntil" IS NULL OR "validUntil">NOW()) AND ("agentId" IS NULL OR "agentId"=$3)',[s.workspaceId,data.knowledgeId,gap.agentId]))[0];if(!note)throw new BadRequestError('请选择适用于该数字员工的已启用知识。');}
  await db.query('UPDATE "KnowledgeGap" SET "status"=$3,"knowledgeId"=$4,"resolvedBy"=$5,"resolvedAt"=CASE WHEN $3=\'OPEN\' THEN NULL ELSE NOW() END,"revision"="revision"+1 WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,gapId,data.status,data.knowledgeId,s.userId]);return {saved:true};
 });
}
export async function answerKnowledgeGap(s:Scope,gapId:string,input:unknown){
 const data=z.object({gapRevision:z.number().int().positive(),title:z.string().trim().min(1).max(100),content:z.string().trim().min(1).max(30000),agentId:id.nullable(),categoryId:id.nullable(),tags:z.array(z.string().trim().min(1).max(30)).max(12),enabled:z.literal(true),validUntil:z.string().datetime().nullable()}).strict().parse(input);
 if(data.validUntil&&Date.parse(data.validUntil)<=Date.now())throw new BadRequestError('有效期已过，请先调整。');
 return writeKnowledge(s,'update',async db=>{
  const gap=(await db.query('SELECT * FROM "KnowledgeGap" WHERE "organizationId"=$1 AND "id"=$2 AND "revision"=$3 FOR UPDATE',[s.workspaceId,gapId,data.gapRevision]))[0];if(!gap)throw new BadRequestError('问题记录已变化，请刷新后再补充。');
  if(data.agentId!==null&&data.agentId!==gap.agentId)throw new BadRequestError('知识必须适用于提出问题的数字员工，或设为企业共享。');
  if(data.agentId&&!(await db.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "deletionRequestedAt" IS NULL',[s.workspaceId,data.agentId])).length)throw new BadRequestError('数字员工不存在。');
  if(data.categoryId&&!(await db.query('SELECT "id" FROM "WorkspaceKnowledgeCategory" WHERE "organizationId"=$1 AND "id"=$2',[s.workspaceId,data.categoryId])).length)throw new BadRequestError('分类不存在。');
  if(Number((await db.query('SELECT count(*)::int AS n FROM "WorkspaceKnowledge" WHERE "organizationId"=$1',[s.workspaceId]))[0]?.n)>=1000)throw new BadRequestError('知识条目已达到上限。');
  const knowledgeId=randomUUID();await db.query('INSERT INTO "WorkspaceKnowledge" ("id","organizationId","agentId","categoryId","title","content","tags","enabled","validUntil","sourceTitle") VALUES ($1,$2,$3,$4,$5,$6,$7::text[],true,$8::timestamptz,\'管理员补充（通话问题）\') RETURNING "id"',[knowledgeId,s.workspaceId,data.agentId,data.categoryId,data.title,data.content,data.tags,data.validUntil]);
  await db.query('UPDATE "KnowledgeGap" SET "status"=\'RESOLVED\',"knowledgeId"=$3,"resolvedBy"=$4,"resolvedAt"=NOW(),"revision"="revision"+1 WHERE "organizationId"=$1 AND "id"=$2 RETURNING "id"',[s.workspaceId,gapId,knowledgeId,s.userId]);return {saved:true,id:knowledgeId};
 });
}
