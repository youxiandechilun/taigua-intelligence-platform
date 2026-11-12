/*
 * 中文导读：数字员工与话术：playbook.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {freezeRecordings} from "../telephony/script-recordings.js";
import { z } from "zod";
import prisma from "../../config/prisma.js";
import CustomApiError from "../../common/errors/customApiError.js";
import { NotFoundError } from "../../common/errors/notFound.js";
import { agentConfigCreateDefaults } from "./agent.repository.js";
import {
  compilePlaybook,
  playbookSchema,
  playbookSaveSchema,
  playbookVariables,
  seedPlaybook,
  normalizeScript,
  playbookOpening,
} from "./agent.playbook.js";
import { recordAuditEvent } from "../audit/audit-log.service.js";
import { crmDbFor } from "../crm/crm.db.js";
import { validateHandoff } from "./agent.handoff.js";
import { CALL_VOICE_MODEL } from "../telephony/voice-model-policy.js";
import { resolvedVoice } from "../telephony/voices.service.js";
import { requireScriptManager } from "./script-access.js";

export async function getPlaybook(organizationId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { organizationId, agentId, deletionRequestedAt: null },
    include: { configuration: true },
  });
  if (!agent) throw new NotFoundError("智能体不存在");
  const config = agent.configuration;
  const parsed = playbookSchema.safeParse(config?.conversationPlaybook);
  const playbook = parsed.success
    ? parsed.data
    : seedPlaybook(
        config?.firstMessage ?? "",
        config?.systemPrompt ?? "",
        agent.name,
      );
  const variables = z
    .object({ placeholders: z.record(z.string(), z.string()).optional() })
    .safeParse(config?.variables);
  return {
    playbook,
    agentName: agent.name,
    updatedAt: config?.update_at.toISOString() ?? null,
    saved: parsed.success,
    placeholders: variables.success ? (variables.data.placeholders ?? {}) : {},
    compiledPrompt: compilePlaybook(playbook),
  };
}

export async function savePlaybook(
  organizationId: string,
  userId: string | null | undefined,
  agentId: string,
  input: z.infer<typeof playbookSaveSchema>,
) {
  const playbook = normalizeScript(input.playbook);
  let compiledPrompt = compilePlaybook(playbook);
  const data = {
    conversationPlaybook: playbook,
    firstMessage: playbookOpening(playbook),
    systemPrompt: compiledPrompt,
    variables: playbookVariables(playbook, input.placeholders),
  };
  const configuration = await prisma.$transaction(async (tx) => {
    // Serialize first configuration creation and re-check tenancy inside the transaction.
    const rows = await tx.$queryRaw<
      Array<{ agentId: string }>
    >`SELECT "agentId" FROM "Agent" WHERE "agentId" = ${agentId} AND "organizationId" = ${organizationId} AND "deletionRequestedAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new NotFoundError("智能体不存在");
    const current = await tx.agentConfiguration.findUnique({
      where: { agentId },
    });
    if ((current?.update_at.toISOString() ?? null) !== input.expectedUpdatedAt)
      throw new CustomApiError(
        "话术已在其他页面更新。请先下载当前草稿，再重新加载最新话术。",
        409,
      );
    const db = crmDbFor(tx);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['company-policy:' + organizationId]);
    if (userId) await requireScriptManager({workspaceId:organizationId,userId}, db);
    if(userId)await freezeRecordings({workspaceId:organizationId,userId},agentId,playbook,db);
    const voiceId=playbook.recordingReplies?.voiceId;
    if(voiceId){
      await resolvedVoice(organizationId,{voiceId,realtimeModel:CALL_VOICE_MODEL},db);
      await db.query(`INSERT INTO "SipAgentProfile" ("workspaceId","agentId","profile","updatedAt") VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "profile"="SipAgentProfile"."profile"||EXCLUDED."profile","updatedAt"=NOW()`,[organizationId,agentId,JSON.stringify({voiceId,realtimeModel:CALL_VOICE_MODEL,voice:''})]);
    }
    const previous = playbookSchema.safeParse(current?.conversationPlaybook);
    await validateHandoff(db, organizationId, userId, playbook.handoff, previous.success ? previous.data.handoff : undefined);
    compiledPrompt = compilePlaybook(playbook);
    data.systemPrompt = compiledPrompt;
    if (current) {
      const result = await tx.agentConfiguration.updateMany({
        where: { agentId, update_at: current.update_at },
        data,
      });
      if (!result.count)
        throw new CustomApiError("配置已更新，请重新加载后保存。", 409);
      return tx.agentConfiguration.findUniqueOrThrow({ where: { agentId } });
    }
    const created = await tx.agentConfiguration.create({
      data: {
        agentId,
        ...agentConfigCreateDefaults,
        ...data,
        voiceId: "aliyun/managed",
        agent_language: "zh",
        llmModel: "qwen-plus",
        sttModel: "aliyun/managed",
        ttsModel: "aliyun/managed",
        timezone: "Asia/Shanghai",
      },
    });
    await tx.agent.update({ where: { agentId }, data: { isConfigured: true } });
    return created;
  });
  await recordAuditEvent({
    organizationId,
    userId,
    action: "agent.playbook.saved",
    resourceType: "agent",
    resourceId: agentId,
  });
  return {
    playbook,
    updatedAt: configuration.update_at.toISOString(),
    saved: true,
    placeholders: data.variables.placeholders,
    compiledPrompt,
  };
}
