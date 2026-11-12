/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import { outboundApi } from "@/src/lib/api/resources/outbound";
import type {
  CreateBatchCampaignInput,
  OutboundCallListParams,
} from "@/src/lib/api/resources/outbound";
import { downloadBlobAsFile } from "@/src/lib/export-csv";
import type { QuickCallInput } from "@/src/models/outbound/quickCall";
import { queryKeys } from "@/src/lib/query-keys";

export function useOutboundCalls(params: OutboundCallListParams = {}) {
  return useQuery({
    queryKey: [...queryKeys.outbound.all, "calls", params] as const,
    queryFn: () => outboundApi.listOutboundCalls(params),
  });
}

export function useOutboundCall(outboundId?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.outbound.all, "call", outboundId ?? null] as const,
    queryFn: () => outboundApi.getOutboundCall(outboundId as string),
    enabled: Boolean(outboundId),
  });
}

export function useCancelOutboundCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outboundId: string) =>
      outboundApi.cancelOutboundCall(outboundId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outbound.all });
      qc.invalidateQueries({ queryKey: queryKeys.calls.all });
      toast.success("外呼已取消");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法取消外呼");
    },
  });
}

export function useRetryOutboundCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outboundId: string) =>
      outboundApi.retryOutboundCall(outboundId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outbound.all });
      qc.invalidateQueries({ queryKey: queryKeys.calls.all });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      toast.success("外呼重试已开始");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法重试外呼");
    },
  });
}

export function useQuickOutboundCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickCallInput) => outboundApi.quickCall(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.calls.all });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      qc.invalidateQueries({ queryKey: queryKeys.outbound.all });
      toast.success("外呼已开始");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法开始外呼");
    },
  });
}

export function useBatchCampaigns(agentId?: string) {
  return useQuery({
    queryKey: queryKeys.outbound.batches(agentId),
    queryFn: () => outboundApi.listBatchCampaigns(agentId),
  });
}

export function useBatchCampaign(campaignId?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.outbound.all, "batch", campaignId ?? null] as const,
    queryFn: () => outboundApi.getBatchCampaign(campaignId as string),
    enabled: Boolean(campaignId),
  });
}

export function useCreateBatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBatchCampaignInput) =>
      outboundApi.createBatchCampaign(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outbound.all });
      toast.success("批量外呼任务已加入队列");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法将批量任务加入队列");
    },
  });
}

export function useCancelBatchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      outboundApi.cancelBatchCampaign(campaignId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.outbound.all });
      toast.success("外呼任务已取消");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法取消外呼任务");
    },
  });
}

export function useDownloadBatchCampaignResults() {
  return useMutation({
    mutationFn: (campaignId: string) =>
      outboundApi.downloadBatchCampaignResultsCsv(campaignId),
    onSuccess: ({ blob, filename }) => {
      downloadBlobAsFile(filename, blob);
      toast.success("外呼结果已下载");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法下载外呼结果");
    },
  });
}
