/*
 * 中文导读：阿里云连接：cloud-settings.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { z } from "zod";
import prisma from "../../config/prisma.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import CustomApiError from "../../common/errors/customApiError.js";
import { recordAuditEvent } from "../audit/audit-log.service.js";
import { connection, ownedAgent } from "./aliyun.service.js";
import { aiccsClient, aiccsModels as M } from "./aiccs.client.js";
import { cloudClient, cloudData, models, rpcRuntime } from "./aliyun.client.js";
import { communicationProfileSchema, profileSaveSchema } from "./aliyun.schema.js";

export const catalogQuerySchema = z.object({
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(100).default(""),
}).strict();
export type CatalogInput = z.infer<typeof catalogQuerySchema>;
const safeAudio = (url?: string) => {
  if (!url) return "";
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? url : ""; } catch { return ""; }
};

export async function catalog(organizationId: string, kind: "agents" | "voices" | "instances" | "seat-numbers", input: CatalogInput) {
  const { settings, credentials } = await connection(organizationId);
  if (kind === "voices") {
    const voices = await cloudData(() => aiccsClient(settings.regionId, credentials).listAvailableTtsWithOptions(new M.ListAvailableTtsRequest({}), rpcRuntime()));
    const entries = voices.filter(v => v.ttsVoiceCode).map(v => ({ id: v.ttsVoiceCode!, name: v.ttsVoiceName || v.ttsVoiceCode!, type: v.voiceType || "", engine: v.ttsEngine || "", sampleUrl: safeAudio(v.ttsAuditionFileUrl) }));
    return { kind, checkedAt: new Date().toISOString(), entries, total: entries.length, page: 1, hasMore: false };
  }
  if (kind === "agents" && settings.product === "aiccs") {
    const data = await cloudData(() => aiccsClient(settings.regionId, credentials).pageQueryAgentListNewWithOptions(new M.PageQueryAgentListNewRequest({ pageNo: input.page, pageSize: input.pageSize, agentName: input.keyword || undefined }), rpcRuntime()));
    const entries = (data.list || []).filter(v => v.agentId !== undefined && Number.isSafeInteger(v.agentId)).map(v => ({ id: String(v.agentId), name: v.agentName || String(v.agentId), description: v.description || "", published: v.isAvailable === true, branchId: v.deployBranchId ? String(v.deployBranchId) : "", versionId: v.effectiveVersionId ? String(v.effectiveVersionId) : "" }));
    const total = data.total ?? ((input.page - 1) * input.pageSize + entries.length);
    return { kind, checkedAt: new Date().toISOString(), entries, total, page: input.page, hasMore: input.page * input.pageSize < total };
  }
  if (kind === "agents") {
    if (!settings.instanceId) throw new BadRequestError("请先保存外呼实例，再查询话术。");
    const data = await cloudData(() => cloudClient(settings.regionId, credentials).listScriptsWithOptions(new models.ListScriptsRequest({ instanceId: settings.instanceId, pageNumber: input.page, pageSize: input.pageSize, publishOnly: true }), rpcRuntime()));
    return { kind, checkedAt: new Date().toISOString(), entries: (data.scripts || []).filter(v => v.scriptId).map(v => ({ id: v.scriptId!, name: v.name || v.scriptId!, published: true, branchId: "", versionId: "", description: "已发布话术" })), total: data.totalCount ?? 0, page: input.page, hasMore: input.page * input.pageSize < (data.totalCount ?? 0) };
  }
  if (kind === "instances" && settings.product === "outboundbot") {
    const data = await cloudData(() => cloudClient(settings.regionId, credentials).listInstancesWithOptions(new models.ListInstancesRequest({ pageNumber: input.page, pageSize: input.pageSize, name: input.keyword || undefined }), rpcRuntime()));
    return { kind, checkedAt: new Date().toISOString(), entries: (data.instances || []).filter(v => v.instanceId).map(v => ({ id: v.instanceId!, name: v.name || v.instanceId!, description: v.description || "" })), total: data.totalCount ?? 0, page: input.page, hasMore: input.page * input.pageSize < (data.totalCount ?? 0) };
  }
  if (kind === "instances") {
    const response = await aiccsClient(settings.regionId, credentials).getInstanceListWithOptions(new M.GetInstanceListRequest({ pageNumber: input.page, pageSize: input.pageSize, name: input.keyword || undefined }), rpcRuntime()).catch(() => { throw new BadRequestError("云坐席实例查询失败，请检查 AICCS 读取权限。"); });
    const body = response.body;
    if (!body?.success) throw new BadRequestError("阿里云未确认云坐席实例查询成功。");
    return { kind, checkedAt: new Date().toISOString(), entries: (body.commodityInstances || []).filter(v => v.instanceId).map(v => ({ id: v.instanceId!, name: v.name || v.instanceId!, description: "人工云坐席实例" })), total: body.totalCount ?? 0, page: input.page, hasMore: input.page * input.pageSize < (body.totalCount ?? 0) };
  }
  if (settings.product !== "aiccs" || !settings.seatInstanceId) throw new BadRequestError("请先保存人工坐席实例 ID。坐席号码与通信智能体服务号不同。");
  const numbers = await cloudData(() => aiccsClient(settings.regionId, credentials).listOutboundPhoneNumberWithOptions(new M.ListOutboundPhoneNumberRequest({ instanceId: settings.seatInstanceId }), rpcRuntime()));
  return { kind, checkedAt: new Date().toISOString(), entries: numbers.map(n => ({ id: n, name: n, description: "人工坐席可用外呼号码" })), total: numbers.length, page: 1, hasMore: false };
}

export const profileInstructions = (profile: z.infer<typeof communicationProfileSchema>) => {
  const languages = { "zh-CN": "普通话中文", "zh-HK": "粤语口语", en: "英语", auto: "客户本轮使用的语言；不明确时使用普通话中文" };
  const genders = { female: "女性AI商务助手", male: "男性AI商务助手", neutral: "不限定性别的AI商务助手" };
  return `\n【本智能体角色与语言】\n角色设定：${genders[profile.gender]}，始终如实说明自己是AI。回答语言：${languages[profile.language]}。语言设置优先于话术中默认中文的要求；每次用1至2句自然回答。性别设定不构成真人身份。`;
};
export async function getProfile(organizationId: string, id: string) {
  const agent = await ownedAgent(organizationId, id);
  const result = communicationProfileSchema.safeParse(agent.configuration?.communicationProfile);
  return { profile: result.success ? result.data : communicationProfileSchema.parse({}), updatedAt: agent.configuration?.update_at.toISOString() || null, saved: result.success && !!agent.configuration && Object.keys(agent.configuration.communicationProfile as object).length > 0 };
}
export async function saveProfile(organizationId: string, userId: string, id: string, input: z.infer<typeof profileSaveSchema>) {
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ agentId: string }>>`SELECT "agentId" FROM "Agent" WHERE "agentId" = ${id} AND "organizationId" = ${organizationId} AND "deletionRequestedAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new BadRequestError("当前工作区找不到此智能体。");
    const current = await tx.agentConfiguration.findUnique({ where: { agentId: id } });
    if (!current) throw new BadRequestError("请先保存智能体话术，再设置角色与声音。");
    if (current.update_at.toISOString() !== input.expectedUpdatedAt) throw new CustomApiError("智能体已在其他页面更新，请重新加载后保存。", 409);
    await tx.agentConfiguration.update({ where: { agentId: id }, data: { communicationProfile: input.profile } });
  });
  await recordAuditEvent({ organizationId, userId, action: "agent.communication-profile.saved", resourceType: "agent", resourceId: id, metadata: { language: input.profile.language, gender: input.profile.gender, voiceCode: input.profile.voiceCode } });
  return getProfile(organizationId, id);
}
