/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import { queryKeys } from "@/src/lib/query-keys";
import {
  widgetsApi,
  type CreateAgentWidgetInput,
  type UpdateAgentWidgetInput,
} from "@/src/lib/api/resources/widgets";

export function useAgentWidgets(agentId: string) {
  return useQuery({
    queryKey: queryKeys.agents.widgets(agentId),
    queryFn: () => widgetsApi.listForAgent(agentId),
    enabled: !!agentId,
  });
}

export function useCreateAgentWidget(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentWidgetInput) =>
      widgetsApi.createForAgent(agentId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.widgets(agentId) });
      toast.success("组件已创建");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法创建组件");
    },
  });
}

export function useUpdateAgentWidget(agentId: string, widgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentWidgetInput) =>
      widgetsApi.update(widgetId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.widgets(agentId) });
      toast.success("组件已保存");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法保存组件");
    },
  });
}

export function useDeleteAgentWidget(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) => widgetsApi.remove(widgetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.widgets(agentId) });
      toast.success("组件已删除");
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除组件");
    },
  });
}
