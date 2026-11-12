/*
 * 中文导读：共享基础能力的 use-customer-followup 钩子，复用组件状态和生命周期处理。
 */
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/src/lib/auth-client";
import { followupRequest, type FollowupCallState } from "@/src/lib/customer-followup";

export function useFollowupIdentity() {
  const { data: session } = authClient.useSession();
  return { user: session?.user.id || "", workspace: session?.session.activeOrganizationId || "" };
}

export function useCustomerReadState() {
  const { user, workspace } = useFollowupIdentity();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { customerId: string; read: boolean; revision?: string }) => followupRequest<{ readAt: string | null }>(workspace, `/customers/${encodeURIComponent(input.customerId)}/read-state`, {
      method: 'PUT', body: JSON.stringify({ read: input.read, revision: input.revision, expectedUserId: user }),
    }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['customer-followup', workspace, user, 'customers'] }); },
  });
}
export function useFollowupCallStates(callIds: string[]) {
  const { user, workspace } = useFollowupIdentity();
  const ids = [...new Set(callIds)].sort().join(",");
  return useQuery({ queryKey: ["customer-followup", workspace, user, "calls", ids], queryFn: () => followupRequest<{ rows: FollowupCallState[] }>(workspace, `/calls?ids=${encodeURIComponent(ids)}`), enabled: !!workspace && !!user && !!ids, staleTime: 10000, refetchInterval: 15000, retry: false });
}
