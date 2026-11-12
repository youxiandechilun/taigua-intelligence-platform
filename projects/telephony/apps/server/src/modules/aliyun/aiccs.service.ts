/*
 * 中文导读：阿里云连接：aiccs.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {linkExistingCall} from "../crm/crm.calls.js";
import {crmDb} from "../crm/crm.db.js";
import prisma from "../../config/prisma.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { requireUnifiedOutbound } from "./legacy-task-policy.js";
import { NotFoundError } from "../../common/errors/notFound.js";
import {
  cloudData,
  rpcRuntime,
  type CloudCredentials,
} from "./aliyun.client.js";
import { aiccsClient, aiccsModels as M } from "./aiccs.client.js";
import {
  connection,
  getConnection,
  ownedAgent,
  type Recipient,
  type Settings,
} from "./aliyun.service.js";
import { recordAuditEvent } from "../audit/audit-log.service.js";
import { randomUUID } from "node:crypto";
import type {
  AliyunTask,
  Prisma,
} from "../../../prisma/generated/prisma/client.js";
import { executionPolicy, type TaskInput } from "./aliyun.schema.js";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Binding = { agentId: string; branchId?: string; versionId?: string };
const taskName = (task: AliyunTask) => `${task.name} [${task.id}]`;
const defaultBinding = (settings: Settings): Binding => ({
  agentId: settings.communicationAgentId,
  branchId: settings.branchId,
  versionId: settings.versionId,
});
const snapshotBinding = (task: AliyunTask): Binding => ({
  agentId: task.cloudAgentId || "",
  branchId: task.cloudBranchId || undefined,
  versionId: task.cloudVersionId || undefined,
});

export async function verifyBinding(
  settings: Pick<Settings, "regionId">,
  credentials: CloudCredentials,
  binding: Binding,
) {
  if (!binding.agentId) throw new BadRequestError("请先配置通信智能体 ID。");
  const client = aiccsClient(settings.regionId, credentials);
  // Task creation uses the active branch, so compare the active published version.
  const active = await cloudData(() =>
    client.queryAiVoiceAgentDetailNewWithOptions(
      new M.QueryAiVoiceAgentDetailNewRequest({ agentId: binding.agentId }),
      rpcRuntime(),
    ),
  );
  if (active.branchDeployStatus !== 1 || active.versionPublishStatus !== 1)
    throw new BadRequestError("云端智能体尚未发布并生效，请先完成发布和拨测。");
  if (
    (binding.branchId && String(active.branchId) !== binding.branchId) ||
    (binding.versionId && String(active.versionId) !== binding.versionId)
  )
    throw new BadRequestError(
      "绑定的分支或版本与云端生效版本不同，请更新绑定。",
    );
  return active;
}
export async function resources(
  settings: Settings,
  credentials: CloudCredentials,
) {
  const b = defaultBinding(settings);
  if (!b.agentId) throw new BadRequestError("请先保存通信智能体 ID。");
  const client = aiccsClient(settings.regionId, credentials);
  const detail = await cloudData(() =>
    client.queryAiVoiceAgentDetailNewWithOptions(
      new M.QueryAiVoiceAgentDetailNewRequest({
        agentId: b.agentId,
        branchId: b.branchId || undefined,
        versionId: b.versionId || undefined,
      }),
      rpcRuntime(),
    ),
  );
  const published =
    detail.branchDeployStatus === 1 && detail.versionPublishStatus === 1;
  return {
    instance: {
      id: b.agentId,
      name: detail.agentName,
      concurrency: settings.concurrency,
    },
    scripts: [
      {
        id: b.agentId,
        name: detail.agentName,
        status: published ? "已发布并生效" : "草稿或未生效",
      },
    ],
    total: 1,
    published,
    branchId: String(detail.branchId ?? ""),
    versionId: String(detail.versionId ?? ""),
  };
}
export async function saveBinding(
  organizationId: string,
  agentId: string,
  binding: Binding,
) {
  await ownedAgent(organizationId, agentId);
  const { settings } = await connection(organizationId);
  if (settings.product !== "aiccs")
    throw new BadRequestError("请先选择通信智能体产品。");
  if (binding.versionId && !binding.branchId)
    throw new BadRequestError("指定版本时也需要分支 ID。");
  // Draft bindings are saved without implying provider verification.
  const saved =
    await prisma.$executeRaw`UPDATE "AliyunConnection" SET "settings" = jsonb_set("settings", '{communicationBindings}', COALESCE("settings"->'communicationBindings', '{}'::jsonb) || ${JSON.stringify({ [agentId]: binding })}::jsonb), "updatedAt" = NOW() WHERE "organizationId" = ${organizationId}`;
  if (!saved)
    throw new BadRequestError("请先保存工作区阿里云配置，再关联智能体。");
  return getConnection(organizationId);
}
export async function createTask(
  organizationId: string,
  userId: string,
  input: TaskInput,
  settings: Settings,
) {
  requireUnifiedOutbound();
  const binding =
    settings.communicationBindings[input.agentId] || defaultBinding(settings);
  if (!binding.agentId) throw new BadRequestError("请先绑定通信智能体。");
  if (!settings.callerNumbers.includes(input.callerNumber))
    throw new BadRequestError("请选择已配置的主叫服务号码。");
  if (Date.parse(input.endTime) <= Date.now())
    throw new BadRequestError("任务结束时间已过期。");
  const seen = new Set<string>();
  const recipients = input.recipients
    .filter((r) => !seen.has(r.phoneNumber) && !!seen.add(r.phoneNumber))
    .map((r) => ({ ...r, referenceId: randomUUID() }));
  const task = await prisma.aliyunTask.create({
    data: {
      organizationId,
      agentId: input.agentId,
      provider: "aiccs",
      cloudAgentId: binding.agentId,
      cloudBranchId: binding.branchId || null,
      cloudVersionId: binding.versionId || null,
      name: input.name,
      regionId: settings.regionId,
      instanceId: "",
      scriptId: "",
      callerNumber: input.callerNumber,
      recipients: json(recipients),
      executionPolicy: json({ ...settings.dialPolicy, concurrency: settings.concurrency, createdByUserId: userId }),
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
    },
  });
  await recordAuditEvent({
    organizationId,
    userId,
    action: "aliyun.task.draft",
    resourceType: "aliyunTask",
    resourceId: task.id,
    metadata: { count: recipients.length, product: "aiccs" },
  });
  return task;
}
async function context(task: AliyunTask) {
  const { settings, credentials } = await connection(task.organizationId);
  if (settings.product !== "aiccs" || settings.regionId !== task.regionId)
    throw new BadRequestError("任务产品或地域与当前配置不同，请恢复原配置。");
  return {
    settings,
    credentials,
    client: aiccsClient(task.regionId, credentials),
  };
}
export async function publishTask(task: AliyunTask, userId: string) {
  requireUnifiedOutbound();
  if (task.status !== "DRAFT") throw new BadRequestError("仅草稿可以核验。");
  const { settings, credentials } = await context(task);
  const active = await verifyBinding(
    settings,
    credentials,
    snapshotBinding(task),
  );
  if (task.endTime.getTime() <= Date.now())
    throw new BadRequestError("任务时间已过期。");
  if (!settings.callerNumbers.includes(task.callerNumber))
    throw new BadRequestError("主叫号码已从配置移除。");
  const claim = await prisma.aliyunTask.updateMany({
    where: { id: task.id, status: "DRAFT" },
    data: {
      status: "PREPARED",
      cloudBranchId: String(active.branchId),
      cloudVersionId: String(active.versionId),
      errorMessage: null,
    },
  });
  if (!claim.count) throw new BadRequestError("任务状态已改变，请刷新。");
  await recordAuditEvent({
    organizationId: task.organizationId,
    userId,
    action: "aliyun.task.prepared",
    resourceType: "aliyunTask",
    resourceId: task.id,
  });
  return prisma.aliyunTask.findUniqueOrThrow({ where: { id: task.id } });
}
function chinaDate(date: Date) {
  return new Date(date.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
export async function startTask(
  task: AliyunTask,
  userId: string,
  confirmation: string,
) {
  requireUnifiedOutbound();
  if (confirmation !== task.id || task.status !== "PREPARED" || task.remoteId)
    throw new BadRequestError("仅已核验且明确确认的任务可启动。");
  const { settings, credentials, client } = await context(task);
  if (!settings.liveEnabled) throw new BadRequestError("真实外呼尚未启用。");
  if (!settings.callerNumbers.includes(task.callerNumber))
    throw new BadRequestError("主叫号码已从配置移除。");
  const local = await ownedAgent(task.organizationId, task.agentId);
  if (!local.isActive) throw new BadRequestError("智能体已停用。");
  await verifyBinding(settings, credentials, snapshotBinding(task));
  const start = Math.max(Date.now() + 300000, task.startTime.getTime());
  if (start >= task.endTime.getTime())
    throw new BadRequestError("导入需要预留 5 分钟，请延长结束时间。");
  const claim = await prisma.aliyunTask.updateMany({
    where: { id: task.id, status: "PREPARED", remoteId: null },
    data: { status: "SUBMITTING", errorMessage: null },
  });
  if (!claim.count) throw new BadRequestError("任务正在提交，请勿重复启动。");
  let remoteId: string | undefined;
  try {
    const policy = executionPolicy(task.executionPolicy);
    const remote = await cloudData(() =>
      client.createAiCallTaskWithOptions(
        new M.CreateAiCallTaskRequest({
          taskName: taskName(task),
          agentId: task.cloudAgentId!,
          virtualNumber: task.callerNumber,
          source: 0,
          phoneType: 0,
          taskCps: policy.concurrency,
          startType: "SCHEDULE",
          taskStartTime: start,
          callDay: policy.days,
          callTime: [
            JSON.stringify({ startTime: `${policy.start}:00`, endTime: `${policy.end}:00` }),
          ],
          missCallRetry: policy.retries > 0,
          callRetryTimes: policy.retries,
          callRetryInterval: policy.retryIntervalMinutes,
          callExpireType: 2,
          callExpireDate: chinaDate(task.endTime),
        }),
        rpcRuntime(),
      ),
    );
    if (
      typeof remote !== "number" ||
      !Number.isSafeInteger(remote) ||
      remote <= 0
    )
      throw new BadRequestError("云端未返回有效任务 ID，请人工核对任务名称。");
    remoteId = String(remote);
    await prisma.aliyunTask.update({
      where: { id: task.id },
      data: { remoteId },
    });
    const recipients = task.recipients as unknown as Recipient[];
    for (let i = 0; i < recipients.length; i += 1000) {
      if (Date.now() + 30000 >= start)
        throw new BadRequestError("导入超过预留时间，需停止并核对任务。");
      await cloudData(() =>
        client.importTaskNumberDatasWithOptions(
          new M.ImportTaskNumberDatasRequest({
            taskId: remoteId!,
            dataType: "JSON",
            encryptionType: 0,
            phoneNumberList: recipients
              .slice(i, i + 1000)
              .map((r) => ({
                ...r.variables,
                calleeNumber: r.phoneNumber,
                outId: r.referenceId,
              })),
          }),
          rpcRuntime(),
        ),
      );
    }
    const updated = await prisma.aliyunTask.update({
      where: { id: task.id },
      data: { status: "SUBMITTED", startTime: new Date(start) },
    });
    await recordAuditEvent({
      organizationId: task.organizationId,
      userId,
      action: "aliyun.task.submitted",
      resourceType: "aliyunTask",
      resourceId: task.id,
      metadata: { confirmed: true, product: "aiccs" },
    });
    return updated;
  } catch (error) {
    if (remoteId) {
      try {
        await cloudData(() =>
          client.stopAiCallTaskWithOptions(
            new M.StopAiCallTaskRequest({ taskId: remoteId }),
            rpcRuntime(),
          ),
        );
      } catch {
        /* Never retry an uncertain dial mutation automatically. */
      }
    }
    await prisma.aliyunTask.update({
      where: { id: task.id },
      data: {
        status: "NEEDS_REVIEW",
        errorMessage:
          "创建或导入结果未确认；已尝试停止已知任务。请在云端按名称核对，勿重复启动。",
      },
    });
    throw error;
  }
}
export async function stopTask(task: AliyunTask, userId: string) {
  if (!task.remoteId) throw new BadRequestError("任务尚未关联云端。");
  const { client } = await context(task);
  const stopped = await cloudData(() =>
    client.stopAiCallTaskWithOptions(
      new M.StopAiCallTaskRequest({ taskId: task.remoteId! }),
      rpcRuntime(),
    ),
  );
  if (stopped !== true) throw new BadRequestError("云端未确认任务已停止。");
  await recordAuditEvent({
    organizationId: task.organizationId,
    userId,
    action: "aliyun.task.stopped",
    resourceType: "aliyunTask",
    resourceId: task.id,
  });
  return prisma.aliyunTask.update({
    where: { id: task.id },
    data: { status: "STOPPED", errorMessage: null },
  });
}
export async function syncTask(task: AliyunTask) {
  if (!task.remoteId) throw new BadRequestError("任务未关联云端。");
  const { client } = await context(task);
  const recipients = task.recipients as unknown as Recipient[];
  const owned = new Map(recipients.map((r) => [r.referenceId, r]));
  const results: Array<Record<string, unknown>> = [];
  for (const status of [0, 1, 2]) {
    for (let page = 1; page <= Math.ceil(recipients.length / 100) + 1; page++) {
      const batch = await cloudData(() =>
        client.queryAiCallDetailPageWithOptions(
          new M.QueryAiCallDetailPageRequest({
            taskId: task.remoteId!,
            status,
            pageNo: page,
            pageSize: 100,
          }),
          rpcRuntime(),
        ),
      );
      const items = batch.list || [];
      for (const item of items) {
        const recipient = item.outId && owned.get(item.outId);
        if (!recipient || item.calledNumber !== recipient.phoneNumber) continue;
        const terminal = item.status === 4 || item.status === 5;
        const localStatus =
          item.status === 5
            ? "FAILED"
            : terminal
              ? item.callResult === "ANSWERED" ||
                (item.conversationDuration || 0) > 0
                ? "COMPLETED"
                : "NOT_ANSWERED"
              : item.status === 3
                ? "IN_PROGRESS"
                : "SCHEDULED";
        results.push({
          referenceId: item.outId,
          phoneNumber: recipient.phoneNumber,
          state: item.callResult || String(item.status ?? ""),
          status: localStatus,
          sessionId: item.callId,
          talkTime: item.conversationDuration || 0,
          disposition: item.majorIntent,
        });
        if (terminal && item.callId)
          await saveCall(task, recipient, {
            callId: item.callId,
            duration: item.conversationDuration || 0,
            status:
              item.status === 5
                ? "FAILED"
                : item.callResult === "ANSWERED" ||
                    (item.conversationDuration || 0) > 0
                  ? "COMPLETED"
                  : "NOT_ANSWERED",
            startTime: item.callingTime
              ? new Date(item.callingTime)
              : undefined,
            recording: item.recordingFilePath,
            conversation: item.conversationRecord,
            intent: item.majorIntent,
          });
      }
      if (items.length < 100) break;
    }
  }
  const terminalRefs = new Set(
    results
      .filter((r) =>
        ["COMPLETED", "FAILED", "NOT_ANSWERED"].includes(String(r.status)),
      )
      .map((r) => r.referenceId),
  );
  return prisma.aliyunTask.update({
    where: { id: task.id },
    data: {
      results: json(results),
      syncedAt: new Date(),
      status:
        task.status === "NEEDS_REVIEW" || task.status === "STOPPED"
          ? task.status
          : terminalRefs.size === recipients.length
            ? "COMPLETED"
            : task.status,
      errorMessage: task.status === "NEEDS_REVIEW" ? task.errorMessage : null,
    },
  });
}
type CallData = {
  callId: string;
  duration: number;
  status: "COMPLETED" | "FAILED" | "NOT_ANSWERED";
  startTime?: Date;
  endTime?: Date;
  recording?: string;
  conversation?: string;
  intent?: string;
  note?: unknown;
};
export async function saveCall(
  task: AliyunTask,
  recipient: Recipient,
  data: CallData,
) {
  let safeRecording: string | undefined;
  if (data.recording) {
    try {
      const url = new URL(data.recording);
      if (
        url.protocol === "http:" &&
        url.hostname.endsWith(".oss.aliyuncs.com")
      )
        url.protocol = "https:";
      if (url.protocol === "https:" && !url.username && !url.password)
        safeRecording = url.href;
    } catch {
      /* Invalid URLs are not rendered. */
    }
  }
  await prisma.$transaction(async (tx) => {
    // Reference IDs are generated by this service and tie results to a single workspace.
    const existing = await tx.callLog.findUnique({
      where: { callId: recipient.referenceId },
    });
    if (
      existing?.deleted ||
      (existing && existing.organizationId !== task.organizationId)
    )
      return;
    const agent = await tx.agent.findFirst({
      where: { agentId: task.agentId, organizationId: task.organizationId },
      select: { agentId: true },
    });
    const metadata = {
      ...((existing?.metadata as object) || {}),
      provider: "ALIYUN_AICCS",
      taskId: task.id,
      fromNumber: task.callerNumber,
      toNumber: recipient.phoneNumber,
      cloudCallId: data.callId,
      ...(data.intent ? { intent: data.intent } : {}),
      ...(data.note ? { note: data.note } : {}),
    };
    const fields = {
      status: data.status,
      sessionId: data.callId,
      durationSeconds: data.duration,
      startTime: data.startTime,
      endTime:
        data.endTime ||
        (data.startTime
          ? new Date(data.startTime.getTime() + data.duration * 1000)
          : undefined),
      audioRecordingPath: safeRecording,
      metadata: json(metadata),
    };
    await tx.callLog.upsert({
      where: { callId: recipient.referenceId },
      create: {
        ...fields,
        callId: recipient.referenceId,
        organizationId: task.organizationId,
        agentId: agent?.agentId || null,
        callerId: recipient.phoneNumber,
        direction: "outbound",
      },
      update: fields,
    });
    if (!existing)
      await tx.agent.updateMany({
        where: { agentId: task.agentId, organizationId: task.organizationId },
        data: { callLogsCount: { increment: 1 } },
      });
    if (data.conversation) {
      let rows: unknown;
      try {
        rows = JSON.parse(data.conversation);
      } catch {
        rows = null;
      }
      if (
        Array.isArray(rows) &&
        rows.every(
          (r) =>
            r &&
            typeof r.content === "string" &&
            ["user", "assistant"].includes(r.role),
        )
      ) {
        await tx.callTranscript.deleteMany({
          where: { callLogId: recipient.referenceId },
        });
        await tx.callTranscript.createMany({
          data: rows.map((r, i) => ({
            callLogId: recipient.referenceId,
            speaker: r.role === "user" ? "user" : "agent",
            messageText: r.content,
            timestamp: new Date(
              (data.startTime?.getTime() ||
                existing?.startTime?.getTime() ||
                task.createdAt.getTime()) + i,
            ),
          })),
        });
      }
    }
  });
  await linkExistingCall(crmDb, task.organizationId, recipient.referenceId).catch(()=>console.warn("[crm] call association pending"));
}
export async function callDetail(task: AliyunTask, sessionId: string) {
  const row = await prisma.callLog.findFirst({
    where: { organizationId: task.organizationId, sessionId, deleted: false },
    include: { transcripts: { orderBy: { timestamp: "asc" } } },
  });
  if (!row || (row.metadata as { taskId?: string })?.taskId !== task.id)
    throw new NotFoundError("请先同步此任务的通话结果。");
  const meta = row.metadata as { intent?: string };
  return {
    phoneNumber: row.callerId || "",
    duration: row.durationSeconds || 0,
    transcripts: row.transcripts.map((t) => ({
      speaker: t.speaker === "user" ? "客户" : "智能体",
      text: t.messageText,
    })),
    labels: meta.intent ? [{ name: "意向", value: meta.intent }] : [],
    recordingUrl: row.audioRecordingPath || undefined,
    recordingUnavailable: !row.audioRecordingPath,
  };
}
export async function reconcileTask(task: AliyunTask, remoteId: string) {
  if (!/^[0-9]+$/.test(remoteId))
    throw new BadRequestError("通信智能体任务 ID 应为数字。");
  const { client } = await context(task);
  const remote = await cloudData(() =>
    client.queryAiCallTaskDetailWithOptions(
      new M.QueryAiCallTaskDetailRequest({ taskId: remoteId }),
      rpcRuntime(),
    ),
  );
  if (
    remote.taskName !== taskName(task) ||
    String(remote.agentId) !== task.cloudAgentId ||
    remote.callerNumber !== task.callerNumber
  )
    throw new BadRequestError("云端任务名称、智能体或主叫不匹配。");
  const updated = await prisma.aliyunTask.update({
    where: { id: task.id },
    data: { remoteId },
  });
  // Preserve NEEDS_REVIEW: unknown submission is never treated as safe to re-submit.
  return syncTask(updated);
}
