/*
 * 中文导读：外呼调度主循环。检查容量、任务状态和权限，按任务权重分配起呼机会，并在派发前冻结本通配置。
 * 容量预算、每秒起呼次数、任务并发和线路并发分别检查，不能把其中一个值当成整个系统的能力。
 * 派发前在事务中重读任务、成员权限和线路状态；先锁任务，再处理呼叫尝试。
 * 外部请求结果不确定时保留待核查状态，避免直接重试造成同一号码重复拨打。
 */
import { assertRecordingLearningSnapshot } from '../recording-learning/learning.service.js';
import { authorizePlatformDispatch } from '../platform/platform-call-admission.js';
import { reconcileCallPoints, releaseCallPoints } from '../platform/platform-billing.js';
import { demoInstructionsForCall, systemSpeechForCall } from './demo-runtime.js';
import { freezeAttemptRecognitionRules } from '../crm/intent-recognition.js';
import {navigationAvailable} from '../workspace/navigation-policy.js';
import {carrierWindowOpen,carrierRecipientIssue} from './carrier-policy.js';
import {selectCallRecordings,RecordingVoiceMismatchError} from './recording-selection.js';
import type {Row} from "../crm/crm.service.js";
import {performance} from 'node:perf_hooks';
import { assertAgentUse, taskRuntime } from '../agent/agent.release.js';
import {applyRuntimeVoice} from '../agent/generated-instructions.js';
import {freezeCallVoiceConfiguration,assertCallVoiceConfiguration} from './call-voice-configuration.js';
import {BridgeRequestError} from './bridge-client.js';
import { engineTaskLine, prepareEngineClaim, dispatchEngineCall } from './aliyun-engine.service.js';
import {credentialScope} from './model-credentials.js';
import { resolveRecipientLines, isLineDispatchable, recordLineOutcome } from './routing.service.js';
import { realtimeAuthorized } from './models.service.js';
import { resolvedVoice } from './voices.service.js';
import { assertFrozenEmployeeSound } from './personal-voice.service.js';
import { crmDb } from '../crm/crm.db.js';
import { assertCustomerRecipients } from '../crm/crm.recipients.js';
import { assertCrmDialable } from '../crm/crm.calls.js';
import { bridgeRequest, bridgeReadiness, settings, inDialWindow, lineMissing } from './sip.service.js';
import { callNetworkJitterMs } from './voice-operations.settings.js';
import { isDeepStrictEqual } from 'node:util';
import { sameTaskLine, sameTaskRoutes } from './task-line-compatibility.js';
import { lineSchema } from './sip.schema.js';
import { resolveSipAttemptRoute } from './redial-line.js';
import { holidayAllowed } from './dial-policy.js';
import { hasTaskSlot, hasLineSlot, recentHandoffDials, taskParallelism } from './task-parallelism.js';
import { maximumTaskParallelism, taskParallelismLimitSchema } from './outbound-parallelism.settings.js';
import { chooseFairTask, type FairChoice, type FairTurn } from './task-fair-queue.js';
import {callPriorityQueueRevision,dispatchMaintenanceHeld,sipCapacity,hasSipEngineBudget,hasSipStartBudget,trySipDispatchBudgetLock,trySipTrunkDispatchLock,claimRecipientDispatchSlot,type SipCapacity} from './sip-demo-priority.js';
import {isTestNumberWhitelisted,testNumberWhitelistMatchSql,normalizeTestNumberPhoneSql,MAX_TEST_NUMBER_ENTRIES} from './test-number-whitelist.settings.js';
export { holidayAllowed } from './dial-policy.js';

let timer: ReturnType<typeof setInterval> | undefined;
let sipTimer: ReturnType<typeof setInterval> | undefined;
const running=new Map<string,Promise<void>>();
let stopping = false;
const sipStartTimes:number[]=[];
let sipCandidates:Row[]=[];
let sipCandidatesAt=0;
let sipCandidatesRevision=-1;
let invalidFairTaskWarningAt=-Infinity;
function clearSipCandidates(){sipCandidates=[];sipCandidatesAt=0;sipCandidatesRevision=-1;}
/* 中文注释：检查最近一秒内的起呼次数；此限制与同时在通话的容量预算分别计算。 */

function sipStartAvailable(capacity:SipCapacity){
  const since=performance.now()-1000;
  while(sipStartTimes.length&&sipStartTimes[0]!<=since)sipStartTimes.shift();
  return sipStartTimes.length<capacity.maxStartsPerSecond;
}
/* 中文注释：整理过期租约和排队尝试；派发结果不确定的呼叫转为待核查，避免重复拨号。 */

async function housekeeping() {
  await reconcileCallPoints();
  // Quarantine only the uncertain attempt. Other queued recipients can proceed.
  await crmDb.query(`UPDATE "SipAttempt" SET "status"='NEEDS_REVIEW' WHERE "status" IN ('DISPATCHING','DIALING','CONNECTED') AND "leaseUntil"<NOW() RETURNING "id"`);
  // Lock the task before its attempts, matching continuation/dispatch. A task
  // being extended cannot be cancelled using an old expiry snapshot.
  await crmDb.query(`WITH expired AS (SELECT t."id" FROM "SipTask" t WHERE t."endTime"<NOW() AND EXISTS(SELECT 1 FROM "SipAttempt" a WHERE a."taskId"=t."id" AND a."status"='QUEUED') FOR UPDATE SKIP LOCKED)
    UPDATE "SipAttempt" a SET "status"='CANCELLED',"finishedAt"=NOW(),"result"=COALESCE(a."result",'{}'::jsonb)||'{"reason":"任务拨打期限已过","taskExpired":true}'::jsonb WHERE a."status"='QUEUED' AND a."taskId" IN(SELECT "id" FROM expired) RETURNING a."id"`);
  await crmDb.query(`UPDATE "SipTask" t SET "status"='COMPLETED',"error"='',"updatedAt"=NOW() WHERE t."status" IN ('RUNNING','PAUSED') AND COALESCE(t."snapshot"->>'mode','AI')='AI' AND NOT EXISTS (SELECT 1 FROM "SipAttempt" a WHERE a."taskId"=t."id" AND a."status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED')) RETURNING t."id"`);
}
/* 中文注释：提取可以继续派发的候选号码，并按任务聚合必要的配置与资格信息。 */

async function queuedSipCandidates(provider:'HAOKEHU_SIP'|'ALIYUN_ENGINE') {
  // Resolve task eligibility once per task. A snapshot can contain a large
  // frozen playbook; extracting it once per queued recipient wastes each tick.
  // Classify each recipient before applying each class's LIMIT, so a test
  // number after 240 ordinary recipients still receives a priority turn.
  // Rotate candidate tasks as well as owners, including tasks which could not
  // be dispatched on a previous offer.
  return crmDb.query(`WITH eligible_task_base AS MATERIALIZED (
    SELECT t."id",t."workspaceId",t."createdBy",t."recipients",wm."settings" AS model_settings,
      t."snapshot"->'parallelism' AS requested_parallelism,
      t."snapshot"->'line'->'concurrency' AS legacy_line_concurrency,
      wp."settings"->'outboundParallelism'->'maxParallelism' AS parallelism_limit,
      COALESCE(fair."lastOfferedAt",'1970-01-01'::timestamptz) AS task_last_offer,
      COALESCE(turn."lastDispatchedAt",'1970-01-01'::timestamptz) AS last_turn,
      COALESCE(t."snapshot"->'demoCall'='true'::jsonb,false)
        OR COALESCE(t."snapshot"->'testCall'='true'::jsonb,false) AS task_priority
    FROM "SipTask" t LEFT JOIN "CallDispatchTurn" turn
      ON turn."workspaceId"=t."workspaceId" AND turn."userId"=t."createdBy" AND turn."provider"=$1
    LEFT JOIN "WorkspaceModelSettings" wm ON wm."workspaceId"=t."workspaceId"
    LEFT JOIN "WorkspaceCallPolicy" wp ON wp."workspaceId"=t."workspaceId"
    LEFT JOIN "SipTaskFairTurn" fair ON fair."taskId"=t."id" AND fair."provider"=$1
    WHERE t."status"='RUNNING' AND t."deletedAt" IS NULL
      AND COALESCE(t."snapshot"->>'mode','AI')='AI'
      AND COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP')=$1
      AND t."startTime"<=NOW() AND t."endTime">NOW()
  ), eligible_tasks AS MATERIALIZED (
    SELECT t.*,CASE WHEN $1='HAOKEHU_SIP' AND NOT t.task_priority
      AND t.model_settings->'testNumberWhitelist' @> '[{"enabled":true}]'::jsonb
      AND CASE WHEN jsonb_typeof(t.model_settings->'testNumberWhitelist')='array'
        THEN jsonb_array_length(t.model_settings->'testNumberWhitelist')<=${MAX_TEST_NUMBER_ENTRIES} ELSE false END
      THEN ARRAY(SELECT recipient_index.idx FROM jsonb_array_elements(t."recipients") WITH ORDINALITY AS r(recipient,ordinality)
        CROSS JOIN LATERAL (VALUES ((r.ordinality-1)::int),((r.ordinality-1)::int-jsonb_array_length(t."recipients"))) AS recipient_index(idx)
        WHERE ${testNumberWhitelistMatchSql('t.model_settings',normalizeTestNumberPhoneSql('r.recipient->>\'phoneNumber\''))})
      ELSE ARRAY[]::int[] END AS white_indices
    FROM eligible_task_base t
  ), eligible AS (
    SELECT a."id",a."taskId",a."trunkKey",a."workspaceId",a."nextAttemptAt",t.last_turn,t.task_last_offer,
      t.requested_parallelism,t.legacy_line_concurrency,t.parallelism_limit,priority_class.call_priority,
      row_number() OVER (PARTITION BY a."workspaceId",a."taskId",priority_class.call_priority
        ORDER BY a.override_priority,a."nextAttemptAt",a."id") AS slot
    FROM eligible_tasks t CROSS JOIN (VALUES (true),(false)) AS priority_class(call_priority)
    CROSS JOIN LATERAL (
      SELECT * FROM (
        (SELECT a."id",a."taskId",a."trunkKey",a."workspaceId",a."nextAttemptAt",
          CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END AS override_priority
        FROM "SipAttempt" a WHERE a."workspaceId"=t."workspaceId" AND a."taskId"=t."id"
          AND a."status"='QUEUED' AND a."nextAttemptAt"<=NOW()
          AND t.task_priority AND priority_class.call_priority=($1='HAOKEHU_SIP')
        ORDER BY CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END,a."nextAttemptAt",a."id" LIMIT 240)
        UNION ALL
        (SELECT a."id",a."taskId",a."trunkKey",a."workspaceId",a."nextAttemptAt",
          CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END AS override_priority
        FROM "SipAttempt" a WHERE a."workspaceId"=t."workspaceId" AND a."taskId"=t."id"
          AND a."status"='QUEUED' AND a."nextAttemptAt"<=NOW()
          AND NOT t.task_priority AND priority_class.call_priority AND $1='HAOKEHU_SIP'
          AND cardinality(t.white_indices)>0 AND a."recipientIndex"=ANY(t.white_indices)
        ORDER BY CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END,a."nextAttemptAt",a."id" LIMIT 240)
        UNION ALL
        (SELECT a."id",a."taskId",a."trunkKey",a."workspaceId",a."nextAttemptAt",
          CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END AS override_priority
        FROM "SipAttempt" a WHERE a."workspaceId"=t."workspaceId" AND a."taskId"=t."id"
          AND a."status"='QUEUED' AND a."nextAttemptAt"<=NOW()
          AND NOT t.task_priority AND NOT priority_class.call_priority
          AND NOT(a."recipientIndex"=ANY(t.white_indices))
        ORDER BY CASE WHEN a."result" ? 'lineOverride' THEN 0 ELSE 1 END,a."nextAttemptAt",a."id" LIMIT 240)
      ) class_candidates ORDER BY override_priority,"nextAttemptAt","id" LIMIT 240
    ) a
  ), priority AS (
    SELECT * FROM eligible WHERE call_priority ORDER BY slot,task_last_offer,last_turn,"nextAttemptAt","id" LIMIT 240
  ), ordinary AS (
    SELECT * FROM eligible WHERE NOT call_priority ORDER BY slot,task_last_offer,last_turn,"nextAttemptAt","id" LIMIT 240
  ) SELECT * FROM (SELECT * FROM priority UNION ALL SELECT * FROM ordinary) candidates
    ORDER BY call_priority DESC,slot,task_last_offer,last_turn,"nextAttemptAt","id"`,[provider]);
}
/* 中文注释：读取任务设置的并发作为调度权重，并限制在当前工作区允许的范围。 */


function fairTaskWeight(candidate: Row): number {
  const requested=taskParallelism({parallelism:candidate.requested_parallelism,line:{concurrency:candidate.legacy_line_concurrency}});
  const limit=taskParallelismLimitSchema.safeParse(candidate.parallelism_limit);
  return Math.min(requested,limit.success?limit.data:maximumTaskParallelism);
}
/* 中文注释：从候选任务中按持久化的虚拟进度和上次派发时间选择本轮任务。 */


async function fairOffer(db: import('../crm/crm.service.js').CrmDb, provider: string, candidates: Row[]): Promise<FairChoice | null> {
  const weights=new Map<string,number|null>();
  const invalid=new Set<string>();
  for(const candidate of candidates){
    if(weights.has(candidate.taskId))continue;
    try{weights.set(candidate.taskId,fairTaskWeight(candidate));}
    catch{weights.set(candidate.taskId,null);invalid.add(candidate.taskId);}
  }
  if(invalid.size){
    // Rotate malformed historical tasks out of the bounded candidate window.
    await db.query(`INSERT INTO "SipTaskFairTurn" ("taskId","provider","pass","lastOfferedAt")
      SELECT t."id",$1,0,clock_timestamp() FROM "SipTask" t WHERE t."id"=ANY($2::text[])
      ON CONFLICT ("taskId","provider") DO UPDATE SET "lastOfferedAt"=EXCLUDED."lastOfferedAt" RETURNING "taskId"`,[provider,[...invalid]]);
    for(let i=candidates.length-1;i>=0;i--)if(invalid.has(candidates[i]!.taskId))candidates.splice(i,1);
    if(provider==='HAOKEHU_SIP')sipCandidates=sipCandidates.filter(candidate=>!invalid.has(candidate.taskId));
    if(performance.now()-invalidFairTaskWarningAt>=60000){
      console.warn('[calls] skipping tasks with invalid parallelism',JSON.stringify({provider,count:invalid.size}));
      invalidFairTaskWarningAt=performance.now();
    }
  }
  if(!candidates.length)return null;
  const taskIds=[...new Set(candidates.map(candidate=>candidate.taskId as string))];
  const turns=await db.query(`SELECT "taskId","pass","lastDispatchedAt" FROM "SipTaskFairTurn" WHERE "provider"=$1 AND "taskId"=ANY($2::text[])`,[provider,taskIds]) as FairTurn[];
  const choice=chooseFairTask(candidates.map(candidate=>{
    return {taskId:candidate.taskId,weight:weights.get(candidate.taskId)!,priority:candidate.call_priority===true};
  }),turns);
  if(!choice)return null;
  await db.query(`INSERT INTO "SipTaskFairTurn" ("taskId","provider","pass","lastOfferedAt") VALUES ($1,$2,$3,clock_timestamp())
    ON CONFLICT ("taskId","provider") DO UPDATE SET "pass"=EXCLUDED."pass","lastOfferedAt"=EXCLUDED."lastOfferedAt" RETURNING "taskId"`,[choice.taskId,provider,choice.pass]);
  return choice;
}
/* 中文注释：派发成功占用一次调度机会后，以权重的倒数推进该任务的虚拟进度。 */


async function fairGrant(db: import('../crm/crm.service.js').CrmDb,provider:string,choice:FairChoice) {
  const rows=await db.query(`UPDATE "SipTaskFairTurn" SET "pass"=$3,"lastDispatchedAt"=clock_timestamp() WHERE "taskId"=$1 AND "provider"=$2 RETURNING "taskId"`,[choice.taskId,provider,choice.pass+1/choice.weight]);
  if(!rows.length)throw new Error('Task scheduling state disappeared');
}
/* 中文注释：短期复用候选快照；缓存过期或配置修订变化时重新查询。 */

async function candidatesForTick(provider:'HAOKEHU_SIP'|'ALIYUN_ENGINE') {
  if(provider!=='HAOKEHU_SIP')return queuedSipCandidates(provider);
  if(!sipCandidates.length||performance.now()-sipCandidatesAt>=2000||sipCandidatesRevision!==callPriorityQueueRevision()){
    const revision=callPriorityQueueRevision();
    const fresh=await queuedSipCandidates(provider);
    if(stopping)return [];
    sipCandidates=fresh;sipCandidatesAt=performance.now();sipCandidatesRevision=revision;
  }
  return sipCandidates.slice();
}
/* 中文注释：完成一次派发：检查维护开关与容量，在事务中重新验证任务和权限，再发送到语音桥。 */

async function tick(provider:'HAOKEHU_SIP'|'ALIYUN_ENGINE') {
  if(provider==='HAOKEHU_SIP'&&await dispatchMaintenanceHeld())return;
  if(provider==='HAOKEHU_SIP'&&!(await bridgeReadiness('MANUAL')).ready)return;
  const capacity=provider==='HAOKEHU_SIP'?await sipCapacity():null;
  if(capacity&&!await hasSipEngineBudget(crmDb,capacity))return;
  const candidates=await candidatesForTick(provider);
  const dispatches:Promise<unknown>[]=[];
  let capacityBlocked=false;
  try { while (candidates.length) {
    if(provider==='HAOKEHU_SIP'&&await dispatchMaintenanceHeld())break;
    if (stopping||(capacity&&!sipStartAvailable(capacity))) break;
    if(capacity&&(performance.now()-sipCandidatesAt>=2000||sipCandidatesRevision!==callPriorityQueueRevision())){clearSipCandidates();break;}
    let selected:Row|undefined;
    let skipTaskId:string|undefined;
    let skipTaskTrunk:{taskId:string;trunkKey:string}|undefined;
    const claim = await crmDb.transaction(async d => {
      if(capacity&&!await trySipDispatchBudgetLock(d)){capacityBlocked=true;return null;}
      if(!capacity&&!(await d.query('SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired',['sip-task-fair:'+provider]))[0]?.acquired){capacityBlocked=true;return null;}
      if(capacity&&!sipStartAvailable(capacity)){capacityBlocked=true;return null;}
      const choice=await fairOffer(d,provider,candidates);
      if(!choice)return null;
      const candidate=candidates.splice(choice.index,1)[0]!;
      selected=candidate;
      if(!await trySipTrunkDispatchLock(d,candidate.trunkKey)){skipTaskTrunk={taskId:candidate.taskId,trunkKey:candidate.trunkKey};return null;}
      // The tick precheck avoids full validation when the engine is full. The
      // authoritative budget read remains immediately before reserving below.
      if(capacity&&!sipStartAvailable(capacity)){capacityBlocked=true;return null;}
      if (!(await d.query('SELECT "id" FROM "Organization" WHERE "id"=$1 AND "deletedAt" IS NULL FOR SHARE', [candidate.workspaceId])).length) return null;
      // Match task -> attempt lock order used by expiry and continuation, and
      // recheck the deadline after waiting for a trunk slot.
      const liveTask=await d.query(`SELECT "id" FROM "SipTask" WHERE "workspaceId"=$1 AND "id"=$2 AND "status"='RUNNING' AND "deletedAt" IS NULL AND "startTime"<=clock_timestamp() AND "endTime">clock_timestamp() AND COALESCE("snapshot"->>'mode','AI')='AI' AND COALESCE("snapshot"->>'provider','HAOKEHU_SIP')=$3 FOR UPDATE SKIP LOCKED`,[candidate.workspaceId,candidate.taskId,provider]);
      if(!liveTask.length){skipTaskId=candidate.taskId;return null;}
      const a = (await d.query(`SELECT a.*,t."snapshot",t."recipients",t."createdBy",t."agentId" FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId" WHERE a."id"=$1 AND a."status"='QUEUED' AND a."nextAttemptAt"<=NOW() FOR UPDATE OF a SKIP LOCKED`, [candidate.id]))[0];
      if (!a || (a.snapshot.provider||'HAOKEHU_SIP')!==provider) return null;
      if(capacity&&a.trunkKey!==candidate.trunkKey)return null;
      if(!await navigationAvailable(a.workspaceId,a.createdBy,'outbound')){skipTaskId=a.taskId;return null;}
      if (!await hasTaskSlot(d, a)){skipTaskId=a.taskId;return null;}
      const recipient = a.recipients[a.recipientIndex];
      if(!recipient||!await claimRecipientDispatchSlot(d,a.workspaceId,recipient.phoneNumber))return null;
      if(capacity){
        // Recheck membership after locking the attempt. Removing a number from
        // the whitelist must not retain priority from the short candidate cache.
        const priority=a.snapshot.demoCall===true||a.snapshot.testCall===true||await isTestNumberWhitelisted(a.workspaceId,recipient.phoneNumber,d);
        if(priority!==(candidate.call_priority===true)){clearSipCandidates();return null;}
      }
      let recordingPlan:ReturnType<typeof selectCallRecordings>;
      let line;
      let frozenRecognition: Awaited<ReturnType<typeof freezeAttemptRecognitionRules>>;
      const aliyun=provider==='ALIYUN_ENGINE';
      try {
        if(!a.snapshot.releaseId)throw new Error('Published version required');
        frozenRecognition=await freezeAttemptRecognitionRules(d,a.workspaceId);
        Object.assign(a.snapshot,{intentRules:frozenRecognition.intentRules,assistantDetectionRules:frozenRecognition.assistantDetectionRules,openingInterruptionRules:frozenRecognition.openingInterruptionRules});
        await assertAgentUse({workspaceId:a.workspaceId,userId:a.createdBy},a.agentId,d);
        recordingPlan=selectCallRecordings(a.snapshot,a.id);
        const sound=recordingPlan.sound;
        if(sound)a.snapshot={...a.snapshot,employeeVoice:sound,voiceId:sound.voiceId,voice:sound.voice,realtimeModel:sound.model};
        await assertFrozenEmployeeSound({workspaceId:a.workspaceId,userId:a.createdBy},a.snapshot,d);
        if(!aliyun&&sound){
          // Keep the task's speaker identity, but read its current tuning for
          // each attempt. This in-memory configuration leaves active calls and
          // the task's persisted scripts, route and recipients unchanged.
          const prior=a.snapshot.voiceConfigurations?.[sound.voiceId||''];
          if(prior)assertCallVoiceConfiguration(prior,sound);
          const frozen=await freezeCallVoiceConfiguration({workspaceId:a.workspaceId,userId:a.createdBy},sound,a.snapshot.audio||{},d,recordingPlan.opening);
          assertCallVoiceConfiguration(frozen,sound);
          a.snapshot={...a.snapshot,
            employeeVoice:{...sound,volume:frozen.volume},
            audio:frozen.audio,voiceTuning:frozen.voiceTuning,
            instructions:applyRuntimeVoice(demoInstructionsForCall(a.snapshot),{gender:frozen.gender,expression:frozen.voiceExpression,language:a.snapshot.language},a.snapshot.voiceExpression),
            ...(a.snapshot.demoCall===true?{recordingLearning:null}:{}),
            voiceExpression:frozen.voiceExpression,speechSynthesis:frozen.speechSynthesis,
          };
        }
        if(!aliyun)await realtimeAuthorized(a.workspaceId,a.snapshot.realtimeModel || 'qwen-audio-3.1-realtime-plus',d);
        if(!aliyun)await resolvedVoice(a.workspaceId,{voiceId:a.snapshot.voiceId,realtimeModel:a.snapshot.realtimeModel,voice:a.snapshot.voice,language:a.snapshot.language},d);
      } catch (error) {
        const message=error instanceof RecordingVoiceMismatchError?error.message:'线路分配或音色授权已变化，请重新核对任务';
        await d.query('UPDATE "SipTask" SET "status"=\'PAUSED\',"error"=$2,"updatedAt"=NOW() WHERE "id"=$1 RETURNING "id"',[a.taskId,message]);skipTaskId=a.taskId;return null;
      }
      try {
        line = aliyun ? await engineTaskLine(a.workspaceId, d) : (await resolveSipAttemptRoute(d, a, a)).line;
        if (line.trunkKey !== candidate.trunkKey || a.trunkKey !== candidate.trunkKey) throw new Error('trunk changed');
        if (aliyun && !isDeepStrictEqual(a.snapshot.line, line)) throw new Error('routing changed');
      } catch {
        if (a.result?.resumeLineSwitch === true) {
          await d.query(`UPDATE "SipTask" SET "status"='PAUSED',"error"='继续任务所选线路已停用、分配或接入参数已变化，请重新选择线路',"updatedAt"=NOW() WHERE "id"=$1 RETURNING "id"`, [a.taskId]);
          skipTaskId=a.taskId;
        } else if (a.result?.lineOverride !== undefined) {
          await d.query(`UPDATE "SipAttempt" SET "status"='FAILED',"finishedAt"=NOW(),"result"=COALESCE("result",'{}'::jsonb)||$2::jsonb WHERE "id"=$1 RETURNING "id"`, [a.id, JSON.stringify({reason: 'REDIAL_LINE_UNAVAILABLE', reasonDetail: '所选重拨线路已停用、分配或接入参数已变化，请重新选择线路。'})]);
        } else {
          // Keep a failed original route queued while a separately confirmed
          // override still has work. Its earlier position must not starve redials.
          const overrides = await d.query(`SELECT "id" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "taskId"=$2 AND "status" IN ('QUEUED','DISPATCHING','DIALING','CONNECTED') AND "result" ? 'lineOverride' LIMIT 1`, [a.workspaceId, a.taskId]);
          if (!overrides.length) await d.query(`UPDATE "SipTask" SET "status"='PAUSED',"error"='线路分配或接入参数已变化，请重新核对任务',"updatedAt"=NOW() WHERE "id"=$1 RETURNING "id"`, [a.taskId]);
        }
        return null;
      }
      if (!line.liveEnabled || (!aliyun&&lineMissing(line as import('./sip.schema.js').LineSettings).length) || !inDialWindow(a.snapshot.policyOverride || line.dialPolicy,new Date()) || !holidayAllowed(a.snapshot.policyOverride || line.dialPolicy,new Date())){skipTaskTrunk={taskId:a.taskId,trunkKey:candidate.trunkKey};return null;}
      if(!aliyun){
        if(!carrierWindowOpen(line as import('./sip.schema.js').LineSettings)){skipTaskTrunk={taskId:a.taskId,trunkKey:candidate.trunkKey};return null;}
        const issue=await carrierRecipientIssue(d,{workspaceId:a.workspaceId,userId:a.createdBy},line as import('./sip.schema.js').LineSettings,recipient);
        if (issue) { await d.query(`UPDATE "SipAttempt" SET "status"='FAILED',"finishedAt"=NOW(),"result"=COALESCE("result",'{}'::jsonb)||$2::jsonb WHERE "id"=$1 RETURNING "id"`, [a.id, JSON.stringify({ reason: issue, carrierSkipped: true })]); return null; }
      }
      if (!aliyun && !(await isLineDispatchable(a.workspaceId, line, d))){skipTaskTrunk={taskId:a.taskId,trunkKey:candidate.trunkKey};return null;}
      if (!await hasLineSlot(d, line)){skipTaskTrunk={taskId:a.taskId,trunkKey:candidate.trunkKey};return null;}
      const recent = (await d.query('SELECT COALESCE(sum(CASE WHEN t."snapshot"->>\'mode\'=\'MANUAL\' THEN 2 ELSE 1 END),0)::int AS count FROM "SipAttempt" a JOIN "SipTask" t ON t."id"=a."taskId" AND t."workspaceId"=a."workspaceId" WHERE a."trunkKey"=$1 AND a."startedAt">NOW()-INTERVAL \'1 second\'', [line.trunkKey]))[0]?.count || 0;
      if (line.callsPerSecond>0 && Number(recent)+await recentHandoffDials(d,line.trunkKey) >= line.callsPerSecond){skipTaskTrunk={taskId:a.taskId,trunkKey:candidate.trunkKey};return null;}
      try {
        await assertCustomerRecipients(d,{workspaceId:a.workspaceId,userId:a.createdBy},[recipient]);
        await assertCrmDialable(d,a.workspaceId,[recipient.phoneNumber]);
        if (!(await d.query('SELECT "agentId" FROM "Agent" WHERE "organizationId"=$1 AND "agentId"=$2 AND "isActive"=true AND "deletionRequestedAt" IS NULL',[a.workspaceId,a.agentId])).length) throw new Error('数字员工已停用');
      } catch {
        await d.query('UPDATE "SipTask" SET "status"=\'PAUSED\',"error"=\'客户授权、联系状态或数字员工已变化，请重新核对名单\',"updatedAt"=NOW() WHERE "id"=$1 RETURNING "id"',[a.taskId]);skipTaskId=a.taskId;return null;
      }
      let engineClaim:Row|null=null;
      if(aliyun){try{engineClaim=await prepareEngineClaim(d,a);}catch{await d.query(`UPDATE "SipTask" SET "status"='PAUSED',"error"='阿里云接入、正式模型或线路设置已变化，请重新核对任务',"updatedAt"=NOW() WHERE "id"=$1 RETURNING "id"`,[a.taskId]);skipTaskId=a.taskId;return null;}}
      if(capacity&&await dispatchMaintenanceHeld()){capacityBlocked=true;return null;}
      if(capacity&&(!sipStartAvailable(capacity)||!await hasSipStartBudget(d,capacity)||!await hasSipEngineBudget(d,capacity))){capacityBlocked=true;return null;}
      await d.query('UPDATE "SipAttempt" SET "status"=\'DISPATCHING\',"startedAt"=clock_timestamp(),"leaseUntil"=clock_timestamp()+INTERVAL \'20 minutes\',"result"=COALESCE("result",\'{}\'::jsonb)||$2::jsonb WHERE "id"=$1 RETURNING "id"', [a.id, JSON.stringify({ recognitionRules:frozenRecognition!,dispatchedLine: line,...(!aliyun?{effectiveVoice:{voiceId:a.snapshot.voiceId,sourceModel:a.snapshot.realtimeModel,sourceVoice:a.snapshot.voice,tuning:a.snapshot.voiceTuning,speechSynthesis:a.snapshot.speechSynthesis}}:{}) })]);
      await fairGrant(d,provider,choice);
      await d.query('INSERT INTO "CallDispatchTurn" ("workspaceId","userId","provider") VALUES ($1,$2,$3) ON CONFLICT ("workspaceId","userId","provider") DO UPDATE SET "lastDispatchedAt"=NOW() RETURNING "userId"',[a.workspaceId,a.createdBy,provider]);
      if(engineClaim)return engineClaim;
      await assertRecordingLearningSnapshot(a.workspaceId,a.snapshot);
      const runtime=taskRuntime(a.snapshot,recipient.variables||{});
      const networkJitterMs=await callNetworkJitterMs(a.workspaceId,d);
      return { ...runtime, systemSpeech:systemSpeechForCall(a.snapshot),speechSynthesis:a.snapshot.speechSynthesis,intentRules:a.snapshot.intentRules,assistantDetectionRules:a.snapshot.assistantDetectionRules,openingInterruptionRules:a.snapshot.openingInterruptionRules,testCall:a.snapshot.testCall===true, demoCall: a.snapshot.demoCall === true, workspaceId: a.workspaceId, recordings: recordingPlan!.recordings, audio: {...a.snapshot.audio,networkJitterMs}, credentialScope: credentialScope(a.workspaceId), attemptId: a.id, phoneNumber: recipient.phoneNumber, line, ringTimeoutSeconds: (line as import('./sip.schema.js').LineSettings).ringTimeoutSeconds, voice: a.snapshot.voice, realtimeModel: a.snapshot.realtimeModel, language: a.snapshot.language, maxDurationSeconds: a.snapshot.maxDurationSeconds, record: a.snapshot.record };
    });
    if(capacityBlocked)break;
    if(!selected)break;
    if(skipTaskId){for(let i=candidates.length-1;i>=0;i--)if(candidates[i]!.taskId===skipTaskId)candidates.splice(i,1);}
    if(skipTaskTrunk){for(let i=candidates.length-1;i>=0;i--)if(candidates[i]!.taskId===skipTaskTrunk.taskId&&candidates[i]!.trunkKey===skipTaskTrunk.trunkKey)candidates.splice(i,1);}
    if(capacity){
      sipCandidates=sipCandidates.filter(item=>item.id!==selected!.id);
    }
    if (!claim) continue;
    if(capacity){
      sipStartTimes.push(performance.now());
    }
    dispatches.push((async()=>{try { if(!await authorizePlatformDispatch({workspaceId:claim.workspaceId,attemptId:claim.attemptId,maxDurationSeconds:claim.maxDurationSeconds,snapshot:claim.snapshot}))return;if(provider==='ALIYUN_ENGINE')await dispatchEngineCall(claim);else await bridgeRequest('/calls',claim); }
    catch (error) {
      const bridgeError=error instanceof BridgeRequestError?error:null;
      const reason=bridgeError?.code||'BRIDGE_REQUEST_UNCONFIRMED';
      const detail={reason,reasonDetail:bridgeError?.message||'电话服务请求未确认',bridgeHttpStatus:bridgeError?.bridgeStatus??null};
      console.warn('[calls] dispatch rejected',JSON.stringify({attemptId:claim.attemptId,provider,code:reason,httpStatus:detail.bridgeHttpStatus,rejectedBeforeDispatch:bridgeError?.rejectedBeforeDispatch===true}));
      if(provider==='HAOKEHU_SIP'&&bridgeError?.rejectedBeforeDispatch){
        await crmDb.transaction(async d=>{
          const failed=await d.query(`UPDATE "SipAttempt" SET "status"='FAILED',"finishedAt"=NOW(),"leaseUntil"=NULL,"result"=COALESCE("result",'{}'::jsonb)||$2::jsonb WHERE "id"=$1 AND "status"='DISPATCHING' AND "lastEventAt" IS NULL RETURNING "taskId"`,[claim.attemptId,JSON.stringify({...detail,rejectedBeforeDispatch:true})]);
          if(failed.length)await d.query(`UPDATE "SipTask" SET "status"='PAUSED',"error"=$2,"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('RUNNING','PAUSED') RETURNING "id"`,[failed[0]!.taskId,bridgeError.message]);
        });
        await releaseCallPoints(claim.attemptId, '电话服务在拨打前拒绝请求');
        return;
      }
      if(provider==='HAOKEHU_SIP') await recordLineOutcome(claim.workspaceId,claim.line,false,reason).catch(()=>{});
      await crmDb.transaction(async d => {
        await d.query('UPDATE "SipAttempt" SET "status"=\'NEEDS_REVIEW\',"result"=COALESCE("result",\'{}\'::jsonb)||$2::jsonb WHERE "id"=$1 AND "status"=\'DISPATCHING\' RETURNING "id"',[claim.attemptId,JSON.stringify(detail)]);
        await d.query(`UPDATE "SipTask" SET "error"='部分通话结果未回传，继续处理其余号码；未回传的号码不会重复拨打',"updatedAt"=NOW() WHERE "id"=(SELECT "taskId" FROM "SipAttempt" WHERE "id"=$1) AND "status" IN ('RUNNING','PAUSED') AND EXISTS (SELECT 1 FROM "SipAttempt" WHERE "id"=$1 AND "status"='NEEDS_REVIEW') RETURNING "id"`,[claim.attemptId]);
      });
    }})().catch(()=>{console.warn('[calls] dispatch result pending; delivery will not be retried');}));
  }
  } finally { await Promise.allSettled(dispatches); }
}
/* 中文注释：启动 SIP 高频调度以及周期性整理任务；每种供应商避免重复进入同一轮处理。 */

export function startSipWorker() {
  if(timer||sipTimer)return;stopping=false;clearSipCandidates();
  const run=(key:string,work:()=>Promise<void>)=>{if(!stopping&&!running.has(key)){const job=work().catch(()=>console.warn('[calls] '+key+' temporarily unavailable; tasks preserved')).finally(()=>running.delete(key));running.set(key,job);}};
  timer=setInterval(()=>{run('maintenance',housekeeping);run('ALIYUN_ENGINE',()=>tick('ALIYUN_ENGINE'));},1000);timer.unref();
  sipTimer=setInterval(()=>{run('HAOKEHU_SIP',()=>tick('HAOKEHU_SIP'));},250);sipTimer.unref();
}
/* 中文注释：停止新增调度，等待已进入处理的操作结束，再清理候选缓存。 */

export async function stopSipWorker(){stopping=true;if(timer)clearInterval(timer);if(sipTimer)clearInterval(sipTimer);timer=undefined;sipTimer=undefined;await Promise.allSettled([...running.values()]);clearSipCandidates();}
