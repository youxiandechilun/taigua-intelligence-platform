/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import {
  callsApi,
  type CallListParams,
  type TranscriptParams,
} from "@/src/lib/api/resources/calls";
import { queryKeys } from "@/src/lib/query-keys";
import { authClient } from "@/src/lib/auth-client";
import type { CallLog, CursorPage } from "@/src/lib/api/types";

const PAGE_SIZE = 20;

export function useLiveCalls(enabled = true) {
  const {data:session}=authClient.useSession();
  return useQuery({
    queryKey: [...queryKeys.calls.live(),session?.user.id,session?.session.activeOrganizationId],
    queryFn: () => callsApi.live(),
    enabled: enabled&&!!session?.user.id&&!!session?.session.activeOrganizationId,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useEndLiveCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomName: string) => callsApi.endLive(roomName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.calls.live() });
      toast.success("实时通话已结束");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法结束实时通话");
    },
  });
}

export function useCalls(
  params: Omit<CallListParams, "cursor" | "limit">,
  limit: number = PAGE_SIZE
) {
  const {data:session}=authClient.useSession();
  return useInfiniteQuery({
    enabled:!!session?.user.id&&!!session?.session.activeOrganizationId,
    queryKey: [...queryKeys.calls.list({ ...params, limit }),session?.user.id,session?.session.activeOrganizationId],
    queryFn: ({ pageParam }) =>
      callsApi.list({
        ...params,
        limit,
        cursor: pageParam as string | undefined,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });
}

export function useCall(callId: string) {
  const {data:session}=authClient.useSession();
  return useQuery({
    queryKey: [...queryKeys.calls.detail(callId),session?.user.id,session?.session.activeOrganizationId],
    queryFn: () => callsApi.get(callId),
    enabled: !!callId&&!!session?.user.id&&!!session?.session.activeOrganizationId,
    refetchInterval: query => ['QUEUED', 'RUNNING'].includes(query.state.data?.analysis?.status ?? '') ? 5000 : false,
  });
}

export function useTranscript(callId: string, params: TranscriptParams = {}) {
  const {data:session}=authClient.useSession();
  return useInfiniteQuery({
    queryKey: [...queryKeys.calls.transcript(callId),session?.user.id,session?.session.activeOrganizationId],
    queryFn: ({ pageParam }) =>
      callsApi.transcripts(callId, {
        ...params,
        limit: 50,
        cursor: pageParam as string | undefined,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!callId&&!!session?.user.id&&!!session?.session.activeOrganizationId,
  });
}

export function useAnalyzeCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (callId:string) => { const session=await authClient.getSession(); const org=session.data?.session.activeOrganizationId; if(!org)throw new Error('请登录并选择工作区'); await callsApi.analyze(callId,org); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.calls.all }); toast.success('已提交通话分析'); }, onError: (error: Error) => toast.error(error.message || '提交失败，请重试') });
}

export function useSetCallReadState() {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const organizationId = session?.session.activeOrganizationId;
  return useMutation({
    mutationFn: async (input: { callId: string; read: boolean; organizationId: string }) => {
      if (!userId || !organizationId || input.organizationId !== organizationId) throw new Error('请在当前工作区操作阅读状态');
      const state = await callsApi.setReadState(input.callId, input.read, organizationId, userId);
      return { ...state, userId, organizationId };
    },
    onSuccess: async state => {
      const scoped = (key: readonly unknown[]) => key[0] === 'calls'
        && key[key.length - 2] === state.userId && key[key.length - 1] === state.organizationId;
      // Stop an older list/detail response from overwriting the saved state.
      await qc.cancelQueries({ predicate: query => scoped(query.queryKey)
        && (query.queryKey[1] === 'list' || (query.queryKey[1] === 'detail' && query.queryKey[2] === state.callId)) });
      qc.setQueriesData<InfiniteData<CursorPage<CallLog>>>({
        predicate: query => scoped(query.queryKey) && query.queryKey[1] === 'list',
      }, previous => previous && ({
        ...previous,
        pages: previous.pages.map(page => ({
          ...page,
          data: page.data.map(call => call.callId === state.callId ? { ...call, readAt: state.readAt } : call),
        })),
      }));
      qc.setQueryData<CallLog>([...queryKeys.calls.detail(state.callId), state.userId, state.organizationId],
        previous => previous ? { ...previous, readAt: state.readAt } : previous);
    },
    onError: (error: Error) => toast.error(error.message || '阅读状态保存失败，请重试'),
  });
}

export function useDeleteCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (callId: string) => callsApi.remove(callId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.calls.all });
      toast.success("通话已删除");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除通话");
    },
  });
}
