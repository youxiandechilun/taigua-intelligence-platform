/*
 * 中文导读：线路与语音外呼：voice-reference-versions.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {crmDb} from '../crm/crm.db.js';
import type {CrmDb,Row} from '../crm/crm.service.js';

export async function rememberVoiceReference(db:CrmDb,workspaceId:string,voiceId:string,row:Row){
 if(!row.voice)return;
 await db.query('INSERT INTO "VoiceReferenceVersion" ("workspaceId","voiceId","voice","targetModel","sampleHash","sample","providerRequestId","createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("workspaceId","voiceId","voice") DO NOTHING',[workspaceId,voiceId,row.voice,row.targetModel,row.sampleHash||'',row.sample||null,row.providerRequestId||'',row.createdBy]);
}
// Library availability and access are checked by the caller. This only proves
// an immutable task's old provider voice belonged to this very same person.
export async function knownVoiceReference(workspaceId:string,voiceId:string,model:string,voice:string,db:CrmDb=crmDb){
 return !!(await db.query('SELECT "voice" FROM "VoiceReferenceVersion" WHERE "workspaceId"=$1 AND "voiceId"=$2 AND "targetModel"=$3 AND "voice"=$4',[workspaceId,voiceId,model,voice])).length;
}
