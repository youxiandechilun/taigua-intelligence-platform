/*
 * 中文导读：外呼任务的 QuickCallForm 组件，封装该界面的展示与交互。
 */
"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Loader2, PhoneOutgoing, RefreshCw } from "lucide-react";

import { EmptyState } from "@/src/components/common/EmptyState";
import { DynamicVariableInputs } from "@/src/components/agents/DynamicVariableInputs";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { useAgentConfig, useAgents } from "@/src/hooks/queries/agents";
import { useNumbers } from "@/src/hooks/queries/numbers";
import { useQuickOutboundCall } from "@/src/hooks/queries/outbound";
import { quickCallSchema } from "@/src/models/outbound/quickCall";
import type { Agent, PhoneNumber } from "@/src/lib/api/types";
import {
  dynamicVariablePayload,
  normalizeAgentVariables,
  uniqueDynamicVariableNames,
} from "@/src/lib/agents/dynamic-variables";

type DialableAgent = Agent & {
  numbers: PhoneNumber[];
};

type StartedCall = {
  phoneNumber: string;
  fromNumber: string;
};

function asDialableAgents(agents: Agent[], numbers: PhoneNumber[]) {
  return agents
    .filter((agent) => agent.isActive && agent.isConfigured)
    .map((agent) => ({
      ...agent,
      numbers: numbers.filter((number) => number.agentId === agent.agentId),
    }))
    .filter((agent) => agent.numbers.length > 0);
}

function formatProvider(provider: PhoneNumber["provider"]) {
  return provider.toLowerCase() === "telnyx" ? "Telnyx" : "Twilio";
}

export function QuickCallForm() {
  const { data: agents = [], isLoading: agentsLoading, refetch: refetchAgents } = useAgents();
  const { data: numbers = [], isLoading: numbersLoading, refetch: refetchNumbers } = useNumbers();
  const quickCall = useQuickOutboundCall();
  const dialableAgents = useMemo(
    () => asDialableAgents(agents, numbers),
    [agents, numbers]
  );
  const [requestedAgentId, setRequestedAgentId] = useState("");
  const [requestedFromNumber, setRequestedFromNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [username, setUsername] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [dynamicVariableState, setDynamicVariableState] = useState({
    source: "",
    values: {} as Record<string, string>,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [startedCall, setStartedCall] = useState<StartedCall | null>(null);

  const agentId = dialableAgents.some((agent) => agent.agentId === requestedAgentId)
    ? requestedAgentId
    : dialableAgents[0]?.agentId ?? "";
  const selectedAgent = dialableAgents.find((agent) => agent.agentId === agentId);
  const fromNumber = selectedAgent?.numbers.some(
    (number) => number.number === requestedFromNumber
  )
    ? requestedFromNumber
    : selectedAgent?.numbers[0]?.number ?? "";
  const selectedNumber = selectedAgent?.numbers.find(
    (number) => number.number === fromNumber
  );
  const { data: selectedAgentConfig, isLoading: selectedAgentConfigLoading } = useAgentConfig(agentId);
  const selectedAgentVariables = useMemo(
    () => normalizeAgentVariables(selectedAgentConfig?.variables),
    [selectedAgentConfig?.variables]
  );
  const dynamicVariableNames = useMemo(
    () => uniqueDynamicVariableNames(selectedAgentVariables),
    [selectedAgentVariables]
  );
  const dynamicVariableSource = `${agentId}:${dynamicVariableNames.join("\0")}`;
  const emptyDynamicVariableValues = useMemo(
    () => Object.fromEntries(dynamicVariableNames.map((name) => [name, ""])),
    [dynamicVariableNames]
  );

  if (dynamicVariableState.source !== dynamicVariableSource) {
    setDynamicVariableState({
      source: dynamicVariableSource,
      values: emptyDynamicVariableValues,
    });
  }

  const dynamicVariableValues =
    dynamicVariableState.source === dynamicVariableSource
      ? dynamicVariableState.values
      : emptyDynamicVariableValues;
  const setDynamicVariableValues = (values: Record<string, string>) =>
    setDynamicVariableState((state) => ({ ...state, values }));

  const isLoading = agentsLoading || numbersLoading;
  const canSubmit =
    Boolean(agentId) &&
    Boolean(fromNumber) &&
    phoneNumber.trim().length >= 10 &&
    !quickCall.isPending;

  function refresh() {
    refetchAgents();
    refetchNumbers();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setStartedCall(null);

    const parsed = quickCallSchema.safeParse({
      agentId,
      phoneNumber,
      fromNumber,
      username: username.trim() || undefined,
      firstMessage: firstMessage.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      dynamicVariables: dynamicVariablePayload(
        selectedAgentVariables,
        dynamicVariableValues
      ),
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "请检查通话信息");
      return;
    }

    try {
      await quickCall.mutateAsync(parsed.data);
      setStartedCall({
        phoneNumber: parsed.data.phoneNumber,
        fromNumber: parsed.data.fromNumber,
      });
    } catch {
      // The mutation hook owns the toast; keep the form in place for retry.
    }
  }

  function selectAgent(nextAgentId: string) {
    setRequestedAgentId(nextAgentId);
    setDynamicVariableValues({});
    const nextAgent = dialableAgents.find((agent) => agent.agentId === nextAgentId);
    setRequestedFromNumber(nextAgent?.numbers[0]?.number ?? "");
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[560px] animate-pulse border bg-card" />
        <div className="h-72 animate-pulse border bg-card" />
      </div>
    );
  }

  if (dialableAgents.length === 0) {
    return (
      <EmptyState
        icon={PhoneOutgoing}
        title="没有可外呼的智能体"
        description="开始外呼前，请配置已启用智能体并分配电话号码。"
        action={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw /> 刷新
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 pb-20 xl:grid-cols-[minmax(0,1fr)_340px] xl:pb-0">
      <form onSubmit={onSubmit} className="border bg-card">
        <div className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-foreground">快速通话</h2>
          {selectedNumber ? (
            <Badge variant="outline">{formatProvider(selectedNumber.provider)}</Badge>
          ) : null}
        </div>

        <div className="grid gap-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="agent">智能体</Label>
              <Select value={agentId} onValueChange={selectAgent}>
                <SelectTrigger id="agent" className="w-full">
                  <SelectValue placeholder="选择智能体" />
                </SelectTrigger>
                <SelectContent>
                  {dialableAgents.map((agent) => (
                    <SelectItem key={agent.agentId} value={agent.agentId}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fromNumber">主叫号码</Label>
              <Select value={fromNumber} onValueChange={setRequestedFromNumber}>
                <SelectTrigger id="fromNumber" className="w-full">
                  <SelectValue placeholder="选择主叫号码" />
                </SelectTrigger>
                <SelectContent>
                  {(selectedAgent?.numbers ?? []).map((number) => (
                    <SelectItem key={number.phId} value={number.number}>
                      {number.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="phoneNumber">到</Label>
              <Input
                id="phoneNumber"
                type="tel"
                inputMode="tel"
                placeholder="+15551234567"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="username">名称</Label>
              <Input
                id="username"
                placeholder="联系人姓名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="firstMessage">首条消息</Label>
            <Textarea
              id="firstMessage"
              rows={3}
              placeholder="您好，这里是本公司的测试来电。"
              value={firstMessage}
              onChange={(event) => setFirstMessage(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="systemPrompt">系统提示词覆盖</Label>
            <Textarea
              id="systemPrompt"
              rows={4}
              placeholder="请简短沟通，并确认客户要求的信息。"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </div>

          {selectedAgentConfigLoading ? (
            <div className="border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              正在加载智能体变量…
            </div>
          ) : dynamicVariableNames.length > 0 ? (
            <DynamicVariableInputs
              idPrefix="quick-call-variable"
              title="通话变量"
              description="这些值仅发送到本次外呼。"
              variableNames={dynamicVariableNames}
              values={dynamicVariableValues}
              placeholders={selectedAgentVariables.placeholders}
              disabled={quickCall.isPending}
              onValuesChange={setDynamicVariableValues}
            />
          ) : null}

          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}

          {startedCall ? (
            <div
              aria-live="polite"
              className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              已开始致电 {startedCall.phoneNumber} 主叫： {startedCall.fromNumber}.
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={refresh}>
              <RefreshCw /> 刷新
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {quickCall.isPending ? <Loader2 className="animate-spin" /> : <PhoneOutgoing />}
              开始通话
            </Button>
          </div>
        </div>
      </form>

      <aside className="border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-4 text-emerald-500" />
          可用线路
        </div>
        <div className="mt-4 space-y-3">
          {dialableAgents.map((agent: DialableAgent) => (
            <div key={agent.agentId} className="border-b pb-3 last:border-0 last:pb-0">
              <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
              <div className="mt-2 space-y-2">
                {agent.numbers.map((number) => (
                  <div
                    key={number.phId}
                    className="flex min-w-0 items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-foreground">
                        {number.friendlyName || number.number}
                      </p>
                      <p className="break-all text-muted-foreground">{number.number}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {formatProvider(number.provider)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
