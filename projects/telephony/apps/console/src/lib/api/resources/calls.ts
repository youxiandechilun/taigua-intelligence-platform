/*
 * 中文导读：通话记录的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient } from "@/src/lib/api/client";
import type {
  ApiEnvelope,
  CallLog,
  CallStatus,
  CallTranscript,
  CursorPage,
} from "@/src/lib/api/types";

export interface CallListParams {
  ownerId?:string;
  phoneNumber?: string;
  minDuration?: number;
  maxDuration?: number;
  intent?: "interested" | "unclear" | "uninterested" | "optout";
  wechatStage?: "pending" | "requested" | "added" | "sent" | "deferred" | "failed" | "closed";
  provider?: "aliyun";
  agentId?: string;
  status?: CallStatus;
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface TranscriptParams {
  limit?: number;
  cursor?: string;
}

export interface CallReadState {
  callId: string;
  readAt: string | null;
}

export interface LiveCallRoom {
  roomName: string;
  callId: string;
  status: "active";
  direction: "inbound" | "outbound" | "unknown";
  participantCount: number;
  startedAt: string | null;
  agentId?: string | null;
  agentName?: string | null;
  callerId?: string | null;
  calleeId?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
}

export const callsApi = {
  analyze: async (callId: string, org:string): Promise<void> => { await apiClient.post(`/calls/${encodeURIComponent(callId)}/analyze`, {}, {headers:{'x-workspace-id':org}}); },
  live: async (): Promise<LiveCallRoom[]> => {
    const res = await apiClient.get<ApiEnvelope<LiveCallRoom[]>>("/calls/live");
    return res.data.data;
  },
  endLive: async (roomName: string): Promise<void> => {
    await apiClient.post("/calls/live/end", { roomName });
  },
  list: async (params: CallListParams = {}): Promise<CursorPage<CallLog>> => {
    const res = await apiClient.get<ApiEnvelope<CallLog[]>>("/calls", { params });
    return { data: res.data.data, nextCursor: res.data.nextCursor ?? null };
  },
  get: async (callId: string): Promise<CallLog> => {
    const res = await apiClient.get<ApiEnvelope<CallLog>>(`/calls/${callId}`);
    return res.data.data;
  },
  setReadState: async (callId: string, read: boolean, organizationId: string, expectedUserId: string): Promise<CallReadState> => {
    const res = await apiClient.put<ApiEnvelope<CallReadState>>(
      `/calls/${encodeURIComponent(callId)}/read-state`,
      { read, expectedUserId },
      { headers: { 'x-workspace-id': organizationId } },
    );
    return res.data.data;
  },
  transcripts: async (
    callId: string,
    params: TranscriptParams = {}
  ): Promise<CursorPage<CallTranscript>> => {
    const res = await apiClient.get<ApiEnvelope<CallTranscript[]>>(
      `/calls/${callId}/transcripts`,
      { params }
    );
    return { data: res.data.data, nextCursor: res.data.nextCursor ?? null };
  },
  remove: async (callId: string): Promise<void> => {
    await apiClient.delete(`/calls/${callId}`);
  },
};
