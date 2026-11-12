/*
 * 中文导读：数字员工与话术：personal-settings-sync.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {accountUsername} from '../accounts/account-identity.js';
import {resolveEmployeeSound} from '../telephony/personal-voice.service.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type CrmDb, type Scope } from '../crm/crm.service.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import CustomApiError from '../../common/errors/customApiError.js';
import { publishedRelease, assertAgentUse, assertRuntimeSize, releaseRuntime } from './agent.release.js';
import { personalPlaybookRow, personalSnapshot, personalScript, writePersonalPlaybook } from './personal-playbook.store.js';
import { initialPersonalConfig } from './personal-agent-config.js';
import { effectivePersonalRow, validateConfiguration } from './personal-playbook.service.js';
import { freezeRecordings } from '../telephony/script-recordings.js';
import { workspaceVoiceDelivery } from '../telephony/voice-delivery-policy.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import type { ConversationPlaybook } from './agent.playbook.js';

export const syncInput = z.object({
 sourceRevision:z.number().int().min(1),sourceVoiceVersion:z.string().max(64),baseReleaseId:z.string().min(1).max(200),
 sections:z.array(z.enum(['basic','conversation'])).min(1).max(2),
 targets:z.array(z.object({userId:z.string().min(1).max(100),revision:z.number().int().min(0),voiceVersion:z.string().max(64)}).strict()).min(1).max(1000),
}).strict().refine(v=>new Set(v.targets.map(t=>t.userId)).size===v.targets.length,'账号不能重复。');
async function requireAdmin(db:CrmDb,s:Scope){
 if(!(await memberAccess(db,s)).isSystemAdmin)throw new ForbiddenError('只有超级管理员可以同步数字员工设置。');
}
async function recipients(db:CrmDb,s:Scope){
 const rows=await db.query(`SELECT m."userId",u."name",u."email",COALESCE(r."name",m."role") AS "roleName" FROM "Member" m JOIN "User" u ON u."id"=m."userId" LEFT JOIN "CompanyRole" r ON r."id"=m."companyRoleId" AND r."workspaceId"=m."organizationId" WHERE m."organizationId"=$1 AND m."userId"<>$2 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."banned"=false AND u."deletedAt" IS NULL AND NOT ('admin'=ANY(string_to_array(COALESCE(u."role",''),','))) ORDER BY u."name",m."userId"`,[s.workspaceId,s.userId]);
 return rows.map(({email,...row})=>({...row,userId:String(row.userId),name:String(row.name),roleName:String(row.roleName),username:accountUsername(email,process.env.ACCOUNT_EMAIL_DOMAIN||'dx.zezejun.cn')}));
}
async function voiceVersion(db:CrmDb,s:Scope,agentId:string){const rows=await db.query('SELECT "scopeKey","choice","volume","updatedAt" FROM "EmployeeVoicePreference" WHERE "workspaceId"=$1 AND "userId"=$2 AND "provider"=$3 AND "scopeKey" IN ($4,\'default\') ORDER BY "scopeKey"',[s.workspaceId,s.userId,'HAOKEHU_SIP',agentId]);return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
export async function syncCandidates(s:Scope,agentId:string){
 await requireAdmin(crmDb,s);
 const release=await publishedRelease(s,agentId),source=await personalPlaybookRow(crmDb,s,agentId);
 const targets=[];
 for(const person of await recipients(crmDb,s)){
  const target={workspaceId:s.workspaceId,userId:person.userId};
  let reason='';try{await assertAgentUse(target,agentId);}catch(e){reason=e instanceof Error?e.message:'该账号暂不能使用此数字员工。';}
  const row=await personalPlaybookRow(crmDb,target,agentId);
  targets.push({...person,revision:row?.revision??0,voiceVersion:await voiceVersion(crmDb,target,agentId),eligible:!reason,reason});
 }
 return {sourceRevision:source?.revision??0,sourceVoiceVersion:await voiceVersion(crmDb,s,agentId),sourceSaved:!!source?.playbook,baseReleaseId:release.id,targets};
}
async function copyAssets(db:CrmDb,s:Scope,target:Scope,agentId:string,playbook:ConversationPlaybook){
 const ids=new Map<string,string>();
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['script-recordings:'+s.workspaceId+':'+target.userId]);
 for(const entry of Object.values(playbook.recordingReplies?.entries||{}))for(const clip of entry.clips){
  let id=ids.get(clip.assetId);
  if(!id){
   const asset=(await db.query(`SELECT * FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "agentId"=$2 AND "id"=$3 AND ("scope"='template' OR "ownerId"=$4) AND "deletedAt" IS NULL`,[s.workspaceId,agentId,clip.assetId,s.userId]))[0];
   if(!asset)throw new BadRequestError('源录音不可用，请重新保存话术后同步。');
   const existing=(await db.query(`SELECT "id" FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "ownerId"=$2 AND "agentId"=$3 AND "scope"='personal' AND "voiceId"=$4 AND "textHash"=$5 AND "sha256"=$6`,[s.workspaceId,target.userId,agentId,asset.voiceId,asset.textHash,asset.sha256]))[0];
   if(!existing){
    const usage=(await db.query('SELECT COALESCE(SUM(octet_length("audio")),0)::bigint AS "bytes" FROM "ScriptRecordingAsset" WHERE "workspaceId"=$1 AND "ownerId"=$2',[s.workspaceId,target.userId]))[0];
    if(Number(usage?.bytes||0)+Buffer.byteLength(asset.audio)>250*1024*1024)throw new BadRequestError('目标账号录音空间不足。');
   }
   const copied=(await db.query(`INSERT INTO "ScriptRecordingAsset" ("id","workspaceId","ownerId","agentId","scope","fileName","text","textHash","sha256","audio","durationSeconds","voiceId") VALUES ($1,$2,$3,$4,'personal',$5,$6,$7,$8,$9,$10,$11) ON CONFLICT ("workspaceId","ownerId","agentId","scope","voiceId","textHash","sha256") DO UPDATE SET "deletedAt"=NULL RETURNING "id"`,[randomUUID(),s.workspaceId,target.userId,agentId,asset.fileName,asset.text,asset.textHash,asset.sha256,asset.audio,asset.durationSeconds,asset.voiceId]))[0]!;
   id=String(copied.id);ids.set(clip.assetId,id);
  }
  if(entry.selectedOpeningId===clip.assetId)entry.selectedOpeningId=id;
  clip.assetId=id;
 }
}
export async function syncPersonalSettings(s:Scope,agentId:string,raw:unknown){
 const input=syncInput.parse(raw);
 const result=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);
  await requireAdmin(db,s);
  const people=await recipients(db,s),allowed=new Map(people.map(p=>[p.userId,p]));
  for(const target of input.targets)if(!allowed.has(target.userId))throw new ForbiddenError('目标账号已停用或不在当前工作区下属账号范围。');
  // Same lock order for simultaneous administrators; ordinary personal saves
  // use the same per-user lock and revision check.
  for(const userId of [s.userId,...input.targets.map(t=>t.userId)].sort())await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['employee-playbook:'+s.workspaceId+':'+userId+':'+agentId]);
  if(input.sections.includes('conversation')){
   for(const userId of [s.userId,...input.targets.map(t=>t.userId)].sort())await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['employee-voice:'+s.workspaceId+':'+userId]);
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['voice-library:'+s.workspaceId]);
   if(await voiceVersion(db,s,agentId)!==input.sourceVoiceVersion)throw new CustomApiError('源声音已变化，请重新打开同步窗口。',409);
  }
  const release=await publishedRelease(s,agentId,db),row=await effectivePersonalRow(db,s,agentId,release);
  if(!row?.playbook||row.revision!==input.sourceRevision||release.id!==input.baseReleaseId)throw new CustomApiError('源设置已变化，请关闭同步窗口后重新打开。',409);
  const source=personalSnapshot(release.snapshot,row,s.userId);
  const sourceSound=input.sections.includes('conversation')?await resolveEmployeeSound(s,agentId,source,'HAOKEHU_SIP',db):null;
  const delivery=await workspaceVoiceDelivery(s.workspaceId,db);
  for(const selected of [...input.targets].sort((a,b)=>a.userId.localeCompare(b.userId))){
   const target={workspaceId:s.workspaceId,userId:selected.userId};
   try{
    const targetRelease=await publishedRelease(target,agentId,db),previous=await personalPlaybookRow(db,target,agentId);
    if((previous?.revision??0)!==selected.revision)throw new CustomApiError('设置刚被修改，请重新选择账号。',409);
    if(input.sections.includes('conversation')&&await voiceVersion(db,target,agentId)!==selected.voiceVersion)throw new CustomApiError('声音刚被修改，请重新选择账号。',409);
    const prior=personalSnapshot(targetRelease.snapshot,previous,target.userId);
    const conversation=input.sections.includes('conversation'),basic=input.sections.includes('basic');
    const candidate=structuredClone(conversation?source.playbook:prior.playbook) as ConversationPlaybook;
    // Personal reception remains with each target account.
    candidate.handoff=structuredClone(prior.playbook.handoff);
    candidate.employee=structuredClone(basic?source.playbook.employee:prior.playbook.employee);
    if(conversation)await copyAssets(db,s,target,agentId,candidate);
    const playbook=personalScript(candidate);
    const configuration=initialPersonalConfig(structuredClone(basic?source:prior));
    configuration.profile.voiceId=sourceSound?sourceSound.voiceId:prior.profile.voiceId;
    configuration.profile.voice=sourceSound?sourceSound.voice:prior.profile.voice;
    configuration.profile.realtimeModel=sourceSound?sourceSound.model:prior.profile.realtimeModel;
    configuration.profile.audio={...configuration.profile.audio,...delivery};
    // Always recheck target voice access, even if the source and target IDs match.
    await validateConfiguration(db,target,configuration,{...initialPersonalConfig(prior),profile:{...prior.profile,voiceId:'__validate__'}});
    await freezeRecordings(target,agentId,playbook,db);
    if(sourceSound){
     const choice=sourceSound.voiceId?'library:'+sourceSound.voiceId:`builtin:${sourceSound.model}:${sourceSound.voice}`;
     await resolveEmployeeSound(target,agentId,{...prior,...configuration,playbook},'HAOKEHU_SIP',db,{choice,volume:sourceSound.volume});
     await db.query('INSERT INTO "EmployeeVoicePreference" ("workspaceId","userId","scopeKey","agentId","provider","choice","volume") VALUES ($1,$2,$3,$3,$4,$5,$6) ON CONFLICT ("workspaceId","userId","scopeKey","provider") DO UPDATE SET "choice"=EXCLUDED."choice","volume"=EXCLUDED."volume","updatedAt"=NOW() RETURNING "userId"',[s.workspaceId,target.userId,agentId,'HAOKEHU_SIP',choice,sourceSound.volume]);
    }
    const placeholders=structuredClone(conversation?source.placeholders||{}:prior.placeholders||{});
    assertRuntimeSize(releaseRuntime({...prior,...configuration,playbook}));
    await writePersonalPlaybook(db,target,agentId,{expectedRevision:selected.revision,baseReleaseId:targetRelease.id,playbook,placeholders,configuration});
   }catch(e){if(e instanceof CustomApiError)throw new CustomApiError(`${allowed.get(selected.userId)?.name||'目标账号'}：${e.message}；本次同步未写入任何账号。`,e.statusCode);throw e;}
  }
  return {count:input.targets.length};
 });
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'agent.personal-settings.synced',resourceType:'agent',resourceId:agentId,metadata:{sourceRevision:input.sourceRevision,sections:input.sections,targets:input.targets.map(t=>t.userId),count:result.count}});
 return result;
}
