/*
 * 中文导读：阿里云连接：agent-console.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import prisma from "../../config/prisma.js";
import {
  connection,
  getConnection,
  ownedAgent,
  cloudResources,
} from "./aliyun.service.js";
import { aiccsClient, aiccsModels as M } from "./aiccs.client.js";
import { cloudData, rpcRuntime } from "./aliyun.client.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { companyContext } from "../workspace/company-access.js";
import { communicationProfileSchema } from "./aliyun.schema.js";
import { profileInstructions } from "./cloud-settings.service.js";

export async function agentStatus(
  organizationId: string,
  id: string,
  userId: string,
  includeResults = false,
) {
  const [agent, config, context] = await Promise.all([
    ownedAgent(organizationId, id),
    getConnection(organizationId),
    companyContext(organizationId, userId),
  ]);
  const explicit =
    config.product === "aiccs"
      ? config.communicationBindings[id]
      : config.bindings[id];
  const binding =
    config.product === "aiccs"
      ? config.communicationBindings[id] || {
          agentId: config.communicationAgentId,
          branchId: config.branchId,
          versionId: config.versionId,
        }
      : { agentId: config.bindings[id] || config.defaultScriptId };
  const [knowledgeCount, callsCount, completed, recent, rule] =
    await Promise.all([
      prisma.workspaceKnowledge.count({
        where: {
          organizationId,
          enabled: true,
          OR: [{ agentId: null }, { agentId: id }],
        },
      }),
      prisma.callLog.count({
        where: { organizationId, agentId: id, deleted: false },
      }),
      prisma.callLog.count({
        where: {
          organizationId,
          agentId: id,
          deleted: false,
          status: "COMPLETED",
        },
      }),
      includeResults ? prisma.callLog.findMany({
        where: { organizationId, agentId: id, deleted: false },
        orderBy: [{ endTime: "desc" }, { startTime: "desc" }],
        take: 20,
        select: {
          callId: true,
          callerId: true,
          status: true,
          durationSeconds: true,
          startTime: true,
          endTime: true,
          audioRecordingPath: true,
          _count: { select: { transcripts: true } },
        },
      })
      : Promise.resolve([]),
      prisma.automationRule.findFirst({
        where: { organizationId, kind: "CALL_SUMMARY" },
        select: { enabled: true },
      }),
    ]);
  const runs = recent.length
    ? await prisma.automationRun.findMany({
        where: {
          organizationId,
          kind: "CALL_SUMMARY",
          sourceId: { in: recent.map((c) => c.callId) },
        },
        select: { sourceId: true, status: true, error: true },
      })
    : [];
  const missing = [
    !agent.isActive ? "本系统智能体已暂停" : null,
    !config.hasAccessKey ? "阿里云 AccessKey" : null,
    !binding.agentId ? "云端智能体或话术绑定" : null,
    config.product !== "aiccs" && !config.instanceId ? "外呼实例 ID" : null,
    !config.callerNumbers.length ? "审核通过的主叫号码" : null,
    !config.liveEnabled ? "真实外呼开关未启用" : null,
  ].filter((x): x is string => !!x);
  return {
    product: config.product,
    binding,
    bindingSource: explicit ? "independent" : "workspace",
    canManage: context.canManage,
    sharedBindingCount:
      config.product === "aiccs"
        ? await prisma.agent
            .findMany({
              where: {
                organizationId,
                deletionRequestedAt: null,
                agentId: { not: id },
              },
              select: { agentId: true },
            })
            .then((agents) =>
              binding.agentId
                ? agents.filter(
                    (a) =>
                      (config.communicationBindings[a.agentId]?.agentId ||
                        config.communicationAgentId) === binding.agentId,
                  ).length
                : 0,
            )
        : 0,
    knowledgeCount,
    callsCount,
    completed,
    callerCount: config.callerNumbers.length,
    concurrency: config.concurrency,
    callbackReady: config.callbackReady,
    hasAccessKey: config.hasAccessKey,
    hasDashscopeKey: config.hasDashscopeKey,
    liveEnabled: config.liveEnabled,
    regionId: config.regionId,
    model: config.model,
    missing,
    summaryEnabled: rule?.enabled || false,
    recent: recent.map((c) => ({
      id: c.callId,
      phone: c.callerId,
      status: c.status,
      duration: c.durationSeconds || 0,
      time: c.endTime || c.startTime,
      hasRecording: !!c.audioRecordingPath,
      hasTranscript: c._count.transcripts > 0,
      summary:
        runs.find((r) => r.sourceId === c.callId)?.status || "NOT_STARTED",
      summaryError: runs.find((r) => r.sourceId === c.callId)?.error || null,
    })),
  };
}
export async function agentCloud(organizationId: string, id: string) {
  await ownedAgent(organizationId, id);
  const { settings, credentials } = await connection(organizationId);
  if (settings.product !== "aiccs") {
    const resources = await cloudResources(organizationId);
    const script = settings.bindings[id] || settings.defaultScriptId;
    const found = resources.scripts.find((s) => s.id === script);
    return {
      agentId: script,
      name: found?.name || script,
      published: !!found,
      matchesBinding: !!found,
      checkedAt: new Date().toISOString(),
      branchId: "",
      versionId: "",
      prologue: "",
      voice: "",
      sessionTimeout: null,
      muteDuration: null,
      muteHangupNum: null,
      transferEnabled: null,
      ragEnabled: null,
    };
  }
  const binding = settings.communicationBindings[id] || {
    agentId: settings.communicationAgentId,
    branchId: settings.branchId,
    versionId: settings.versionId,
  };
  if (!binding.agentId)
    throw new BadRequestError("请先绑定当前智能体的云端 ID。");
  const detail = await cloudData(() =>
    aiccsClient(
      settings.regionId,
      credentials,
    ).queryAiVoiceAgentDetailNewWithOptions(
      new M.QueryAiVoiceAgentDetailNewRequest({ agentId: binding.agentId }),
      rpcRuntime(),
    ),
  );
  return {
    agentId: binding.agentId,
    name: detail.agentName || binding.agentId,
    published:
      detail.branchDeployStatus === 1 && detail.versionPublishStatus === 1,
    matchesBinding:
      (!binding.branchId || binding.branchId === String(detail.branchId)) &&
      (!binding.versionId || binding.versionId === String(detail.versionId)),
    checkedAt: new Date().toISOString(),
    branchId: String(detail.branchId || ""),
    versionId: String(detail.versionId || ""),
    prologue: detail.agentCallConfig?.prologue || "",
    voice: detail.agentCallConfig?.ttsConfig?.voiceCode || "",
    sessionTimeout: detail.agentCallConfig?.eventConfig?.sessionTimeout ?? null,
    muteDuration: detail.agentCallConfig?.eventConfig?.muteDuration ?? null,
    muteHangupNum: detail.agentCallConfig?.eventConfig?.muteHangupNum ?? null,
    transferEnabled: detail.agentCallConfig?.transferConfig?.enabled ?? null,
    ragEnabled: detail.knowledgeConfig?.ragConfig?.enabled ?? null,
  };
}
export async function scriptExport(organizationId: string, id: string) {
  const [agent, { settings }, knowledge] = await Promise.all([
    ownedAgent(organizationId, id),
    connection(organizationId),
    prisma.workspaceKnowledge.findMany({
      where: {
        organizationId,
        enabled: true,
        OR: [{ agentId: null }, { agentId: id }],
      },
      orderBy: { updatedAt: "desc" },
      select: { title: true, content: true },
    }),
  ]);
  const placeholders =
    (
      agent.configuration?.variables as {
        placeholders?: Record<string, string>;
      } | null
    )?.placeholders || {};
  const resolve = (s: string) =>
    s.replace(
      /\{\{\s*([^{}]+?)\s*\}\}/g,
      (token, name: string) => placeholders[name]?.trim() || token,
    );
  const content = [
    `智能体：${agent.name}`,
    `导出时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    "这是网页保存的准备稿。请在阿里云控制台配置话术、业务知识和转人工，发布生效后再回此页核验。导出不会同步或发布云端。未替换变量需要在云端配置。",
    "【开场白】",
    resolve(agent.configuration?.firstMessage || "尚未设置"),
    "【完整沟通话术】",
    resolve(agent.configuration?.systemPrompt || "尚未设置"),
    profileInstructions(communicationProfileSchema.parse(agent.configuration?.communicationProfile || {})),
    `【期望音色】\n${communicationProfileSchema.parse(agent.configuration?.communicationProfile || {}).voiceName || "跟随云端配置"}\n音色编码：${communicationProfileSchema.parse(agent.configuration?.communicationProfile || {}).voiceCode || "未指定"}\n这是网页选择；实际电话须在云端设置并发布。`,
    "【公司已确认资料】",
    settings.approvedKnowledge || "尚未填写",
    ...knowledge.flatMap((k) => [`【知识：${k.title}】`, k.content]),
  ].join("\n\n");
  return { name: agent.name, content };
}
