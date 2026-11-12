/*
 * 中文导读：数字员工与话术：agent.controller.ts。接收接口请求并组织业务调用与响应。
 */
import {studioSummary} from './agent.studio.js';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess } from '../crm/crm.service.js';
import { callVisibleSql } from '../workspace/company-policy.js';
import { StatusCodes } from "http-status-codes";
import type { Request, Response } from "express";

import {releaseCatalog} from './agent.release.js';
import * as agentService from "./agent.service.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { authorized } from "../../middleware/authorize.middleware.js";
import { recordAuditEvent } from "../audit/audit-log.service.js";

export const createAgent = authorized(async (req, res) => {
  const agent = await agentService.createAgent({
    ...req.body,
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Agent created successfully",
    data: agent,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "agent.created",
    resourceType: "agent",
    resourceId: agent.agentId,
  });
});

export const getAgents = authorized(async (req, res) => {
  const [all,catalog] = await Promise.all([agentService.getAgents(req.auth.activeOrganizationId),releaseCatalog({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId})]);
  const access=await memberAccess(crmDb,{workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
  const counts=await crmDb.query(`SELECT c."agentId",count(*)::int AS count FROM "CallLog" c WHERE c."organizationId"=$1 AND c."deleted"=false AND ($3 OR ${callVisibleSql('c')}) GROUP BY c."agentId"`,[req.auth.activeOrganizationId,req.auth.userId,false]);
  const publishedSummaries=new Map();
  if(!catalog.canTrain&&!catalog.canPublish){
    const published=await crmDb.query('SELECT d."agentId",r."snapshot" FROM "AgentDeployment" d JOIN "AgentRelease" r ON r."id"=d."releaseId" AND r."workspaceId"=d."workspaceId" WHERE d."workspaceId"=$1',[req.auth.activeOrganizationId]);
    for(const row of published){
      const p=row.snapshot?.playbook;
      const safe=studioSummary(null,{conversationPlaybook:p,firstMessage:row.snapshot?.opening||''});
      publishedSummaries.set(row.agentId,{...safe,description:p?.employee?.description||p?.purpose||'',tags:p?.employee?.tags?.length?p.employee.tags:safe.tags});
    }
  }
  const agents=all.filter(a=>catalog.agents.some(r=>r.agentId===a.agentId)).map(a=>({...a,callLogsCount:counts.find(c=>c.agentId===a.agentId)?.count||0,release:catalog.agents.find(r=>r.agentId===a.agentId),...(!catalog.canTrain&&!catalog.canPublish?{studioSummary:publishedSummaries.get(a.agentId),knowledgeSourcesCount:0}: {})}));
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agents fetched successfully",
    data: agents,
  });
});

export const getVoiceCatalog = authorized(async (_req, res) => {
  const catalog = await agentService.getVoiceCatalog();
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Voice catalog fetched successfully",
    data: catalog,
  });
});

export const createAgentPreviewSession = authorized(async (req, res) => {
  const agentId = req.params.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }

  const session = await agentService.createAgentPreviewSession(
    req.auth.activeOrganizationId,
    agentId,
    req.body?.dynamicVariables,
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent preview session created successfully",
    data: session,
  });
});

export const updateAgent = authorized(async (req, res) => {
  const agentId = req.params.id;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }
  const agent = await agentService.updateAgent(
    req.auth.activeOrganizationId,
    agentId,
    req.body,
    req.auth.userId,
  );
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent updated successfully",
    data: agent,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "agent.updated",
    resourceType: "agent",
    resourceId: agent.agentId,
  });
});

export const deleteAgent = authorized(async (req, res) => {
  const agentId = req.params.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }

  const deletion = await agentService.requestAgentDeletion(
    req.auth.activeOrganizationId,
    agentId,
  );

  res.status(StatusCodes.ACCEPTED).json({
    success: true,
    message: "Agent deletion started",
    data: deletion,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "agent.deletion_requested",
    resourceType: "agent",
    resourceId: agentId,
  });
});

export const configureAgent = authorized(async (req, res) => {
  const agentId = req.params.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }

  const configuration = await agentService.configureAgent({
    ...req.body,
    agentId,
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
  });

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent configured successfully",
    data: configuration,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "agent_configuration.updated",
    resourceType: "agent",
    resourceId: agentId,
  });
});

export const getAgentConfig = authorized(async (req, res) => {
  const agentId = req.params.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }

  const configuration = await agentService.getAgentConfig(
    req.auth.activeOrganizationId,
    agentId,
  );

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent configuration fetched successfully",
    data: configuration,
  });
});

export const getAgentConfigByNumber = authorized(async (req, res) => {
  const phoneNumber = req.params.phoneNumber;
  if (typeof phoneNumber !== "string" || phoneNumber.length === 0) {
    throw new BadRequestError("Phone number is required");
  }

  const configuration = await agentService.getAgentConfigByNumber(phoneNumber);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent configuration fetched successfully",
    data: configuration,
  });
});

export const getAgentConfigByIdForRuntime = async (
  req: Request,
  res: Response,
) => {
  const agentId = req.params.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new BadRequestError("Agent id is required");
  }

  const configuration =
    await agentService.getAgentConfigByIdForRuntime(agentId);

  res.status(StatusCodes.OK).json({
    success: true,
    message: "Agent configuration fetched successfully",
    data: configuration,
  });
};
