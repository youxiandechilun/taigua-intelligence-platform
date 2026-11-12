/*
 * 中文导读：通话记录：calllog.controller.ts。接收接口请求并组织业务调用与响应。
 */
import { StatusCodes } from "http-status-codes";
import {companyContext} from "../workspace/company-access.js";
import {trustedOrigins} from "../../config/origins.js";

import { BadRequestError } from "../../common/errors/badRequest.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { authorized } from "../../middleware/authorize.middleware.js";
import { recordAuditEvent } from "../audit/audit-log.service.js";
import { liveTranscriptStore } from "../../realtime/live-transcript.runtime.js";
import * as calllogService from "./calllog.service.js";
import {
  endLiveCallSchema,
  callReadStateSchema,
  listCallLogsQuerySchema,
  listTranscriptsQuerySchema,
} from "./calllog.schema.js";

export const analyzeCall = authorized(async (req, res) => {
  if (req.auth.authMethod !== 'session' || !trustedOrigins.includes(req.get('origin') || '') || req.get('x-workspace-id') !== req.auth.activeOrganizationId) throw new ForbiddenError('请在当前工作区操作通话分析。');
  const callId = String(req.params.callId);
  res.json({ success: true, data: await calllogService.requestCallAnalysis(req.auth.activeOrganizationId, req.auth.userId, callId) });
  void recordAuditEvent({ organizationId: req.auth.activeOrganizationId, userId: req.auth.userId, action: 'call.analysis.queued', resourceType: 'call_log', resourceId: callId });
});

export const ingestCallLog = authorized(async (req, res) => {
  
  const callLog = await calllogService.ingestCallLog(req.body);
  res.status(StatusCodes.CREATED).json({
    success: true,
    message: "Call log persisted",
    data: callLog,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "call_log.ingested",
    resourceType: "call_log",
    resourceId: callLog.callId,
    metadata: { authMethod: req.auth.authMethod, direction: callLog.direction },
  });
});

export const listCallLogs = authorized(async (req, res) => {
  // Query-string validation is inline because the shared validate middleware
  // only parses req.body. ZodError bubbles to the global error handler and is
  // mapped to a 400. Same pattern as searchNumbers in phone.controller.ts.
  const query = listCallLogsQuerySchema.parse(req.query);
  const { items, nextCursor } = await calllogService.listCallLogs({
    ...query,
    organizationId: req.auth.activeOrganizationId,
    viewerId:req.auth.authMethod!=="internal"?req.auth.userId:undefined,
  });
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Call logs fetched successfully",
    data: items,
    nextCursor,
  });
});

export const listLiveCalls = authorized(async (req, res) => {
  const liveCalls = await calllogService.listLiveCalls(
    req.auth.activeOrganizationId,
    undefined,
    liveTranscriptStore
  );
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Live calls fetched successfully",
    data: req.auth.authMethod==="internal"?liveCalls:await calllogService.ownLiveCalls(req.auth.activeOrganizationId,req.auth.userId,liveCalls),
  });
});

export const endLiveCall = authorized(async (req, res) => {
  if(req.auth.authMethod==="session"&&!(await companyContext(req.auth.activeOrganizationId,req.auth.userId)).allData)throw new ForbiddenError("仅全公司授权管理员可以管理实时通话。");
  const { roomName } = endLiveCallSchema.parse(req.body);
  if(req.auth.authMethod!=='internal'){
    const own=await calllogService.ownLiveCalls(req.auth.activeOrganizationId,req.auth.userId,await calllogService.listLiveCalls(req.auth.activeOrganizationId,undefined,liveTranscriptStore));
    if(!own.some(call=>call.roomName===roomName))throw new ForbiddenError('通话不存在或未授权。');
  }
  const result = await calllogService.endLiveCall(
    req.auth.activeOrganizationId,
    roomName,
    undefined,
    liveTranscriptStore
  );
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Live call ended successfully",
    data: result,
  });
  void recordAuditEvent({
    organizationId: req.auth.activeOrganizationId,
    userId: req.auth.userId,
    action: "call_log.live_call_ended",
    resourceType: "live_call",
    resourceId: roomName,
    metadata: { roomName },
  });
});

export const getCallLog = authorized(async (req, res) => {
  const callId = req.params.callId;
  if (typeof callId !== "string" || callId.length === 0) {
    throw new BadRequestError("Call id is required");
  }
  const callLog = await calllogService.getCallLog(
    req.auth.activeOrganizationId,
    callId,req.auth.authMethod!=="internal"?req.auth.userId:undefined
  );
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Call log fetched successfully",
    data: callLog,
  });
});

export const getTranscripts = authorized(async (req, res) => {
  const callId = req.params.callId;
  if (typeof callId !== "string" || callId.length === 0) {
    throw new BadRequestError("Call id is required");
  }
  const query = listTranscriptsQuerySchema.parse(req.query);
  const { items, nextCursor } = await calllogService.getTranscripts({
    ...query,
    organizationId: req.auth.activeOrganizationId,
    callId,
    viewerId:req.auth.authMethod!=="internal"?req.auth.userId:undefined,
  });
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Transcripts fetched successfully",
    data: items,
    nextCursor,
  });
});

export const setCallReadState = authorized(async (req, res) => {
  if (req.auth.authMethod !== 'session' || !trustedOrigins.includes(req.get('origin') || '') || req.get('x-workspace-id') !== req.auth.activeOrganizationId) {
    throw new ForbiddenError('请在当前工作区操作自己的阅读状态。');
  }
  const callId = req.params.callId;
  if (typeof callId !== 'string' || !callId || callId.length > 256) throw new BadRequestError('通话编号无效。');
  const { read, expectedUserId } = callReadStateSchema.parse(req.body);
  if (expectedUserId !== req.auth.userId) throw new ForbiddenError('登录账号已切换，请刷新通话列表。');
  const data = await calllogService.setCallReadState(req.auth.activeOrganizationId, req.auth.userId, callId, read);
  res.status(StatusCodes.OK).json({ success: true, data });
});

export const deleteCallLog = authorized(async (req, res) => {
  const callId = req.params.callId;
  if (typeof callId !== "string" || callId.length === 0) {
    throw new BadRequestError("Call id is required");
  }
  await calllogService.deleteCallLog(
    req.auth.activeOrganizationId,
    callId,{},req.auth.authMethod!=="internal"?req.auth.userId:undefined
  );
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Call log deleted successfully",
  });
});
