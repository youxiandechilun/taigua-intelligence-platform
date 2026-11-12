/*
 * 中文导读：通话记录的数据库查询与可见范围筛选。
 */
import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import prisma from "../../config/prisma.js";
import {grants} from "../workspace/company-policy.js";
import {companyContext} from "../workspace/company-access.js";
import {callVisibilityWhere} from "../workspace/company-access.js";
import { redactJson, redactText } from "../../lib/redaction.js";
import type {
  IngestCallLogArgs,
  ListCallLogsArgs,
  ListTranscriptsArgs,
} from "./calllog.schema.js";
import { widgetRoomBelongsToOrg } from "../widgets/widget.repository.js";

// Create a CallLog, its CallTranscript children, and — best-effort — link the
// originating OutboundCall in one transaction. The OutboundCall linkage is
// deliberately non-fatal: a stale or cross-org outboundId logs a warning and
// the CallLog is still persisted (per product decision #4).
export const saveCallLog = async (input: IngestCallLogArgs) => {
  const redactPii = process.env.CALL_LOG_PII_REDACTION !== "false";

  return prisma.$transaction((tx) =>
    saveCallLogInTransaction(tx, input, redactPii),
  );
};

export const saveCallLogInTransaction = async (
  tx: Prisma.TransactionClient,
  input: IngestCallLogArgs,
  redactPii: boolean,
) => {
  const { callerId, metadata } = buildCallLogIdentityFields(input, redactPii);
  const inserted = await tx.callLog.createMany({
    data: {
      callId: input.callId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      userId: input.userId,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      durationSeconds: input.durationSeconds,
      status: input.status,
      direction: input.direction,
      audioRecordingPath: input.recordingSid,
      callerId,
      metadata,
      dataExtracted: redactPii
        ? redactJson(input.extractedData)
        : input.extractedData,
      dataEvaluation: redactPii
        ? redactJson(input.evaluatedData)
        : input.evaluatedData,
    },
    skipDuplicates: true,
  });

  const callLog = await tx.callLog.findUnique({
    where: { callId: input.callId },
  });
  if (!callLog || callLog.organizationId !== input.organizationId) {
    throw new BadRequestError("Call identifier is already in use");
  }

  if (inserted.count === 0) {
    return callLog;
  }

  if (input.transcripts.length > 0) {
    await tx.callTranscript.createMany({
      data: input.transcripts.map((transcript) => ({
        callLogId: callLog.callId,
        speaker: transcript.role,
        messageText: redactPii
          ? redactText(transcript.message)
          : transcript.message,
        timestamp: new Date(transcript.timestamp),
        isPiiRedacted: redactPii,
      })),
    });
  }

  const outboundId = input.metadata?.outboundId ?? null;
  if (outboundId) {
    // updateMany with the composite {outboundId, organizationId} predicate
    // is the tenant-safe write. A row in a different org yields count: 0.
    const linked = await tx.outboundCall.updateMany({
      where: { outboundId, organizationId: input.organizationId },
      data: { callLogId: callLog.callId, status: input.status },
    });
    if (linked.count === 0) {
      console.warn("[calllogs] ingest: outboundId not linkable", {
        outboundId,
        callId: callLog.callId,
        organizationId: input.organizationId,
      });
    }
  }

  return callLog;
};

export function buildCallLogIdentityFields(
  input: IngestCallLogArgs,
  redactPii: boolean,
) {
  // The external party's number goes into callerId. On inbound it's the
  // caller; on outbound it's the callee. Keep structured phone fields raw so
  // call-log tables and details can show the actual number; redact only
  // free-form text that may contain incidental PII.
  const callerId =
    (input.direction === "inbound" ? input.fromNumber : input.toNumber) || null;
  const summary = input.metadata?.summary ?? "";
  const intent = input.metadata?.intent ?? "";
  const baseMetadata = (
    redactPii
      ? redactJson(jsonObject(input.metadata))
      : jsonObject(input.metadata)
  ) as Prisma.InputJsonObject;
  const metadata = {
    ...baseMetadata,
    summary: redactPii ? redactText(summary) : summary,
    intent: redactPii ? redactText(intent) : intent,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    provider: input.provider,
  } satisfies Prisma.InputJsonObject;

  return { callerId, metadata };
}

function jsonObject(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Prisma.InputJsonObject;
}

type NormalizableCallLog = {
  callId: string;
  organizationId: string;
  agentId: string | null;
  userId: string | null;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  audioRecordingPath: string | null;
  callerId: string | null;
  metadata: Prisma.JsonValue | null;
  sessionId: string | null;
  direction: string | null;
};

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Normalize records written by the older provider adapters.  New events are
 * expected to write these fields directly, but list/detail reads also repair
 * old rows so the console does not show a mixture of blanks and values.
 */
export function normalizeCallLog<T extends NormalizableCallLog>(call: T): T {
  const meta = metadataRecord(call.metadata);
  const provider = nonEmptyString(meta.provider)?.toUpperCase() || "";
  const fromNumber = nonEmptyString(meta.fromNumber);
  const toNumber = nonEmptyString(meta.toNumber);
  const rawDirection = nonEmptyString(call.direction || meta.direction)?.toLowerCase();
  const direction = rawDirection === "inbound" || rawDirection === "outbound"
    ? rawDirection
    : toNumber
      ? "outbound"
      : fromNumber
        ? "inbound"
        : null;
  const metadataDuration = typeof meta.durationSeconds === "number" && Number.isFinite(meta.durationSeconds)
    ? Math.max(0, Math.round(meta.durationSeconds))
    : null;
  // Carrier start/end includes ringing. Only carrier talk-time receipts can
  // supply billable duration; a missing receipt must remain unknown.
  const carrierDuration = ['HAOKEHU_SIP', 'HAOKEHU_CALLBACK', 'ALIYUN_ENGINE', 'ALIYUN_AICCS', 'ALIYUN'].includes(provider);
  const derivedDuration = !carrierDuration && call.startTime && call.endTime
    ? Math.max(0, Math.round((call.endTime.getTime() - call.startTime.getTime()) / 1000))
    : null;
  const durationSeconds = call.durationSeconds ?? metadataDuration ?? derivedDuration;
  const agentId = call.agentId ?? nonEmptyString(meta.agentId);
  const userId = call.userId ?? nonEmptyString(meta.userId) ?? nonEmptyString(meta.createdBy);
  const callerId = call.callerId ?? (direction === "inbound" ? fromNumber : toNumber) ?? fromNumber ?? toNumber;
  const sessionId = call.sessionId ?? nonEmptyString(meta.sessionId) ?? call.callId;
  const recordingExpired = !!nonEmptyString(meta.recordingExpiredAt) ||
    !!call.endTime && call.endTime.getTime() < Date.now() - 72 * 60 * 60 * 1000;
  let audioRecordingPath = recordingExpired ? null : call.audioRecordingPath;
  if (!recordingExpired && !audioRecordingPath) {
    audioRecordingPath = nonEmptyString(meta.recordingPath) ?? nonEmptyString(meta.recordingUrl);
    const recordingFile = nonEmptyString(meta.recordingFile);
    if (!audioRecordingPath && recordingFile && /^[a-f0-9-]{36}(?:\.wav)?$/i.test(recordingFile)) {
      const prefix = provider === "HAOKEHU_CALLBACK"
        ? "callback-recording:"
        : provider === "ALIYUN_ENGINE" || provider === "ALIYUN_AICCS" || provider === "ALIYUN"
          ? "aliyun-engine-recording:"
          : "sip-recording:";
      audioRecordingPath = prefix + call.callId;
    }
  }
  return {
    ...call,
    agentId,
    userId,
    durationSeconds,
    audioRecordingPath,
    callerId,
    sessionId,
    direction,
  };
}

export async function normalizeCallLogForOrg<T extends NormalizableCallLog>(call: T): Promise<T> {
  const normalized = normalizeCallLog(call);
  const changed = normalized.agentId !== call.agentId || normalized.userId !== call.userId ||
    normalized.durationSeconds !== call.durationSeconds || normalized.audioRecordingPath !== call.audioRecordingPath ||
    normalized.callerId !== call.callerId || normalized.sessionId !== call.sessionId || normalized.direction !== call.direction;
  if (changed) {
    await prisma.callLog.updateMany({
      where: { callId: call.callId, organizationId: call.organizationId },
      data: {
        agentId: normalized.agentId,
        userId: normalized.userId,
        durationSeconds: normalized.durationSeconds,
        audioRecordingPath: normalized.audioRecordingPath,
        callerId: normalized.callerId,
        sessionId: normalized.sessionId,
        direction: normalized.direction,
      },
    });
  }
  return normalized;
}

export const listByOrg = async (args: ListCallLogsArgs & {viewerId?:string}) => {
  const {
    organizationId,
    agentId,

    direction,
    from,
    to,
    limit,
    cursor,
  } = args;
  const reviewOnly = args.status === 'NEEDS_REVIEW';
  const status = reviewOnly ? 'IN_PROGRESS' : args.status as Exclude<ListCallLogsArgs['status'], 'NEEDS_REVIEW'>;
  const filterReviewStatus = reviewOnly || status === 'IN_PROGRESS';
  const filterDuration = args.minDuration !== undefined || args.maxDuration !== undefined;

  const visibility=await callVisibilityWhere(organizationId,args.viewerId,args.ownerId||'mine');
  const where: Prisma.CallLogWhereInput = {
    organizationId,
    AND: [visibility],
    deleted: false,
    ...(agentId && { agentId }),
    ...(status && { status }),
    // Older SIP/callback writers used uppercase values. Accept both forms so
    // filtering does not hide records that the read path normalizes.
    ...(direction && { direction: { in: [direction, direction.toUpperCase()] } }),
    ...(args.provider === "aliyun" && {
      OR: ["ALIYUN", "ALIYUN_AICCS", "ALIYUN_ENGINE", "HAOKEHU_SIP", "HAOKEHU_CALLBACK"].map(provider => ({ metadata: { path: ["provider"], equals: provider } })),
    }),
    ...((from || to) && {
      startTime: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    }),
  };

  if (args.intent || args.wechatStage || filterReviewStatus || args.phoneNumber || filterDuration) {
    // Filter before pagination. Keep the same authenticated ownership predicate
    // on both the bounded SQL candidate query and the final Prisma read.
    const owner=visibility.userId;
    if(owner!==undefined&&typeof owner!=='string')throw new BadRequestError('通话权限范围无效。');
    const conditions=[Prisma.sql`l."organizationId"=${organizationId}`,Prisma.sql`l."deleted"=false`];
    if(owner)conditions.push(Prisma.sql`l."userId"=${owner}`);
    if(agentId)conditions.push(Prisma.sql`l."agentId"=${agentId}`);
    if(status)conditions.push(Prisma.sql`l."status"::text=${status}`);
    if (filterReviewStatus) {
      const needsReview = Prisma.sql`EXISTS (SELECT 1 FROM "SipAttempt" a WHERE a."workspaceId"=l."organizationId" AND a."id"=l."callId" AND a."status"='NEEDS_REVIEW')`;
      conditions.push(reviewOnly ? needsReview : Prisma.sql`NOT ${needsReview}`);
    } if (direction) conditions.push(Prisma.sql`lower(l."direction")=${direction}`);
    if(from)conditions.push(Prisma.sql`l."startTime">=${new Date(from)}`);
    if(to)conditions.push(Prisma.sql`l."startTime"<=${new Date(to)}`);
    if(args.provider==='aliyun')conditions.push(Prisma.sql`l."metadata"->>'provider' IN ('ALIYUN','ALIYUN_AICCS','ALIYUN_ENGINE','HAOKEHU_SIP','HAOKEHU_CALLBACK')`);
    if (filterDuration) {
      // Apply the displayed duration before LIMIT/cursor pagination. Most calls
      // use the stored integer; legacy rows use normalizeCallLog's fallbacks.
      const duration = Prisma.sql`COALESCE(l."durationSeconds",
        CASE WHEN jsonb_typeof(l."metadata"->'durationSeconds')='number'
          THEN GREATEST(0, round((l."metadata"->>'durationSeconds')::numeric)) END,
        CASE WHEN l."startTime" IS NOT NULL AND l."endTime" IS NOT NULL
          AND upper(COALESCE(l."metadata"->>'provider','')) NOT IN ('HAOKEHU_SIP','HAOKEHU_CALLBACK','ALIYUN_ENGINE','ALIYUN_AICCS','ALIYUN')
          THEN GREATEST(0, round(EXTRACT(EPOCH FROM (l."endTime"-l."startTime")))) END)`;
      if (args.minDuration !== undefined) conditions.push(Prisma.sql`${duration}>=${args.minDuration}`);
      if (args.maxDuration !== undefined) conditions.push(Prisma.sql`${duration}<${args.maxDuration}`);
    }
    if (args.phoneNumber) {
      // Match normalizeCallLog's external-number selection: preserve a stored
      // callerId (including an empty string), otherwise use direction-aware
      // metadata with the same from/to fallback and string-only values.
      const trimCharacters = '\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
      const fromNumber = Prisma.sql`CASE WHEN jsonb_typeof(l."metadata"->'fromNumber')='string'
        THEN NULLIF(btrim(l."metadata"->>'fromNumber', ${trimCharacters}), '') END`;
      const toNumber = Prisma.sql`CASE WHEN jsonb_typeof(l."metadata"->'toNumber')='string'
        THEN NULLIF(btrim(l."metadata"->>'toNumber', ${trimCharacters}), '') END`;
      const rawDirection = Prisma.sql`lower(btrim(COALESCE(NULLIF(l."direction", ''),
        CASE WHEN jsonb_typeof(l."metadata"->'direction')='string' THEN l."metadata"->>'direction' END), ${trimCharacters}))`;
      const externalNumber = Prisma.sql`COALESCE(l."callerId",
        CASE WHEN ${rawDirection}='inbound' THEN ${fromNumber} ELSE ${toNumber} END,
        ${fromNumber}, ${toNumber}, '')`;
      conditions.push(Prisma.sql`strpos(regexp_replace(${externalNumber}, '[^0-9]', '', 'g'), ${args.phoneNumber})>0`);
    }
    if(args.intent)conditions.push(Prisma.sql`CASE WHEN c."intent"='interested'
      AND c."profile"->'intentConfirmation'->>'source'='admin-confirmed'
      AND c."profile"->'intentConfirmation'->>'active'='true'
      AND c."profile"->'intentConfirmation'->>'relatedCallId'=l."callId"
      THEN 'interested' ELSE COALESCE(k."intent",'unclear') END=${args.intent}`);
    if(args.wechatStage){
      const access=args.viewerId?await companyContext(organizationId,args.viewerId):null;
      const canManage=!!access?.allData&&grants(access.permissions,'crm','assign');
      conditions.push(Prisma.sql`c."stage"=${args.wechatStage}`);
      if(args.viewerId&&!canManage)conditions.push(Prisma.sql`c."ownerId"=${args.viewerId}`);
    }
    if(cursor)conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "CallLog" p WHERE p."callId"=${cursor} AND p."organizationId"=${organizationId} AND p."deleted"=false AND
      (l."startTime"<p."startTime" OR (l."startTime"=p."startTime" AND l."callId"<p."callId") OR
      (p."startTime" IS NULL AND (l."startTime" IS NOT NULL OR (l."startTime" IS NULL AND l."callId"<p."callId")))))`);
    const candidates=await prisma.$queryRaw<{callId:string}[]>(Prisma.sql`SELECT l."callId" FROM "CallLog" l
      LEFT JOIN "CustomerIntentCall" k ON k."workspaceId"=l."organizationId" AND k."callId"=l."callId"
      LEFT JOIN "CustomerIntentCustomer" c ON c."workspaceId"=k."workspaceId" AND c."phone"=k."phone"
      WHERE ${Prisma.join(conditions,' AND ')} ORDER BY l."startTime" DESC,l."callId" DESC LIMIT ${limit+1}`);
    return prisma.callLog.findMany({where:{...where,callId:{in:candidates.map(row=>row.callId)}},orderBy:[{startTime:'desc'},{callId:'desc'}],take:limit+1});
  }

  // Over-fetch by 1 so the service can decide whether a next page exists
  // without a second count query. Cursor pagination is stable because
  // (startTime, callId) is a total order.
  return prisma.callLog.findMany({
    where,
    orderBy: [{ startTime: "desc" }, { callId: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { callId: cursor }, skip: 1 }),
  });
};

export const getCallByIdForOrg = async (
  callId: string,
  organizationId: string,
  viewerId?: string,
) => {
  // findFirst with the composite {callId, organizationId} predicate prevents
  // callers from reading a row that belongs to another org.
  return prisma.callLog.findFirst({
    where: { callId, organizationId, deleted: false, AND:[await callVisibilityWhere(organizationId,viewerId)] },
  });
};

export const getCallForDeletion = async (
  callId: string,
  organizationId: string,
  viewerId?: string,
) =>
  prisma.callLog.findFirst({
    where: { callId, organizationId, deleted: false, AND:[await callVisibilityWhere(organizationId,viewerId)] },
    select: {
      callId: true,
      audioRecordingPath: true,
    },
  });

export const getTranscriptsByCallId = async (args: ListTranscriptsArgs & {viewerId?:string}) => {
  const { callId, organizationId, limit, cursor } = args;

  // Join through callLog so a transcript belonging to another org or a
  // soft-deleted call is never returned.
  return prisma.callTranscript.findMany({
    where: {
      callLogId: callId,
      callLog: { organizationId, deleted: false, AND:[await callVisibilityWhere(organizationId,args.viewerId)] },
    },
    orderBy: { timestamp: "asc" },
    take: limit + 1,
    ...(cursor && { cursor: { callTransId: cursor }, skip: 1 }),
  });
};

export const liveRoomBelongsToOrg = async (
  organizationId: string,
  roomName: string,
  countOwnedRoom: (where: {
    organizationId: string;
    roomName: string;
  }) => Promise<number> = (where) =>
    prisma.callBillingSession.count({ where }),
) => {
  if (roomName.startsWith("widget_")) {
    return widgetRoomBelongsToOrg(organizationId, roomName);
  }

  if (roomName.startsWith("outbound_")) {
    const outboundId = roomName.slice("outbound_".length);
    const count = await prisma.outboundCall.count({
      where: { outboundId, organizationId },
    });
    return count > 0;
  }

  const count = await countOwnedRoom({ organizationId, roomName });
  return count > 0;
};

export const listAgentNamesForOrg = async (
  organizationId: string,
  agentIds: string[],
) => {
  if (agentIds.length === 0) return [];
  return prisma.agent.findMany({
    where: {
      organizationId,
      agentId: { in: agentIds },
    },
    select: { agentId: true, name: true },
  });
};

export const deleteCallLog = async (
  callId: string,
  organizationId: string,
  expectedRecordingPath: string | null,
) => {
  return prisma.$transaction(async (tx) => {
    const result = await tx.callLog.updateMany({
      where: {
        callId,
        organizationId,
        deleted: false,
        audioRecordingPath: expectedRecordingPath,
      },
      data: {
        deleted: true,
        audioRecordingPath: null,
        callerId: null,
        metadata: Prisma.JsonNull,
        dataExtracted: [],
        dataEvaluation: [],
      },
    });
    if (result.count === 0) return false;

    await tx.callTranscript.deleteMany({
      where: { callLogId: callId },
    });
    return true;
  });
};
