/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import {
  agentsApi,
  type ConfigureAgentInput,
  type CreatePreviewSessionInput,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@/src/lib/api/resources/agents";
import { useAliyunIdentity } from "./aliyun";
import { queryKeys } from "@/src/lib/query-keys";

export function useAgents() {
  const { user, org } = useAliyunIdentity();
  return useQuery({
    queryKey: [...queryKeys.agents.list(), user, org],
    queryFn: async () => (await agentsApi.list()).map(agent => ({...agent,name:agent.personal?.name||agent.name,isActive:agent.isActive,studioSummary:agent.studioSummary&&agent.personal?{...agent.studioSummary,description:agent.personal.description??agent.studioSummary.description,tags:agent.personal.tags??agent.studioSummary.tags}:agent.studioSummary})),
    enabled:!!user&&!!org,
    refetchInterval:15000,
    refetchOnWindowFocus:true,
  });
}

export function useAgent(id: string) {
  const { user, org } = useAliyunIdentity();
  return useQuery({
    queryKey: [...queryKeys.agents.detail(id), user, org],
    queryFn: () =>
      agentsApi.list().then((all) => all.find((a) => a.agentId === id) ?? null),
    enabled: !!id && !!user && !!org,
  });
}

export function useAgentConfig(id: string) {
  return useQuery({
    queryKey: queryKeys.agents.config(id),
    queryFn: () => agentsApi.getConfig(id),
    enabled: !!id,
  });
}

export function useVoiceCatalog() {
  return useQuery({
    queryKey: queryKeys.agents.voiceCatalog(),
    queryFn: () => agentsApi.getVoiceCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateAgentPreviewSession(agentId: string) {
  return useMutation({
    mutationKey: queryKeys.agents.previewSession(agentId),
    mutationFn: (input?: CreatePreviewSessionInput) =>
      agentsApi.createPreviewSession(agentId, input),
    onError: (err: Error) => {
      toast.error(err.message || "无法开始试聊");
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => agentsApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliyun","agent-status"] });
      qc.invalidateQueries({ queryKey: queryKeys.agents.list() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法创建数字员工");
    },
  });
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentInput) => agentsApi.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliyun","agent-status"] });
      qc.invalidateQueries({ queryKey: queryKeys.agents.list() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法更新数字员工");
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      toast.success("数字员工已删除");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除数字员工");
    },
  });
}

export function useSaveAgentConfig(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigureAgentInput) => agentsApi.saveConfig(id, input),
    onSuccess: (config, input) => {
      qc.setQueryData(queryKeys.agents.config(id), {
        ...config,
        ivr_navigation_enabled: input.ivr_navigation_enabled,
      });
      qc.invalidateQueries({ queryKey: ["aliyun","agent-status"] });
      qc.invalidateQueries({ queryKey: queryKeys.agents.list() });
      qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
      toast.success("Saved");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法保存配置");
    },
  });
}
