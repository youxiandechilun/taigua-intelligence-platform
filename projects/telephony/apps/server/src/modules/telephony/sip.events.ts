/*
 * 中文导读：线路与语音外呼：sip.events.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { resolveHandoffOwner } from '../agent/agent.handoff.js';
import { randomUUID } from 'node:crypto';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { type CrmDb } from '../crm/crm.service.js';
import { terminalStates, type SipEvent } from './sip.schema.js';
import { linkExistingCall } from '../crm/crm.calls.js';
import {presets} from './models.service.js';
import {modelPlatforms} from './model-platforms.js';
import {modelKey} from './model-credentials.js';
import {keyFingerprint,storeModelUsage,observeModelConnection} from './model-telemetry.js';
import {recordLineOutcome} from './routing.service.js';
import { queueTaskRetry } from './task-retry.js';
import { attemptLine } from './attempt-line.js';
import { lineOutcome } from './line-outcome.js';
import { assistantDetectionResultSchema, attemptRecognitionRules, clearRecognitionIntentSql, matchAssistantDetection } from '../crm/intent-recognition.js';
import { hasOnlyContactChecks, qualifiedInterestQuote } from '../calllogs/call-analysis.js';

function terminalAssistantDetection(event: SipEvent, previous: Record<string, unknown>, snapshot: unknown) {
  const rules = attemptRecognitionRules(previous, snapshot).assistantDetectionRules;
  let customerFragment = '';
  for (const turn of event.transcript) {
    if (turn.speaker !== 'customer') { customerFragment = ''; continue; }
    customerFragment = Array.from(customerFragment + ' ' + turn.text).slice(-6000).join('');
    const detected = matchAssistantDetection(turn.text, rules) || matchAssistantDetection(customerFragment, rules);
    if (detected) return { ...detected, at: event.occurredAt, messageId: ('terminal:' + event.eventId).slice(0, 200) };
  }
  return undefined;
}

export async function ingestEvent(db: CrmDb, event: SipEvent) {
  return db.transaction(async d => {
    const a = (await d.query('SELECT a.*,t."agentId",t."createdBy",t."recipients",t."snapshot",t."endTime" AS "taskEndTime",t."status" AS "taskStatus" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."id"=$1 FOR UPDATE OF a,t', [event.attemptId]))[0];
    if(a?.snapshot.provider&&a.snapshot.provider!=='HAOKEHU_SIP')throw new BadRequestError('人工回拨结果请由回拨平台同步。');
    if (!a) throw new BadRequestError('通话事件未关联到本系统任务。');
    if (a.status === 'QUEUED' || a.status === 'CANCELLED') throw new BadRequestError('尚未启动的通话不能接收结果。');
    // Claim the provider event atomically so concurrent carrier retries are cheap and idempotent.
    if ((await d.query(`SELECT "id" FROM "SipEvent" WHERE "id"=$1`, [event.eventId])).length) {
      return { duplicate: true };
    } await d.query(`INSERT INTO "SipEvent" ("id","workspaceId","attemptId") VALUES ($1,$2,$3)`, [event.eventId, a.workspaceId, a.id]);
    // A late final event can carry more usage than the last heartbeat. Store
    // its cumulative counters even when the call state no longer advances.
    if(event.modelUsage&&a.snapshot.mode!=='MANUAL'&&(event.state!==a.status||terminalStates.includes(event.state))){
      const preset=presets.find(p=>p.id===a.snapshot.realtimeModel&&p.kind==='realtime');
      const platform=preset&&modelPlatforms.find(p=>p.key===preset.key);
      if(preset&&platform){
        const u=event.modelUsage;
        if(u.requests>0)await storeModelUsage(a.workspaceId,platform.id,preset.id,'VOICE_CALL','voice:'+a.id,{inputTokens:u.inputTokens??null,outputTokens:u.outputTokens??null,totalTokens:u.totalTokens??null,inputAudioTokens:u.inputAudioTokens??null,outputAudioTokens:u.outputAudioTokens??null,cachedTokens:u.cachedTokens??null,requests:u.requests,missingUsage:u.missingUsage},d,a.id);
        const key=await modelKey(a.workspaceId,preset.key).catch(()=>'');
        if(key&&keyFingerprint(key)===u.keyFingerprint&&u.connected!==undefined&&u.observedAt&&Date.parse(u.observedAt)<=Date.now()+60000)await observeModelConnection(a.workspaceId,preset.id,key,u.connected,u.connected?'最近语音会话已连接':'最近语音服务连接异常',d,new Date(u.observedAt));
      }
    }
    const priorFinished = terminalStates.includes(a.status) && a.status !== 'NEEDS_REVIEW';
    const rank: Record<string, number> = { DISPATCHING: 0, DIALING: 1, CONNECTED: 2, COMPLETED: 3, NOT_ANSWERED: 3, FAILED: 3 };
    if (priorFinished || (a.lastEventAt && Date.parse(event.occurredAt) < new Date(a.lastEventAt).getTime()) || (rank[event.state]! < (rank[a.status] || 0))) return { ignored: true };
    const finished = terminalStates.includes(event.state);
    const stateChanged = event.state !== a.status;
    if (!finished && !stateChanged) {
      const touched = await d.query(`UPDATE "SipAttempt" SET "lastEventAt"=GREATEST(COALESCE("lastEventAt",$2),$2),"leaseUntil"=NOW()+INTERVAL '20 minutes' WHERE "id"=$1 AND "status"=$3 AND "status" IN ('DISPATCHING','DIALING','CONNECTED') RETURNING "id"`, [a.id,new Date(event.occurredAt),a.status]);
      if (!touched.length) return { ignored: true };
      return { saved: true, heartbeat: true, workspaceId: a.workspaceId, callId: a.id };
    }
    const previous = a.result && typeof a.result === 'object' && !Array.isArray(a.result) ? a.result : {};
    const priorDetection = assistantDetectionResultSchema.safeParse(previous.assistantDetection);
    const assistantDetection = event.assistantDetection || (priorDetection.success ? priorDetection.data : undefined) || (finished ? terminalAssistantDetection(event, previous, a.snapshot) : undefined);
    const machine = event.answeringMachineDetected === true || !!assistantDetection || previous.answeringMachineDetected === true || event.reason === 'ANSWERING_MACHINE' || previous.reason === 'ANSWERING_MACHINE';
    const reason = machine ? 'ANSWERING_MACHINE' : event.reason;
    const state = machine && finished ? 'COMPLETED' : event.state;
    // Terminal call metadata is consumed before the asynchronous summary. Fence
    // greeting/identity-only calls here too, so an old bridge or in-flight
    // provisional label cannot reach the customer-library trigger first.
    const transcriptRows = event.transcript.map(turn => ({ speaker: turn.speaker, messageText: turn.text }));
    const contactCheckOnly = finished && hasOnlyContactChecks(transcriptRows);
    const unqualifiedPositive = finished && !machine && !qualifiedInterestQuote(transcriptRows, previous)
      && (event.intent === 'interested' || previous.provisionalIntent === 'interested' || previous.intent === 'interested' || event.flowOutcome === 'interested');
    const clearPositiveRecognition = machine || contactCheckOnly || unqualifiedPositive;
    const flowOutcome = machine || contactCheckOnly || unqualifiedPositive && event.flowOutcome === 'interested' ? 'neutral' : event.flowOutcome;
    const handoffRequested = !machine && event.handoffRequested;
    const optOutRequested = !machine && (event.optOutRequested || previous.doNotCallRequested === true || previous.optOutRequested === true);
    const selectedIntent = event.intent || previous.provisionalIntent || previous.intent || null;
    const keepNegative = !machine && ['optout', 'uninterested'].includes(String(selectedIntent));
    const intentMetadata = clearPositiveRecognition && !keepNegative ? {} : { intent: selectedIntent, intentEvidence: event.intentEvidence || previous.provisionalEvidence || null, matchedRules: event.matchedRules.length ? event.matchedRules : previous.provisionalRules || [] };
    const liveRecognitionMetadata = { liveIntentEligible: !finished && !machine && previous.liveIntentEligible === true,
      liveRecognitionBlockedReason: previous.liveRecognitionBlockedReason || null,
      ...(!clearPositiveRecognition && previous.provisionalIntent ? { provisionalIntent: previous.provisionalIntent, provisionalRules: previous.provisionalRules || [], provisionalEvidence: previous.provisionalEvidence || '', provisionalAt: previous.provisionalAt || null } : {}),
      ...(contactCheckOnly ? { recognitionGuard: 'CONTACT_CHECK_ONLY' } : {}),
      ...(unqualifiedPositive ? { recognitionGuard: 'NO_EXPLICIT_ACCEPTANCE' } : {}),
      ...(previous.recognitionRules?.revision ? { recognitionRulesRevision: previous.recognitionRules.revision } : {}),
    };
    const result = { ...previous, ...liveRecognitionMetadata, durationSeconds: event.durationSeconds, reason, diagnostics: event.diagnostics, wasConnected: machine || a.status === 'CONNECTED' || previous.wasConnected === true || state === 'COMPLETED' || event.durationSeconds > 0 || event.transcript.length > 0, optOutRequested, doNotCallRequested: optOutRequested, handoffRequested, flowOutcome, answeringMachineDetected: machine, ...(assistantDetection ? {assistantDetection} : {}), ...intentMetadata };
    if (clearPositiveRecognition) for (const key of ['intent','intentEvidence','matchedIntent','matchedRules','matchedEvidence','provisionalIntent','provisionalRules','provisionalEvidence','provisionalAt','provisionalMessageId','liveIntentEligible']) delete result[key];
    if (clearPositiveRecognition && keepNegative) Object.assign(result, intentMetadata);
    const r = a.recipients[a.recipientIndex];
    const line = attemptLine(a); if (handoffRequested && finished) await d.query(`UPDATE "SipLiveHandoff" SET status=CASE WHEN $3='HANDOFF_CONNECTED' THEN 'CONNECTED' ELSE 'FAILED' END,reason=$3,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "attemptId"=$2 AND status='RESERVED'`, [a.workspaceId, a.id, reason]);
    const live=handoffRequested?(await d.query('SELECT "status","userId" FROM "SipLiveHandoff" WHERE "workspaceId"=$1 AND "attemptId"=$2',[a.workspaceId,a.id]))[0]:undefined;
    const metadata = { ...(!machine ? liveRecognitionMetadata : {liveIntentEligible:false}), ...(a.snapshot.demoCall===true?{demoCall:true,demoRevision:a.snapshot.demoRevision||null}:{}), liveHandoffStatus: live?.status || null, liveHandoffUserId: live?.userId || null, lineProvider: line?.serviceProvider || null, lineName: line?.name || null, trunkKey: line?.trunkKey || a.trunkKey, costPerMinute: line?.costPerMinute ?? null, handoff: a.snapshot.handoff || null, mode: a.snapshot.mode || 'AI', provider: 'HAOKEHU_SIP', releaseId: a.snapshot.releaseId || null, releaseVersion: a.snapshot.releaseVersion || null, taskId: a.taskId, attemptId: a.id, recipientIndex: a.recipientIndex, toNumber: r.phoneNumber, fromNumber: line?.callerNumber || '', crmCompanyId: r.crmCompanyId || null, crmContactId: r.crmContactId || null, disposition: reason, flowTrace: event.flowTrace, collected: event.collected, flowOutcome, flowRevision: a.snapshot.flow?.revision || null, audioSettings: a.snapshot.audio || null, diagnostics: event.diagnostics, handoffRequested, doNotCallRequested: optOutRequested, recordingFile: event.recordingFile || null, answeringMachineDetected:machine,...(assistantDetection?{assistantDetection}:{}),...intentMetadata };
    const status = state === 'COMPLETED' ? 'COMPLETED' : state === 'NOT_ANSWERED' ? 'NOT_ANSWERED' : state === 'FAILED' ? 'FAILED' : 'IN_PROGRESS';
    const existed=(await d.query('SELECT "callId" FROM "CallLog" WHERE "callId"=$1',[a.id])).length>0;
    const inserted = await d.query(`INSERT INTO "CallLog" ("callId","organizationId","agentId","userId","startTime","endTime","durationSeconds","status","callerId","metadata","sessionId","direction","deleted") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"CallStatus",$9,$10::jsonb,$1,'OUTBOUND',false) ON CONFLICT ("callId") DO UPDATE SET "endTime"=EXCLUDED."endTime","durationSeconds"=EXCLUDED."durationSeconds","status"=EXCLUDED."status","metadata"=(COALESCE("CallLog"."metadata",'{}'::jsonb)${clearPositiveRecognition?clearRecognitionIntentSql:''})||EXCLUDED."metadata" WHERE "CallLog"."organizationId"=EXCLUDED."organizationId" RETURNING "callId"`, [a.id,a.workspaceId,a.agentId,a.createdBy,a.startedAt || new Date(event.occurredAt),finished ? new Date(event.occurredAt) : null,event.durationSeconds,status,r.phoneNumber,JSON.stringify(metadata)]);
    if (!inserted.length) throw new BadRequestError('通话归属不一致。');
    if(!existed && a.agentId && a.snapshot.demoCall!==true)await d.query('UPDATE "Agent" SET "callLogsCount"="callLogsCount"+1 WHERE "organizationId"=$1 AND "agentId"=$2 RETURNING "agentId"',[a.workspaceId,a.agentId]);
    if(event.recordingFile)await d.query('UPDATE "CallLog" SET "audioRecordingPath"=$3 WHERE "organizationId"=$1 AND "callId"=$2 RETURNING "callId"',[a.workspaceId,a.id,'sip-recording:'+a.id]);
    const healthOutcome = lineOutcome({...event,state,reason}, result.wasConnected);
    if (finished && line && healthOutcome !== null) await recordLineOutcome(a.workspaceId, line, healthOutcome, reason, d);
    await d.query('UPDATE "SipAttempt" SET "status"=$2,"lastEventAt"=$3,"finishedAt"=$4,"leaseUntil"=$5,"result"=$6::jsonb WHERE "id"=$1 RETURNING "id"', [a.id, state, new Date(event.occurredAt), finished ? new Date(event.occurredAt) : null, finished ? null : new Date(Date.now() + 20 * 60000), JSON.stringify(result)]);
    if (finished) {
      for (const t of event.transcript) await d.query('INSERT INTO "CallTranscript" ("callTransId","callLogId","speaker","messageText","timestamp") VALUES ($1,$2,$3,$4,$5) RETURNING "callTransId"', [randomUUID(),a.id,t.speaker,t.text,new Date(t.timestamp)]);
      if (r.crmCompanyId && a.snapshot.demoCall!==true) {
        const valid = await d.query('SELECT "id" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM "CrmContact" WHERE "workspaceId"=$1 AND "companyId"=$2 AND "id"=$3))', [a.workspaceId,r.crmCompanyId,r.crmContactId || null]);
        if (valid.length) {
          const linked = await d.query('INSERT INTO "CrmCallLink" ("id","workspaceId","companyId","contactId","callId") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("workspaceId","callId") DO NOTHING RETURNING "id"', [randomUUID(),a.workspaceId,r.crmCompanyId,r.crmContactId || null,a.id]);
          if (linked.length) await d.query('INSERT INTO "CrmActivity" ("id","workspaceId","companyId","contactId","actorId","kind","title","notes","metadata") VALUES ($1,$2,$3,$4,\'system\',\'CALL\',\'客户通话结果\',$5,$6::jsonb) RETURNING "id"', [randomUUID(),a.workspaceId,r.crmCompanyId,r.crmContactId || null,reason,JSON.stringify({callId:a.id,provider:'HAOKEHU_SIP',flowOutcome,collected:event.collected,flowRevision:a.snapshot.flow?.revision||null,answeringMachineDetected:machine})]);
        }
      }
      if(optOutRequested && a.snapshot.demoCall!==true) {
        const companies=await d.query('UPDATE "CrmCompany" SET "status"=\'OPT_OUT\',"nextFollowUp"=NULL,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND ("id"=$2 OR "phone"=$3) RETURNING "id"',[a.workspaceId,r.crmCompanyId||'',r.phoneNumber]);
        await d.query('UPDATE "CrmContact" SET "doNotCall"=true,"status"=\'OPT_OUT\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND ("companyId"=ANY($2::text[]) OR "mobile"=$3 OR "areaCode"||"landline"=$3) RETURNING "id"',[a.workspaceId,companies.map(c=>c.id),r.phoneNumber]);
        await d.query('UPDATE "CrmTask" SET "status"=\'CANCELLED\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "companyId"=ANY($2::text[]) AND "status"=\'PENDING\' RETURNING "id"',[a.workspaceId,companies.map(c=>c.id)]);
      }
      if(a.snapshot.demoCall!==true && handoffRequested && live?.status!=='CONNECTED' && !optOutRequested && r.crmCompanyId) {
        const company=(await d.query('SELECT "ownerId","status" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NULL',[a.workspaceId,r.crmCompanyId]))[0];
        if(company&&company.status!=='OPT_OUT') {
          const owner=await resolveHandoffOwner(d,a.workspaceId,a.snapshot.handoff,[company.ownerId,a.createdBy],r.crmCompanyId);
          if(owner){
            await d.query(`INSERT INTO "CrmTask" ("id","workspaceId","companyId","contactId","ownerId","title","notes","status","dueAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'客户要求人工跟进','客户在通话中要求人工，等待负责人跟进。','PENDING',NOW(),NOW()) RETURNING "id"`,[randomUUID(),a.workspaceId,r.crmCompanyId,r.crmContactId||null,owner.userId]);
            await d.query(`UPDATE "CallLog" SET "metadata"="metadata"||$3::jsonb WHERE "organizationId"=$1 AND "callId"=$2 RETURNING "callId"`,[a.workspaceId,a.id,JSON.stringify({handoffTaskCreated:true,handoffOwnerName:owner.name,handoffUsedFallback:!owner.configured})]);
          }
        }
      }
      if(!machine&&['RUNNING','PAUSED','NEEDS_REVIEW'].includes(a.taskStatus)){
        await queueTaskRetry(d,{id:a.taskId,workspaceId:a.workspaceId,snapshot:a.snapshot,endTime:a.taskEndTime},{...a,status:state,finishedAt:event.occurredAt,result});
      }
      await d.query('UPDATE "SipTask" SET "status"=\'COMPLETED\',"error"=\'\',"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "status" IN (\'RUNNING\',\'PAUSED\',\'NEEDS_REVIEW\') AND NOT EXISTS (SELECT 1 FROM "SipAttempt" WHERE "taskId"=$2 AND "status" IN (\'QUEUED\',\'DISPATCHING\',\'DIALING\',\'CONNECTED\')) RETURNING "id"', [a.workspaceId,a.taskId]);
    }
    return { saved: true, workspaceId: a.workspaceId, callId: a.id };
  });
}
