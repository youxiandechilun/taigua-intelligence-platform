/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import {
  kbApi,
  type CreateKbInput,
  type UpdateKbInput,
} from "@/src/lib/api/resources/kb";
import { queryKeys } from "@/src/lib/query-keys";

export function useKbSources(agentId?: string) {
  return useQuery({
    queryKey: queryKeys.kb.list(agentId),
    queryFn: () => kbApi.list(agentId),
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.status === "PROCESSING")
        ? 2_000
        : false,
  });
}

export function useCreateKb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKbInput) => kbApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.kb.all });
      toast.success("文档已添加");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法添加文档");
    },
  });
}

export function useUpdateKb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, input }: { kbId: string; input: UpdateKbInput }) =>
      kbApi.update(kbId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.kb.all });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      toast.success("文档已更新并加入处理队列");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法更新文档");
    },
  });
}

export function useDeleteKb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => kbApi.remove(kbId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.kb.all });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      toast.success("文档已删除");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除文档");
    },
  });
}

export function useRetryKb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => kbApi.retry(kbId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.kb.all });
      toast.success("文档已加入重试队列");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法重试文档");
    },
  });
}
