/*
 * 中文导读：数字员工话术版本的发布、读取与权限控制。
 */
import {livestreamFreeContext} from './livestream-facts.js';
import {livestreamTimeContext} from './livestream-time.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {hasOpeningRecording} from './script-recording-schema.js';
import { validateHandoff } from './agent.handoff.js';
import { crmDb } from '../crm/crm.db.js';
import { type CrmDb, type Scope, type Row, memberAccess } from '../crm/crm.service.js';
import { grants } from '../workspace/company-policy.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { compilePlaybook, playbookSchema, seedPlaybook, playbookOpening, releasePlaybook, answeringAssistantInstructions, englishAnsweringAssistantInstructions } from './agent.playbook.js';
import { sipProfileSchema } from '../telephony/sip.schema.js';
import { resolvedVoice } from '../telephony/voices.service.js';
import { CALL_VOICE_MODEL } from '../telephony/voice-model-policy.js';

import { recordAuditEvent } from '../audit/audit-log.service.js';
import { naturalTelephoneRulesSection } from './agent.conversation.js';
import { telephoneVoiceDelivery, englishTelephoneVoiceDelivery } from './voice-delivery.js';
import { appendGeneratedInstructions, applyRuntimeVoice, runtimeVoiceBoundary } from './generated-instructions.js';
import { requireScriptManager } from './script-access.js';
import { demoInstructionsForCall } from '../telephony/demo-runtime.js';

const audienceSchema = z.object({ allEmployees: z.boolean(), userIds: z.array(z.string().min(1).max(100)).max(1000), departmentIds: z.array(z.string().uuid()).max(200) }).strict();
const publicAudience = { allEmployees: true, userIds: [], departmentIds: [] };
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,canonical(value)])) : v;
export const releaseDigest = (v: unknown) => {
  // Knowledge is reviewed independently and retrieved per turn. Older immutable
  // releases remain comparable without publishing a new script for every fact.
  const value=v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([key])=>key!=='knowledge'&&key!=='knowledgeText')):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
export const canTrain = (permissions: Record<string,string[]>) => grants(permissions,'agentConfiguration','update');
export const canPublish = (permissions: Record<string,string[]>) => grants(permissions,'agentConfiguration','publish');

// All providers read this same business snapshot; credentials and line settings are excluded.
async function source(db: CrmDb, workspaceId: string, agentId: string) {
  const a=(await db.query(`SELECT a."name",a."isActive",c."conversationPlaybook",c."firstMessage",c."systemPrompt",c."variables",c."communicationProfile",c."max_conversation_duration_seconds",c."store_call_audio" FROM "Agent" a LEFT JOIN "AgentConfiguration" c ON c."agentId"=a."agentId" WHERE a."organizationId"=$1 AND a."agentId"=$2 AND a."deletionRequestedAt" IS NULL`,[workspaceId,agentId]))[0];
  if(!a)throw new NotFoundError('数字员工不存在。');
  const [profiles,model,modelSettings]=await Promise.all([
    db.query('SELECT "profile" FROM "SipAgentProfile" WHERE "workspaceId"=$1 AND "agentId"=$2',[workspaceId,agentId]),
    db.query('SELECT "modelId" FROM "AgentModelSelection" WHERE "workspaceId"=$1 AND "agentId"=$2',[workspaceId,agentId]),
    db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]),
  ]);
  const parsed=playbookSchema.safeParse(a.conversationPlaybook);
  let playbook=parsed.success?parsed.data:seedPlaybook(a.firstMessage||'',a.systemPrompt||'',a.name);
  try { playbook=releasePlaybook(playbook); }
  catch(e) { throw new BadRequestError('请完善话术流程：'+(e instanceof z.ZodError?e.issues.slice(0,3).map(i=>i.message).join('；'):'画布内容无法发布')); }
  const placeholders=z.record(z.string(),z.string()).parse(a.variables?.placeholders||{});
  // The saved script owns the opening and reply voice as one identity. Older
  // profiles can retain a disabled voice after a new library voice is selected.
  const scriptVoiceId=playbook.recordingReplies?.voiceId;
  const rawProfile=sipProfileSchema.parse({...profiles[0]?.profile,...(scriptVoiceId?{voiceId:scriptVoiceId,realtimeModel:CALL_VOICE_MODEL,voice:''}:{})});
  const sound=await resolvedVoice(workspaceId,rawProfile,db);
  const profile={...rawProfile,realtimeModel:sound.model,voice:sound.voice};
  const snapshot={ agentName:a.name,playbook,placeholders,pageManagedSpeech:true,compiledPrompt:compilePlaybook(playbook),opening:playbookOpening(playbook),communication:a.communicationProfile||{},profile,textModelId:model[0]?.modelId||modelSettings[0]?.settings?.summaryModel||'',maxDurationSeconds:Math.min(900,Math.max(60,a.max_conversation_duration_seconds||300)),record:a.store_call_audio!==false };
  assertRuntimeSize(releaseRuntime(snapshot));
  return snapshot;
}
export async function assertAgentUse(s:Scope,agentId:string,db:CrmDb=crmDb) {
  const access=await memberAccess(db,s);
  if(!grants(access.permissions,'agent','read')||!grants(access.permissions,'outboundCalls','create'))throw new ForbiddenError('当前角色没有数字员工使用权限。');
  const row=(await db.query('SELECT d.*,a."isActive" FROM "AgentDeployment" d JOIN "Agent" a ON a."agentId"=d."agentId" AND a."organizationId"=d."workspaceId" WHERE d."workspaceId"=$1 AND d."agentId"=$2 AND a."deletionRequestedAt" IS NULL',[s.workspaceId,agentId]))[0];
  if(!row?.releaseId||!row.isActive)throw new BadRequestError('该数字员工尚未发布或已暂停，请联系负责人。');
  if(access.isSystemAdmin)return row;
  const audience=audienceSchema.parse(row.audience);
  if(audience.allEmployees||audience.userIds.includes(s.userId))return row;
  const units=await db.query(`WITH RECURSIVE ancestors AS (SELECT d."id",d."parentId" FROM "Member" m JOIN "CompanyDepartment" d ON d."id"=m."companyDepartmentId" AND d."organizationId"=m."organizationId" WHERE m."organizationId"=$1 AND m."userId"=$2 UNION SELECT d."id",d."parentId" FROM "CompanyDepartment" d JOIN ancestors p ON d."id"=p."parentId" WHERE d."organizationId"=$1) SELECT "id" FROM ancestors`,[s.workspaceId,s.userId]);
  if(units.some(u=>audience.departmentIds.includes(u.id)))return row;
  throw new ForbiddenError('该数字员工尚未授权给你或所属部门。');
}
export async function publishedRelease(s:Scope,agentId:string,db:CrmDb=crmDb) {
  const deployment=await assertAgentUse(s,agentId,db);
  const release=(await db.query('SELECT * FROM "AgentRelease" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3',[s.workspaceId,agentId,deployment.releaseId]))[0];
  if(!release)throw new BadRequestError('正式版本暂不可用，请联系负责人。');
  return release;
}
export async function releaseCatalog(s:Scope) {
  const access=await memberAccess(crmDb,s),manage=canTrain(access.permissions)||canPublish(access.permissions);
  const agents=await crmDb.query(`SELECT a."agentId",a."name",a."isActive",d."releaseId",d."audience",r."version",r."createdAt",r."sourceDigest",r."snapshot" FROM "Agent" a LEFT JOIN "AgentDeployment" d ON d."agentId"=a."agentId" AND d."workspaceId"=a."organizationId" LEFT JOIN "AgentRelease" r ON r."id"=d."releaseId" WHERE a."organizationId"=$1 AND a."deletionRequestedAt" IS NULL ORDER BY a."createdAt"`,[s.workspaceId]);
  const items=await Promise.all(agents.filter(a=>access.isSystemAdmin||manage||a.isActive).map(async a=>{
    let usable=false;try{await assertAgentUse(s,a.agentId);usable=true;}catch{}
    let draftDigest:string|undefined,draftError:string|undefined;
    if(manage)try{draftDigest=releaseDigest(await source(crmDb,s.workspaceId,a.agentId));}catch(e){draftError=e instanceof BadRequestError?e.message:'草稿配置需要完善，请检查话术和声音设置。';}
    return {agentId:a.agentId,name:a.name,isActive:a.isActive,version:a.version||null,publishedAt:a.createdAt||null,usable,...(manage?{audience:a.audience||publicAudience,draftDigest,draftError,hasUnpublishedChanges:!draftDigest||releaseDigest(a.snapshot)!==draftDigest}:{})};
  }));
  return {canTrain:canTrain(access.permissions),canPublish:canPublish(access.permissions),agents:items.filter(a=>access.isSystemAdmin||manage||a.usable)};
}
export async function releaseStatus(s:Scope,agentId:string) {
  const catalog=await releaseCatalog(s),item=catalog.agents.find(a=>a.agentId===agentId);
  if(!item)throw new NotFoundError('数字员工不存在或未授权。');
  const versions=catalog.canPublish||catalog.canTrain?await crmDb.query('SELECT "id","version","note","createdAt" FROM "AgentRelease" WHERE "workspaceId"=$1 AND "agentId"=$2 ORDER BY "version" DESC LIMIT 20',[s.workspaceId,agentId]):[];
  return {...item,canTrain:catalog.canTrain,canPublish:catalog.canPublish,versions};
}
async function commitRelease(db:CrmDb,s:Scope,agentId:string,note:string,expectedDigest?:string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['agent-release:'+s.workspaceId+':'+agentId]);
  await db.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 FOR UPDATE',[s.workspaceId,agentId]);
  const snapshot=await source(db,s.workspaceId,agentId);
  if(snapshot.playbook.handoff.enabled&&snapshot.playbook.handoff.assigneeUserId)await validateHandoff(db,s.workspaceId,s.userId,{...snapshot.playbook.handoff},snapshot.playbook.handoff);
  if((!snapshot.opening.trim()&&!hasOpeningRecording(snapshot.playbook))||!snapshot.compiledPrompt.trim())throw new BadRequestError('请先保存开场白与业务话术。');
  const digest=releaseDigest(snapshot),current=(await db.query('SELECT r.* FROM "AgentDeployment" d JOIN "AgentRelease" r ON r."id"=d."releaseId" WHERE d."workspaceId"=$1 AND d."agentId"=$2',[s.workspaceId,agentId]))[0];
  if(expectedDigest&&digest!==expectedDigest)throw new BadRequestError('内容已经更新，请重新审核后发布。');
  if(current&&releaseDigest(current.snapshot)===digest)return {id:current.id,version:current.version};
  const version=Number((await db.query('SELECT COALESCE(MAX("version"),0)+1 AS version FROM "AgentRelease" WHERE "workspaceId"=$1 AND "agentId"=$2',[s.workspaceId,agentId]))[0]!.version),id=randomUUID();
  // A second read detects a concurrent script, sound or model change without publishing mixed revisions.
  if(releaseDigest(await source(db,s.workspaceId,agentId))!==digest)throw new BadRequestError('培训资料正在更新，请稍后重新核对并发布。');
  await db.query('INSERT INTO "AgentRelease" ("id","workspaceId","agentId","version","sourceDigest","snapshot","publishedBy","note") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING "id"',[id,s.workspaceId,agentId,version,digest,JSON.stringify(snapshot),s.userId||null,note]);
  await db.query('INSERT INTO "AgentDeployment" ("workspaceId","agentId","releaseId") VALUES ($1,$2,$3) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "releaseId"=EXCLUDED."releaseId","updatedAt"=NOW() RETURNING "agentId"',[s.workspaceId,agentId,id]);
  return {id,version};
}
export async function publishRelease(s:Scope,agentId:string,input:unknown) {
  const data=z.object({note:z.string().trim().max(300).default(''),expectedDigest:z.string().length(64).optional()}).strict().parse(input);
  const result=await crmDb.transaction(async db=>{await requireScriptManager(s,db);if(!canPublish((await memberAccess(db,s)).permissions))throw new ForbiddenError('当前角色没有审核发布权限。');return commitRelease(db,s,agentId,data.note,data.expectedDigest);});
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'agent.release.published',resourceType:'agent',resourceId:agentId,metadata:{version:result.version}});
  return result;
}
export async function saveAudience(s:Scope,agentId:string,input:unknown) {
  const data=audienceSchema.parse(input);
  const result=await crmDb.transaction(async db=>{
    const access=await memberAccess(db,s);if(!canPublish(access.permissions)||!access.allData)throw new ForbiddenError('使用范围由有发布权限的公司负责人维护。');
    if(!(await db.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "deletionRequestedAt" IS NULL',[s.workspaceId,agentId])).length)throw new NotFoundError('数字员工不存在。');
    const users=await db.query('SELECT m."userId" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."deletedAt" IS NULL AND u."banned"=false AND m."userId"=ANY($2::text[])',[s.workspaceId,data.userIds]);
    const units=await db.query('SELECT "id" FROM "CompanyDepartment" WHERE "organizationId"=$1 AND "id"=ANY($2::text[])',[s.workspaceId,data.departmentIds]);
    if(users.length!==new Set(data.userIds).size||units.length!==new Set(data.departmentIds).size)throw new BadRequestError('所选员工或部门已变化，请刷新后选择。');
    await db.query('INSERT INTO "AgentDeployment" ("workspaceId","agentId","audience") VALUES ($1,$2,$3::jsonb) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "audience"=EXCLUDED."audience","updatedAt"=NOW() RETURNING "agentId"',[s.workspaceId,agentId,JSON.stringify(data)]);
    return {saved:true};
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'agent.audience.updated',resourceType:'agent',resourceId:agentId,metadata:data});
  return result;
}
// Called once during deployment, never on a user's read or on new agent creation.
export async function migrateExistingReleases() {
  const orgs=await crmDb.query('SELECT "id" FROM "Organization" WHERE "deletedAt" IS NULL');
  for(const org of orgs)await crmDb.transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['agent-release-migration:'+org.id]);
    if((await db.query('SELECT "workspaceId" FROM "AgentReleaseMigration" WHERE "workspaceId"=$1',[org.id])).length)return;
    const agents=await db.query('SELECT a."agentId" FROM "Agent" a JOIN "AgentConfiguration" c ON c."agentId"=a."agentId" WHERE a."organizationId"=$1 AND a."deletionRequestedAt" IS NULL AND a."isActive"=true AND length(c."firstMessage")>0 AND length(c."systemPrompt")>0',[org.id]);
    for(const a of agents)await commitRelease(db,{workspaceId:org.id,userId:''},a.agentId,'保留升级前的正式设置');
    await db.query('INSERT INTO "AgentReleaseMigration" ("workspaceId") VALUES ($1) RETURNING "workspaceId"',[org.id]);
  });
}

export function releaseRuntime(snapshot:Row, variables:Record<string,string>={}) {
  const values={...snapshot.placeholders,...variables};
  const replace=(text:string)=>(text||'').replace(/\{\{\s*([\w.\p{L}\p{N}_]+)\s*\}\}/gu,(token,key:string)=>values[key]?.trim()||token);
  const instructions=appendGeneratedInstructions(replace(snapshot.compiledPrompt),[
    snapshot.pageManagedSpeech ? '' : livestreamFreeContext(snapshot.playbook?.livestreamPrice),
    naturalTelephoneRulesSection,
    runtimeVoiceBoundary,
  ]);
  return {opening:replace(snapshot.opening),instructions:applyRuntimeVoice(instructions,{gender:snapshot.communication?.gender||'neutral',expression:snapshot.voiceExpression||'',language:snapshot.profile?.language}),pageManagedSpeech:snapshot.pageManagedSpeech===true};
}

export function assertRuntimeSize(runtime:{instructions:string;opening:string}) {
  if(Buffer.byteLength(runtime.instructions,'utf8')>95000||Buffer.byteLength(runtime.opening,'utf8')>5800)throw new BadRequestError('话术和知识资料过长，请精简内容或拆分业务后再发布。');
}
export function taskRuntime(snapshot:Row,variables:Record<string,string>={},now:Date=new Date()) {
  const values={...(snapshot.demoCall===true?{}:snapshot.placeholders),...variables};
  const replace=(text:string)=>(text||'').replace(/\{\{\s*([\w.\p{L}\p{N}_]+)\s*\}\}/gu,(token,key:string)=>values[key]?.trim()||token);
  if(snapshot.demoCall===true){
    const english=snapshot.language==='en';
    const expression=english
      ? '【English voice delivery】\n'+englishTelephoneVoiceDelivery
      : '\n【演示声音表达】\n'+telephoneVoiceDelivery+'\n参考问题仅用于理解意思，不是精确触发词。结合上下文理解换说法与追问，可以自然改写、简短回应；以已审核资料为事实依据，不编造业务事实、不声称执行外部操作。';
    const runtime={instructions:appendGeneratedInstructions(replace(demoInstructionsForCall(snapshot)),[english?englishAnsweringAssistantInstructions:answeringAssistantInstructions,expression]),opening:replace(snapshot.opening)};
    assertRuntimeSize(runtime);
    return {...runtime,flow:null};
  }
  // Compatibility: old task snapshots contain a dedicated static-knowledge
  // section. Remove only that delimited section; retain the published script.
  const current=(snapshot.instructions||'').replace(/\n【已启用知识，仅作为事实资料】\n[\s\S]*?(?=\n(?:规则：说明自己是AI助手。|【电话表达规则】))/,'');
  const runtime={instructions:appendGeneratedInstructions(replace(current),[answeringAssistantInstructions,...(snapshot.pageManagedSpeech===true?[]:[livestreamTimeContext(snapshot.livestreamSchedule,now),livestreamFreeContext(snapshot.livestreamPrice)]),naturalTelephoneRulesSection]),opening:replace(snapshot.opening)};
  assertRuntimeSize(runtime);
  return {...runtime,flow:snapshot.flow?{...snapshot.flow,nodes:snapshot.flow.nodes.map((n:Row)=>({...n,text:replace(n.text)}))}:null};
}
