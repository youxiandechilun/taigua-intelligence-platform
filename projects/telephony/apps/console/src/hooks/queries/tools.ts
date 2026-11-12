/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";
import {
  toolsApi,
  type CreateToolInput,
  type UpdateToolInput,
} from "@/src/lib/api/resources/tools";
import { queryKeys } from "@/src/lib/query-keys";

export function useTools() {
  return useQuery({
    queryKey: queryKeys.tools.list(),
    queryFn: () => toolsApi.list(),
  });
}

export function useAgentTools(agentId: string) {
  return useQuery({
    queryKey: queryKeys.tools.agentTools(agentId),
    queryFn: () => toolsApi.getAgentTools(agentId),
    enabled: !!agentId,
  });
}

export function useCreateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateToolInput) => toolsApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.list() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法创建工具");
    },
  });
}

export function useUpdateTool(toolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateToolInput) => toolsApi.update(toolId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.list() });
      qc.invalidateQueries({ queryKey: queryKeys.tools.detail(toolId) });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法更新工具");
    },
  });
}

export function useDeleteTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => toolsApi.remove(toolId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.list() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除工具");
    },
  });
}

export function useAttachTool(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => toolsApi.attach(toolId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.agentTools(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法关联工具");
    },
  });
}

export function useDetachTool(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toolId: string) => toolsApi.detach(toolId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.agentTools(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法解除工具关联");
    },
  });
}

export function useAttachAgentToTool(toolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => toolsApi.attach(toolId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.list() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法关联智能体");
    },
  });
}

export function useDetachAgentFromTool(toolId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => toolsApi.detach(toolId, agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tools.list() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法解除智能体关联");
    },
  });
}
