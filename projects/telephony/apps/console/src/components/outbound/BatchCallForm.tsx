/*
 * 中文导读：外呼任务的 BatchCallForm 组件，封装该界面的展示与交互。
 */
"use client";
import { readTableRows } from '@/src/lib/browser-compute/import-recipients';
import { isSpreadsheetExampleRow } from '@repo/spreadsheets';
import { normalizeSpreadsheetHeader } from "@/src/lib/import-excel";

import { FormEvent, useMemo, useRef, useState } from "react";
import {
  Braces,
  CalendarClock,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { toast } from "@/src/lib/toast";

import { EmptyState } from "@/src/components/common/EmptyState";
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
import { useAgentConfig, useAgents } from "@/src/hooks/queries/agents";
import { useNumbers } from "@/src/hooks/queries/numbers";
import { useCreateBatchCampaign } from "@/src/hooks/queries/outbound";
import {
  type CampaignPersonalizationPreflightRequest,
  type CampaignPersonalizationPreflightResponse,
  type CampaignRecipientValue,
  type CampaignBatchIntelligence,
  outboundApi,
} from "@/src/lib/api/resources/outbound";
import type { Agent, PhoneNumber } from "@/src/lib/api/types";
import {
  batchCampaignSchema,
} from "@/src/models/outbound/campaign";
import {
  normalizeAgentVariables,
  uniqueDynamicVariableNames,
} from "@/src/lib/agents/dynamic-variables";
import {
  PersonalizationFieldBuilder,
  type PersonalizationField,
  fieldsToSchema,
} from "./PersonalizationFieldBuilder";
import {
  ExperimentBuilder,
  type ExperimentData,
  experimentsToDefinition,
} from "./ExperimentBuilder";
import {
  GoalBuilder,
  type GoalData,
  goalsToDefinition,
} from "./GoalBuilder";
import { CSVPreview } from "./CSVPreview";

const ACCEPT_STRING =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BATCH_UPLOAD_BYTES = 5 * 1024 * 1024;
const PREVIEW_CAMPAIGN_ID = "preview-campaign";
const PREVIEW_MAX_RECIPIENTS = 200;

function asDialableAgents(agents: Agent[], numbers: PhoneNumber[]) {
  return agents
    .filter((agent) => agent.isActive && agent.isConfigured)
    .map((agent) => ({
      ...agent,
      numbers: numbers.filter((number) => number.agentId === agent.agentId),
    }))
    .filter((agent) => agent.numbers.length > 0);
}

function contentTypeFor(file: File) {
  if (file.type) return file.type;
  if (file.name.toLowerCase().endsWith(".csv")) return "text/csv";
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

const normalizeCsvHeader=normalizeSpreadsheetHeader;

const SERVER_SIDE_SPECIAL_COLUMNS = new Set([
  "phone_number",
  "language",
  "voice_id",
  "first_message",
  "prompt",
  "system_prompt",
  "recipient_key",
  "recipientid",
  "recipient",
]);

function resolveRecipientKey(raw: Record<string, string>, phoneNumber: string, rowNumber: number) {
  const explicit = raw.recipient_key ?? raw.recipientId ?? raw.recipientid ?? raw.recipient;
  if (explicit?.trim()) return explicit.trim();
  return phoneNumber || `row_${rowNumber}`;
}

function parseRecipientsFromCsv(file: File, maxRows: number): Promise<CampaignRecipientValue[]> {
  return readTableRows(file)
    .then((rows) => {
      if (!rows.length) {
        throw new Error("客户名单文件为空");
      }

      const headers = rows[0]!.map(normalizeCsvHeader);
      if (!headers.includes("phone_number")) {
        throw new Error("客户名单必须包含联系电话列");
      }

      return rows
        .slice(1)
        .map((row,index)=>({row,rowNumber:index+2}))
        .filter(({row})=>!isSpreadsheetExampleRow(row))
        .slice(0,maxRows)
        .map(({row,rowNumber}) => {
          const raw: Record<string, string> = {};
          headers.forEach((header, col) => {
            raw[header] = String(row[col] ?? "").trim();
          });
          const phoneNumber = raw.phone_number?.trim() ?? "";
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(raw)) {
            if (SERVER_SIDE_SPECIAL_COLUMNS.has(key)) continue;
            if (value !== "") values[key] = value;
          }

          return {
            recipientKey: resolveRecipientKey(raw, phoneNumber, rowNumber),
            rowNumber,
            values,
          } satisfies CampaignRecipientValue;
        })

    });
}

export function BatchCallForm() {
  const {
    data: agents = [],
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useAgents();
  const {
    data: numbers = [],
    isLoading: numbersLoading,
    refetch: refetchNumbers,
  } = useNumbers();
  const createBatch = useCreateBatchCampaign();
  const dialableAgents = useMemo(
    () => asDialableAgents(agents, numbers),
    [agents, numbers],
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [requestedAgentId, setRequestedAgentId] = useState("");
  const [requestedFromNumber, setRequestedFromNumber] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"instant" | "later">(
    "instant",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [ringingTimeoutSeconds, setRingingTimeoutSeconds] = useState(60);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdCampaignName, setCreatedCampaignName] = useState<string | null>(
    null,
  );

  // Visual component state
  const [personalizationFields, setPersonalizationFields] = useState<PersonalizationField[]>([]);
  const [templates, setTemplates] = useState<{
    prompt?: string;
    firstMessage?: string;
  }>({});
  const [experiments, setExperiments] = useState<ExperimentData[]>([]);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [preflightResult, setPreflightResult] = useState<
    CampaignPersonalizationPreflightResponse | null
  >(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const agentId = dialableAgents.some(
    (agent) => agent.agentId === requestedAgentId,
  )
    ? requestedAgentId
    : (dialableAgents[0]?.agentId ?? "");
  const selectedAgent = dialableAgents.find(
    (agent) => agent.agentId === agentId,
  );
  const fromNumber = selectedAgent?.numbers.some(
    (number) => number.number === requestedFromNumber,
  )
    ? requestedFromNumber
    : (selectedAgent?.numbers[0]?.number ?? "");
  const { data: selectedAgentConfig } = useAgentConfig(agentId);
  const selectedAgentVariables = useMemo(
    () => normalizeAgentVariables(selectedAgentConfig?.variables),
    [selectedAgentConfig?.variables],
  );
  const dynamicVariableNames = useMemo(
    () => uniqueDynamicVariableNames(selectedAgentVariables),
    [selectedAgentVariables],
  );
  const templateHeader = useMemo(
    () => ["* 联系电话", "回答语言", "音色编号", "开场白", "专属提示", ...dynamicVariableNames].join("\t"),
    [dynamicVariableNames],
  );
  const isLoading = agentsLoading || numbersLoading;
  const isBusy = createBatch.isPending || isPreflighting;
  const canSubmit =
    Boolean(agentId) &&
    Boolean(fromNumber) &&
    Boolean(name.trim()) &&
    Boolean(file) &&
    !isBusy;

  function refresh() {
    refetchAgents();
    refetchNumbers();
  }

  function selectAgent(nextAgentId: string) {
    setRequestedAgentId(nextAgentId);
    const nextAgent = dialableAgents.find(
      (agent) => agent.agentId === nextAgentId,
    );
    setRequestedFromNumber(nextAgent?.numbers[0]?.number ?? "");
  }

  function resetFileInput() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function copyHeader() {
    await navigator.clipboard.writeText(templateHeader);
    toast.success("模板表头已复制");
  }

  async function downloadTemplate() {
    try {
      const result = await outboundApi.downloadBatchTemplate(dynamicVariableNames);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Excel 模板已下载。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板下载失败");
    }
  }

  function buildCampaignIntelligence(): CampaignBatchIntelligence | undefined {
    const hasPersonalization = personalizationFields.length > 0;
    const hasExperiments = experiments.length > 0;
    const hasGoals = goals.length > 0;

    if (!hasPersonalization && !hasExperiments && !hasGoals) {
      return undefined;
    }

    return {
      personalizationSchema: hasPersonalization
        ? {
            ...fieldsToSchema(personalizationFields),
            templates: {
              ...(templates.prompt && { prompt: templates.prompt }),
              ...(templates.firstMessage && { firstMessage: templates.firstMessage }),
            },
          }
        : undefined,
      experiments: hasExperiments ? experimentsToDefinition(experiments) : [],
      goals: hasGoals ? goalsToDefinition(goals) : [],
    } as CampaignBatchIntelligence;
  }

  async function runPreflight() {
    if (!file) {
      setPreflightError("请先选择客户名单文件");
      return;
    }

    if (personalizationFields.length === 0) {
      setPreflightError("至少添加一个个性化字段后才能运行预检查");
      return;
    }

    setPreflightError(null);
    setPreflightResult(null);
    setIsPreflighting(true);

    try {
      const schema = fieldsToSchema(personalizationFields);
      const recipients = await parseRecipientsFromCsv(file, PREVIEW_MAX_RECIPIENTS);
      if (!recipients.length) {
        throw new Error("无法从表格中解析预览数据");
      }

      const request: CampaignPersonalizationPreflightRequest = {
        schema,
        recipients,
        includeSensitivePreview: false,
      };
      const result = await outboundApi.preflightCampaignPersonalization(
        PREVIEW_CAMPAIGN_ID,
        request,
      );
      setPreflightResult(result);
      toast.success("个性化字段预检查已完成");
    } catch (error) {
      setPreflightError(
        error instanceof Error ? error.message : "无法运行个性化字段预检查",
      );
    } finally {
      setIsPreflighting(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setCreatedCampaignName(null);

    const parsed = batchCampaignSchema.safeParse({
      name,
      agentId,
      fromNumber,
      file,
      scheduleMode,
      scheduledAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      ringingTimeoutSeconds,
    });

    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "请检查批量任务信息",
      );
      return;
    }

    let campaignIntelligence: CampaignBatchIntelligence | undefined;
    try {
      campaignIntelligence = buildCampaignIntelligence();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "无法解析外呼策略 JSON",
      );
      return;
    }

    try {
      const upload = await outboundApi.getBatchUploadUrl(
        parsed.data.file.name,
        contentTypeFor(parsed.data.file),
        parsed.data.file.size,
      );
      const uploadRes = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": upload.contentType },
        body: parsed.data.file,
      });
      if (!uploadRes.ok) {
        throw new Error(`文件上传失败：${uploadRes.status}`);
      }

      const campaign = await createBatch.mutateAsync({
        name: parsed.data.name,
        agentId: parsed.data.agentId,
        fromNumber: parsed.data.fromNumber,
        sourceFileKey: upload.s3Key,
        sourceFileName: parsed.data.file.name,
        scheduledAt: parsed.data.scheduledAt ?? null,
        timezone: parsed.data.timezone,
        ringingTimeoutSeconds: parsed.data.ringingTimeoutSeconds,
        campaignIntelligence,
      });
      setName("");
      setScheduleMode("instant");
      setScheduledAt("");
      setRingingTimeoutSeconds(60);
      setPersonalizationFields([]);
      setTemplates({});
      setExperiments([]);
      setGoals([]);
      setPreflightResult(null);
      setPreflightError(null);
      resetFileInput();
      setCreatedCampaignName(campaign.name);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "无法创建批量任务",
      );
    }
  }

  if (isLoading) {
    return <div className="h-[620px] animate-pulse border bg-card" />;
  }

  if (dialableAgents.length === 0) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="没有可外呼的智能体"
        description="创建批量任务前，请配置已启用智能体并分配电话号码。"
        action={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw /> 刷新
          </Button>
        }
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="border bg-card">
      <div className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-foreground">
          批量外呼任务
        </h2>
        <Badge variant="outline">CSV 或 XLSX 表格</Badge>
      </div>

      <div className="grid gap-5 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="batchName">外呼任务</Label>
            <Input
              id="batchName"
              placeholder="例如：六月续约回访"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ringTimeout">响铃超时</Label>
            <Input
              id="ringTimeout"
              type="number"
              min={10}
              max={180}
              value={ringingTimeoutSeconds}
              onChange={(event) =>
                setRingingTimeoutSeconds(Number(event.target.value))
              }
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="batchAgent">智能体</Label>
            <Select value={agentId} onValueChange={selectAgent}>
              <SelectTrigger id="batchAgent" className="w-full">
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
            <Label htmlFor="batchFromNumber">主叫号码</Label>
            <Select value={fromNumber} onValueChange={setRequestedFromNumber}>
              <SelectTrigger id="batchFromNumber" className="w-full">
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

        <div className="grid gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Label>客户文件</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copyHeader}
              >
                <Copy /> 复制表头
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
              >
                <Download /> 下载 Excel 模板
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 border border-dashed bg-background px-4 py-6 text-center transition-colors hover:border-primary/60 hover:bg-muted/30"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {file ? file.name : "选择客户名单文件"}
            </span>
            <span className="text-xs text-muted-foreground">
              支持 Excel（.xlsx）和 CSV（.csv）
            </span>
          </button>
          {dynamicVariableNames.length > 0 ? (
            <div className="border border-dashed bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Braces className="size-4 text-muted-foreground" />
                模板变量
                <Badge variant="outline">{dynamicVariableNames.length}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {dynamicVariableNames.map((name) => (
                  <Badge key={name} variant="secondary">
                    {`{{${name}}}`}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_STRING}
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > MAX_BATCH_UPLOAD_BYTES) {
                setFormError("客户名单文件超过 5 MB 上传限制");
                resetFileInput();
                return;
              }
              setFormError(null);
              setPreflightResult(null);
              setPreflightError(null);
              setFile(selected);
            }}
          />
        </div>

        {/* CSV Preview - Auto-shown when file is uploaded */}
        <CSVPreview file={file} maxRows={10} autoPreview />

        {/* Campaign Intelligence Section */}
        <div className="rounded-lg border bg-card">
          <button
            type="button"
            className="w-full flex items-center justify-between p-4 text-left"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="size-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold">外呼策略</h3>
                <p className="text-xs text-muted-foreground">
                  个性化话术、A/B 对比和转化目标
                </p>
              </div>
            </div>
            <Badge variant="outline" className="ml-2">
              {personalizationFields.length + experiments.length + goals.length} 已配置
            </Badge>
          </button>

          {showAdvanced && (
            <div className="border-t p-4 space-y-6">
              {/* Personalization Fields */}
              <PersonalizationFieldBuilder
                value={personalizationFields}
                onChange={setPersonalizationFields}
                templates={templates}
                onTemplatesChange={setTemplates}
              />

              {/* A/B Testing Experiments */}
              <ExperimentBuilder
                value={experiments}
                onChange={setExperiments}
              />

              {/* Conversion Goals */}
              <GoalBuilder
                value={goals}
                onChange={setGoals}
              />

              {/* Preflight Button */}
              {personalizationFields.length > 0 && (
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">测试个性化</p>
                      <p className="text-xs text-muted-foreground">
                        确认字段与 CSV 数据匹配
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={runPreflight}
                      disabled={isPreflighting || !file}
                    >
                      {isPreflighting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      运行预检查
                    </Button>
                  </div>

                  {preflightError && (
                    <div className="mt-3 p-3 rounded-lg bg-destructive/10 text-sm text-destructive">
                      {preflightError}
                    </div>
                  )}

                  {preflightResult && (
                    <div className="mt-3 p-3 rounded-lg border bg-background">
                      <p className="text-sm font-medium text-emerald-600">
                        ✓ 预检查通过
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        已选择： {preflightResult.selectedRecipients} • 有效： {preflightResult.validRecipients} • 已跳过： {preflightResult.skippedRecipients}
                      </p>
                      {preflightResult.rows.length > 0 && (
                        <div className="mt-2 max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-xs font-mono">
                          {JSON.stringify(preflightResult.rows.slice(0, 5), null, 2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <Label>计划</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={scheduleMode === "instant" ? "default" : "outline"}
              onClick={() => setScheduleMode("instant")}
            >
              <Clock /> 立即
            </Button>
            <Button
              type="button"
              variant={scheduleMode === "later" ? "default" : "outline"}
              onClick={() => setScheduleMode("later")}
            >
              <CalendarClock /> 稍后
            </Button>
          </div>
          {scheduleMode === "later" ? (
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          ) : null}
        </div>

        {formError ? (
          <p className="text-sm text-destructive">{formError}</p>
        ) : null}

        {createdCampaignName ? (
          <div
            aria-live="polite"
            className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            排队中 {createdCampaignName}.
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw /> 刷新
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isBusy ? <Loader2 className="animate-spin" /> : <UploadCloud />}
            加入批量队列
          </Button>
        </div>
      </div>
    </form>
  );
}
