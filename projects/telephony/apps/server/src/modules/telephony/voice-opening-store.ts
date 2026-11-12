/*
 * 中文导读：声音库开场音频的读取与通话快照关联。
 */
import {crmDb} from '../crm/crm.db.js';
import {type CrmDb,type Scope,memberAccess} from '../crm/crm.service.js';
import {voiceAccessible} from './voice-options.js';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {createHash} from 'node:crypto';
import {grants} from '../workspace/company-policy.js';

export async function readyVoiceOpening(s:Scope,voiceId:string,db:CrmDb=crmDb){
 const row=(await db.query('SELECT o.*,v."name",v."sampleHash",v."targetModel",v."provider",v."employeeVisible",v."assignedUserIds",v."enabled",v."deletedAt",v."status" AS "voiceStatus" FROM "WorkspaceVoiceOpening" o JOIN "WorkspaceVoice" v ON v."id"=o."voiceId" AND v."workspaceId"=o."workspaceId" WHERE o."workspaceId"=$1 AND o."voiceId"=$2',[s.workspaceId,voiceId]))[0];
 if(!row||row.deletedAt||row.enabled===false||row.voiceStatus!=='READY'||row.status!=='READY'||row.sourceHash!==row.sampleHash||row.targetModel!==CALL_VOICE_MODEL||row.provider!=='HAOKEHU_SIP'||!voiceAccessible(row,s.userId))throw new BadRequestError('这个声音的开场白与复刻尚未准备完成，或未向当前账号开放。请在声音库核对。');
 return row;
}
export async function freezeVoiceOpening(s:Scope,voiceId:string,db:CrmDb=crmDb){
 const row=await readyVoiceOpening(s,voiceId,db);
 return {key:'opening-recordings',source:'voice-library',voiceId,assetId:row.id,text:row.text,textHash:createHash('sha256').update(row.text.normalize('NFC').trim()).digest('hex'),trigger:'开场白',sha256:row.sha256,durationSeconds:row.durationSeconds,analysis:{referenceText:row.analysis?.referenceText??row.text,medianPauseMs:row.analysis?.medianPauseMs}};
}
export async function voiceOpeningAudio(s:Scope,voiceId:string){
 const access=await memberAccess(crmDb,s);
 if(!grants(access.permissions,'agentConfiguration','update')){const row=await readyVoiceOpening(s,voiceId);return Buffer.from(row.audio);}
 const row=(await crmDb.query('SELECT o."audio" FROM "WorkspaceVoiceOpening" o JOIN "WorkspaceVoice" v ON v."workspaceId"=o."workspaceId" AND v."id"=o."voiceId" WHERE o."workspaceId"=$1 AND o."voiceId"=$2 AND v."deletedAt" IS NULL',[s.workspaceId,voiceId]))[0];
 if(!row)throw new NotFoundError('声音库尚未保存开场录音。');return Buffer.from(row.audio);
}
export async function cachedVoicePreview(s:Scope,voiceId:string){
 const access=await memberAccess(crmDb,s);
 const row=(await crmDb.query('SELECT "preview","status","enabled","employeeVisible","assignedUserIds" FROM "WorkspaceVoice" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[s.workspaceId,voiceId]))[0];
 if(!row||row.status!=='READY'||row.enabled===false||(!grants(access.permissions,'agentConfiguration','update')&&!voiceAccessible(row,s.userId)))throw new NotFoundError('这个声音不存在或无权试听。');
 const {currentVoicePreview}=await import('./voice-tuning.js');
 return currentVoicePreview(s,voiceId);
}
// A frozen call may finish with a removed library entry. Authorization is the
// immutable task manifest, workspace and audio digest, rather than a public URL.
export async function attemptVoiceOpening(attemptId:string,assetId:string){
 const row=(await crmDb.query('SELECT t."snapshot",o."audio",o."sha256",o."voiceId" FROM "SipAttempt" r JOIN "SipTask" t ON t."id"=r."taskId" AND t."workspaceId"=r."workspaceId" JOIN "WorkspaceVoiceOpening" o ON o."workspaceId"=t."workspaceId" AND o."id"=$2 WHERE r."id"=$1 AND r."status" IN (\'DISPATCHING\',\'DIALING\',\'CONNECTED\')',[attemptId,assetId]))[0];
 if(!row||!Array.isArray(row.snapshot.recordings)||!row.snapshot.recordings.some((clip:{source?:string;assetId:string;voiceId:string;sha256:string})=>clip.source==='voice-library'&&clip.assetId===assetId&&clip.voiceId===row.voiceId&&clip.sha256===row.sha256))throw new NotFoundError('当前通话未关联这条声音库开场白。');
 return Buffer.from(row.audio);
}
