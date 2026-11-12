/*
 * 中文导读：通话记录列表、详情与相关业务入口。
 */
import { isAliyunVoice } from "../../config/voice-backend.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { NotFoundError } from "../../common/errors/notFound.js";
import { livekitRoomServiceClient } from "../../config/livekit.js";
import { deleteObject, generateDownloadUrl } from "../../config/s3.js";
import { reportCallMinutesUsage } from "../billing/metered-usage.service.js";
import {
  hasActiveLegacySubscription,
  isLegacyBilledCall,
} from "../billing/call-metering.service.js";
import * as calllogRepository from "./calllog.repository.js";
import type {
  IngestCallLogArgs,
  ListCallLogsArgs,
  ListTranscriptsArgs,
} from "./calllog.schema.js";
import type { LiveTranscriptStore } from "../../realtime/live-transcript.store.js";
import type { CallStartedEvent } from "../../realtime/live-transcript.contract.js";
import prisma from "../../config/prisma.js";
import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { companyContext } from "../workspace/company-access.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { grants } from "../workspace/company-policy.js";
import { crmDb, crmDbFor } from '../crm/crm.db.js';
import { storeCallSummary } from './call-summary.store.js';
import { withCurrentAgentNames } from '../agent/agent-display-name.js';
import { callSummarySchema, groundCallSummary, summaryFromFields, finalCallIntent, summaryFields, summaryEvaluation, transcriptReview } from "./call-analysis.js";
import { withCallDisplayStatus } from './call-display-status.js';
import { withCallOwners } from './call-owner.js';
import { saveCallReadState, withCallReadStates } from './call-read-state.store.js';
import { withCallCosts } from '../billing/call-costs.js';
import { effectiveIntentCtes } from '../crm/customer-intent.live.js';

type RecordingSigner = (key: string) => Promise<string>;
type CallWithRecording = { audioRecordingPath: string | null };
const LIVEKIT_REGISTRY_STALE_GRACE_MS = 30_000;

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const signCallRecordingUrl = async <T extends CallWithRecording>(
  call: T,
  signer: RecordingSigner = generateDownloadUrl,
): Promise<T> => {
  if (call.audioRecordingPath?.startsWith("sip-recording:")||call.audioRecordingPath?.startsWith("callback-recording:")||call.audioRecordingPath?.startsWith("aliyun-engine-recording:")) {
    const id=call.audioRecordingPath.split(":")[1]||"";
    if(!/^[a-f0-9-]{36}$/.test(id))return {...call,audioRecordingPath:null};
    const base=(process.env.CONSOLE_URL || process.env.SERVER_URL || "").split(",")[0]!.replace(/\/+$/, "");
    return {...call,audioRecordingPath:base+"/api/v1/telephony/recordings/"+id};
  }
  if (!call.audioRecordingPath || isHttpUrl(call.audioRecordingPath)) {
    return call;
  }

  return {
    ...call,
    audioRecordingPath: await signer(call.audioRecordingPath),
  };
};

export const ingestCallLog = async (args: IngestCallLogArgs) => {
  const callLog = await calllogRepository.saveCallLog(args);
  // Stripe meters only still-active legacy subscriptions. Prepaid calls are
  // settled by the wallet reporter and must never be reported a second time.
  if (
    (await isLegacyBilledCall(args.organizationId, args.callId)) ||
    (await hasActiveLegacySubscription(args.organizationId))
  ) {
    await reportCallMinutesUsage({
      organizationId: args.organizationId,
      callId: args.callId,
      durationSeconds: args.durationSeconds,
      timestamp: new Date(args.endTime),
    }).catch((error) => {
      console.warn("[billing] failed to report legacy Stripe call usage", {
        organizationId: args.organizationId,
        callId: args.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return callLog;
};

export const listCallLogs = async (args: ListCallLogsArgs & {viewerId?:string}) => {
  // Repository over-fetches by one row; we trim here and hand back the
  // trailing callId as the next cursor so the caller can walk forward.
  const rows = await calllogRepository.listByOrg(args);
  const hasMore = rows.length > args.limit;
  const items = hasMore ? rows.slice(0, args.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.callId : null;
  const normalized = await Promise.all(items.map((item) => calllogRepository.normalizeCallLogForOrg(item)));
  const owned = await withCallOwners(crmDb, args.organizationId, normalized);
  const named = await withCurrentAgentNames(crmDb, args.organizationId, owned);
  const displayed = await withCallDisplayStatus(crmDb, args.organizationId, named);
  const readable = await withCallReadStates(crmDb, args.organizationId, args.viewerId, displayed);
  return {
    items: await Promise.all((await withCallCosts(crmDb, args.organizationId, readable)).map((item) => signCallRecordingUrl(item))),
    nextCursor,
  };
};

export const getCallLog = async (organizationId: string, callId: string, viewerId?:string) => {
  const row = await calllogRepository.getCallByIdForOrg(callId, organizationId,viewerId);
  if (!row) {
    throw new NotFoundError("Call log not found");
  }
  const normalizedRow = await calllogRepository.normalizeCallLogForOrg(row);
  const ownedRows = await withCallOwners(crmDb, organizationId, [normalizedRow]);
  const [namedRow] = await withCurrentAgentNames(crmDb, organizationId, ownedRows);
  const [run, rule, transcripts, access, [displayedRow], persistedIntent] = await Promise.all([
    prisma.automationRun.findFirst({ where: { organizationId, sourceId: callId, kind: 'CALL_SUMMARY' }, select: { status: true, result: true, updatedAt: true } }),
    prisma.automationRule.findFirst({ where: { organizationId, kind: 'CALL_SUMMARY' }, select: { enabled: true } }),
    prisma.callTranscript.findMany({ where: { callLogId: callId }, select: { speaker: true, messageText: true }, orderBy: { timestamp: 'asc' }, take: 1000 }),
    viewerId ? companyContext(organizationId, viewerId) : Promise.resolve(null),
    withCallDisplayStatus(crmDb, organizationId, [namedRow!]),
    crmDb.query(`${effectiveIntentCtes} SELECT CASE WHEN c."intent"='interested'
      AND c."profile"->'intentConfirmation'->>'source'='admin-confirmed'
      AND c."profile"->'intentConfirmation'->>'active'='true'
      AND c."profile"->'intentConfirmation'->>'relatedCallId'=k."callId"
      THEN 'interested' ELSE k."intent" END AS intent,k."recognitionStatus"
      FROM effective_calls k LEFT JOIN effective_customers c ON c."workspaceId"=k."workspaceId" AND c."phone"=k."phone"
      WHERE k."workspaceId"=$1 AND k."callId"=$2`, [organizationId, callId]),]);
  const parsed = run?.status === 'SUCCESS' ? callSummarySchema.safeParse(run.result) : null;
  const grounded = groundCallSummary(parsed?.success ? parsed.data : summaryFromFields(normalizedRow.dataExtracted), transcripts, normalizedRow.metadata);
  // The persisted verdict drives both the customer library and call list.
  // Re-reading an old raw model run must not silently reclassify the call.
  const persisted = persistedIntent[0]?.intent;
  const savedMeta = normalizedRow.metadata as Record<string, unknown> | null;
  const intentMap: Record<string, ReturnType<typeof finalCallIntent>> = {interested:'INTERESTED',uninterested:'NO_NEED',optout:'OPT_OUT',unclear:savedMeta?.finalIntent==='FOLLOW_UP'?'FOLLOW_UP':'UNKNOWN'};
  const savedIntent = typeof persisted === 'string' ? intentMap[persisted] : undefined;
  const stored = Array.isArray(normalizedRow.dataExtracted) ? normalizedRow.dataExtracted : [];
  const savedLabels = {INTERESTED:'有意向',FOLLOW_UP:'待跟进',NO_NEED:'暂无需求',OPT_OUT:'拒绝再次联系',UNKNOWN:'尚不明确'};
  const derived = savedIntent && stored.some(item => (item as {name?:unknown})?.name === '沟通摘要')
    ? stored.map(item => item && typeof item === 'object' && !Array.isArray(item) && item.name === '客户意向' ? {...item, value:savedLabels[savedIntent]} : item)
    : grounded ? summaryFields(savedIntent ? {...grounded, intent:savedIntent} : grounded) : [];
  const quality = grounded ? summaryEvaluation(grounded) : [];
  const review = transcriptReview(transcripts);
  const evaluation = quality.length ? quality : review;
  const [readableRow] = await withCallReadStates(crmDb, organizationId, viewerId, [displayedRow!]);
  const [costRow] = await withCallCosts(crmDb, organizationId, [readableRow!]);
  return signCallRecordingUrl({
    ...costRow!,
    metadata: { ...(normalizedRow.metadata as Record<string, unknown> || {}), finalIntent: savedIntent || finalCallIntent(grounded?.intent, normalizedRow.metadata, transcripts), intentRecognitionStatus: persistedIntent[0]?.recognitionStatus || 'confirmed' },
    dataExtracted: derived.length ? derived : stored.filter(item => !['沟通摘要', 'summary', '客户需求', 'need', '客户意向', 'intent', '人工接管', '接管理由', '下一步', '建议下一步'].includes(String((item as {name?: unknown})?.name))),
    dataEvaluation: evaluation,
    analysis: {
      status: run?.status ?? (!transcripts.length ? 'NO_TRANSCRIPT' : rule?.enabled ? 'NOT_STARTED' : 'DISABLED'),
      enabled: rule?.enabled === true,
      canGenerate: (row.metadata as Record<string,unknown>|null)?.demoCall!==true && !!access?.canManage && grants(access.permissions, 'automation', 'update') && row.status === 'COMPLETED' && transcripts.length > 0,
      evaluatedBy: quality.length ? 'AI' : review.length ? 'TRANSCRIPT' : 'NONE',
      updatedAt: run?.status === 'SUCCESS' ? run.updatedAt.toISOString() : null,
    },
  });
};

export async function setCallReadState(organizationId: string, userId: string, callId: string, read: boolean) {
  const call = await calllogRepository.getCallByIdForOrg(callId, organizationId, userId);
  if (!call) throw new NotFoundError('通话不存在或无权查看。');
  return saveCallReadState(crmDb, organizationId, userId, callId, read);
}

export async function requestCallAnalysis(organizationId: string, userId: string, callId: string) {
  const call = await calllogRepository.getCallByIdForOrg(callId, organizationId, userId);
  if (!call) throw new NotFoundError('通话不存在或无权查看。');
  if ((call.metadata as Record<string,unknown>|null)?.demoCall===true) throw new BadRequestError('演示电话保留录音和问答记录，不进行客户意向分析。');
  const access = await companyContext(organizationId, userId);
  if (!access.canManage || !grants(access.permissions, 'automation', 'update')) throw new ForbiddenError('通话分析由全公司授权管理员操作。');
  if (call.status !== 'COMPLETED' || !await prisma.callTranscript.count({ where: { callLogId: callId } })) throw new BadRequestError('请等待通话结束并收到文字记录后再分析。');
  return prisma.$transaction(async tx => {
    const existing = await tx.$queryRaw<Array<{callId:string}>>`SELECT "callId" FROM "CallLog" WHERE "callId"=${callId} AND "organizationId"=${organizationId} AND "deleted"=false FOR UPDATE`;
    if(!existing.length)throw new NotFoundError('原通话已不可用。');
    const rule = await tx.automationRule.findFirst({ where: { organizationId, kind: 'CALL_SUMMARY', enabled: true } });
    if (!rule) throw new BadRequestError('请先在自动化中开启“通话整理与跟进”。');
    await tx.$queryRaw`SELECT "id" FROM "AutomationRun" WHERE "organizationId"=${organizationId} AND "kind"='CALL_SUMMARY' AND "sourceId"=${callId} FOR UPDATE`;
    const old = await tx.automationRun.findFirst({ where: { organizationId, kind: 'CALL_SUMMARY', sourceId: callId } });
    if (old && ['QUEUED', 'RUNNING'].includes(old.status)) return { queued: true };
    // Preserve the visible previous result while an explicit re-analysis runs.
    if (old?.status === 'SUCCESS') {
      const previous = callSummarySchema.safeParse(old.result);
      const transcripts = await tx.callTranscript.findMany({ where: { callLogId: callId }, select: { speaker: true, messageText: true }, orderBy: { timestamp: 'asc' } });
      const safe = previous.success ? groundCallSummary(previous.data, transcripts, call.metadata) : null;
      if (safe) await storeCallSummary(crmDbFor(tx), organizationId, callId, safe);
    }
    if (old) await tx.automationRun.update({ where: { id: old.id }, data: { status: 'QUEUED', result: Prisma.DbNull, error: '', attempts: 0, tokenHash: null, leaseUntil: null, nextAttemptAt: new Date() } });
    else await tx.automationRun.create({ data: { id: randomUUID(), organizationId, ownerId: rule.ownerId, kind: 'CALL_SUMMARY', sourceId: callId } });
    return { queued: true };
  });
}

export const getTranscripts = async (args: ListTranscriptsArgs & {viewerId?:string}) => {
  const rows = await calllogRepository.getTranscriptsByCallId(args);
  const hasMore = rows.length > args.limit;
  const items = hasMore ? rows.slice(0, args.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.callTransId : null;
  return { items, nextCursor };
};

type LiveKitRoomClient = {
  listRooms: () => Promise<unknown[]>;
  deleteRoom: (roomName: string) => Promise<unknown>;
};

type LiveCallRegistry = Pick<
  LiveTranscriptStore,
  "findActiveCallByRoom" | "listActiveCalls" | "markCallStale"
>;

export type LiveCallRoom = {
  roomName: string;
  callId: string;
  direction: "inbound" | "outbound" | "unknown";
  participantCount: number;
  startedAt: string | null;
  status: "active";
  agentId: string | null;
  agentName: string | null;
  fromNumber: string | null;
  toNumber: string | null;
};

export const listLiveCalls = async (
  organizationId: string,
  roomClient: LiveKitRoomClient = livekitRoomServiceClient as LiveKitRoomClient,
  registry?: LiveCallRegistry,
) => {
  if (isAliyunVoice) return [] as LiveCallRoom[];
  let registered: CallStartedEvent[] | null = null;
  if (registry) {
    try {
      registered = await registry.listActiveCalls(organizationId);
    } catch (error) {
      console.warn(
        "[live-calls] Redis registry unavailable; using LiveKit fallback",
        {
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  let normalizedRooms: LiveCallRoom[];
  try {
    const rooms = await roomClient.listRooms();
    normalizedRooms = rooms
      .map(normalizeLiveRoom)
      .filter((room): room is LiveCallRoom => room !== null);
  } catch (error) {
    if (registered) {
      console.warn(
        "[live-calls] LiveKit unavailable; returning Redis registry",
        {
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return enrichAgentNames(
        organizationId,
        registered.map((event) => liveCallFromRegistry(event, null)),
      );
    }
    throw error;
  }

  const calls: LiveCallRoom[] = [];
  const claimedRooms = new Set<string>();
  const claimedCallIds = new Set<string>();
  if (registered) {
    const roomsByName = new Map(
      normalizedRooms.map((room) => [room.roomName, room]),
    );
    const roomsByCallId = new Map(
      normalizedRooms.map((room) => [room.callId, room]),
    );
    const stale: CallStartedEvent[] = [];
    for (const event of registered) {
      claimedCallIds.add(event.callId);
      const room =
        roomsByName.get(event.roomName) ?? roomsByCallId.get(event.callId);
      if (!room) {
        const startedAt = Date.parse(event.startedAt);
        const withinVisibilityGrace =
          Number.isFinite(startedAt) &&
          Date.now() - startedAt < LIVEKIT_REGISTRY_STALE_GRACE_MS;
        if (withinVisibilityGrace) {
          calls.push(liveCallFromRegistry(event, null));
        } else {
          stale.push(event);
        }
        continue;
      }
      claimedRooms.add(room.roomName);
      calls.push(liveCallFromRegistry(event, room));
    }
    if (registry && stale.length > 0) {
      await Promise.all(
        stale.map((event) =>
          registry
            .markCallStale(organizationId, event.callId)
            .catch((error) => {
              console.warn(
                "[live-calls] failed to clean stale registry entry",
                {
                  organizationId,
                  callId: event.callId,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }),
        ),
      );
    }
  }

  const fallbackRooms = normalizedRooms.filter(
    (room) =>
      !claimedRooms.has(room.roomName) && !claimedCallIds.has(room.callId),
  );
  const scopedFallback = await Promise.all(
    fallbackRooms.map(async (room) =>
      (await calllogRepository.liveRoomBelongsToOrg(
        organizationId,
        room.roomName,
      ))
        ? room
        : null,
    ),
  );
  calls.push(
    ...scopedFallback.filter((room): room is LiveCallRoom => room !== null),
  );

  const enriched = await enrichAgentNames(
    organizationId,
    mergeCallsByCallId(calls),
  );
  return enriched.sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );
};

export const endLiveCall = async (
  organizationId: string,
  roomName: string,
  roomClient: LiveKitRoomClient = livekitRoomServiceClient as LiveKitRoomClient,
  registry?: LiveCallRegistry,
) => {
  if (isAliyunVoice) throw new BadRequestError("阿里云通话请在外呼任务中停止，实时转人工需在云端话术配置。");
  const normalizedRoomName = roomName.trim();
  if (!normalizedRoomName) {
    throw new NotFoundError("Live call room not found");
  }
  let registeredCall: CallStartedEvent | null = null;
  if (registry) {
    try {
      registeredCall = await registry.findActiveCallByRoom(
        organizationId,
        normalizedRoomName,
      );
    } catch (error) {
      console.warn("[live-calls] Redis ownership check unavailable", {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const belongsToOrg =
    registeredCall !== null ||
    (await calllogRepository.liveRoomBelongsToOrg(
      organizationId,
      normalizedRoomName,
    ));
  if (!belongsToOrg) {
    throw new NotFoundError("Live call room not found");
  }
  try {
    await roomClient.deleteRoom(normalizedRoomName);
  } catch (error) {
    if (!isLiveKitRoomNotFound(error)) throw error;
  }
  return {
    status: "ended" as const,
    roomName: normalizedRoomName,
    callId: registeredCall?.callId ?? callIdFromRoomName(normalizedRoomName),
  };
};

function normalizeLiveRoom(room: unknown): LiveCallRoom | null {
  if (!room || typeof room !== "object") return null;
  const record = room as Record<string, unknown>;
  const roomName = stringValue(record.name ?? record.roomName);
  if (!roomName || roomName.startsWith("preview-")) return null;

  return {
    roomName,
    callId: callIdFromRoomName(roomName),
    direction: roomName.startsWith("outbound_") ? "outbound" : "inbound",
    participantCount:
      numberValue(record.numParticipants ?? record.num_participants) ?? 0,
    startedAt: liveKitTimestamp(
      record.creationTime ?? record.creation_time ?? record.createdAt,
    ),
    status: "active",
    agentId: null,
    agentName: null,
    fromNumber: null,
    toNumber: null,
  };
}

function liveCallFromRegistry(
  event: CallStartedEvent,
  room: LiveCallRoom | null,
): LiveCallRoom {
  return {
    roomName: event.roomName,
    callId: event.callId,
    direction: event.direction,
    participantCount: room?.participantCount ?? 0,
    startedAt: event.startedAt,
    status: "active",
    agentId: event.agentId || null,
    agentName: null,
    fromNumber: event.fromNumber || null,
    toNumber: event.toNumber || null,
  };
}

function mergeCallsByCallId(calls: LiveCallRoom[]) {
  const byCallId = new Map<string, LiveCallRoom>();
  for (const call of calls) {
    const existing = byCallId.get(call.callId);
    if (!existing) {
      byCallId.set(call.callId, call);
      continue;
    }
    byCallId.set(call.callId, {
      ...existing,
      participantCount:
        call.participantCount > existing.participantCount
          ? call.participantCount
          : existing.participantCount,
      direction:
        existing.direction === "unknown" ? call.direction : existing.direction,
      startedAt: existing.startedAt ?? call.startedAt,
      agentId: existing.agentId ?? call.agentId,
      agentName: existing.agentName ?? call.agentName,
      fromNumber: existing.fromNumber ?? call.fromNumber,
      toNumber: existing.toNumber ?? call.toNumber,
    });
  }
  return [...byCallId.values()];
}

async function enrichAgentNames(organizationId: string, calls: LiveCallRoom[]) {
  if (!calls.length) return calls;
  const owners = await prisma.callLog.findMany({
    where: { organizationId, callId: { in: calls.map(call => call.callId) }, deleted: false },
    select: { callId: true, userId: true, agentId: true },
  });
  const byId = new Map(owners.map(owner => [owner.callId, owner]));
  const named = await withCurrentAgentNames(crmDb, organizationId, calls.map(call => ({
    ...call,
    agentId: byId.get(call.callId)?.agentId || call.agentId,
    userId: byId.get(call.callId)?.userId || null,
  })));
  return named.map(({ userId: _owner, ...call }) => call);
}

function isLiveKitRoomNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? "").toLowerCase();
  const status = record.status ?? record.statusCode;
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    code === "not_found" ||
    code === "5" ||
    status === 404 ||
    message.includes("not found") ||
    message.includes("does not exist")
  );
}

function callIdFromRoomName(roomName: string) {
  if (roomName.startsWith("outbound_")) {
    return roomName.slice("outbound_".length);
  }
  return roomName;
}

function liveKitTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "bigint")
    return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "number") {
    return new Date(
      value > 10_000_000_000 ? value : value * 1000,
    ).toISOString();
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return liveKitTimestamp(numeric);
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const deleteCallLog = async (
  organizationId: string,
  callId: string,
  dependencies: {
    deleteObjectImpl?: typeof deleteObject;
    deleteCallLogImpl?: typeof calllogRepository.deleteCallLog;
    getCallForDeletionImpl?: typeof calllogRepository.getCallForDeletion;
  } = {},
  viewerId?:string,
) => {
  const getCallForDeletion =
    dependencies.getCallForDeletionImpl ?? calllogRepository.getCallForDeletion;
  const call = await getCallForDeletion(callId, organizationId,viewerId);
  if (!call) {
    throw new NotFoundError("Call log not found");
  }

  if (call.audioRecordingPath && !isHttpUrl(call.audioRecordingPath) && !/^(?:sip|callback|aliyun-engine)-recording:/.test(call.audioRecordingPath)) {
    const deleteRecording = dependencies.deleteObjectImpl ?? deleteObject;
    await deleteRecording(call.audioRecordingPath);
  }

  const deleteCallLogImpl =
    dependencies.deleteCallLogImpl ?? calllogRepository.deleteCallLog;
  const ok = await deleteCallLogImpl(
    callId,
    organizationId,
    call.audioRecordingPath,
  );
  if (!ok) {
    throw new NotFoundError("Call log not found");
  }
};

export async function ownLiveCalls(organizationId:string,userId:string,calls:LiveCallRoom[]){
 const owned=await prisma.callLog.findMany({where:{organizationId,userId,deleted:false,callId:{in:calls.map(call=>call.callId)}},select:{callId:true}});
 const ids=new Set(owned.map(call=>call.callId));return calls.filter(call=>ids.has(call.callId));
}
