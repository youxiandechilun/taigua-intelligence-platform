/*
 * 中文导读：共享基础能力的查询钩子，集中封装接口调用、查询缓存与更新状态。
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/src/lib/toast";

import {
  secretsApi,
  type CreateSecretInput,
} from "@/src/lib/api/resources/secrets";
import { queryKeys } from "@/src/lib/query-keys";

export function useSecrets() {
  return useQuery({
    queryKey: queryKeys.secrets.list(),
    queryFn: () => secretsApi.list(),
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useCreateSecret() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSecretInput) => secretsApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.list() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法创建密钥");
    },
  });
}

export function useDeleteSecret() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (secretId: string) => secretsApi.remove(secretId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.list() });
    },
    onError: (err: Error) => {
      toast.error(err.message || "无法删除密钥");
    },
  });
}
