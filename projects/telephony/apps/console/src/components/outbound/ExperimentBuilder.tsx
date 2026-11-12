/*
 * 中文导读：外呼任务的 ExperimentBuilder 组件，封装该界面的展示与交互。
 */
"use client";

import { Plus, Trash2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Info, Lightbulb } from "lucide-react";
import { useState, useCallback } from "react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Slider } from "@/src/components/ui/slider";
import type { CampaignExperimentDefinition } from "@/src/lib/api/resources/outbound";

interface ExperimentVariant {
  id: string;
  key: string;
  name: string;
  allocationBps: number;
  isControl: boolean;
  prompt?: string;
  firstMessage?: string;
}

export interface ExperimentData {
  id: string;
  experimentId: string;
  version: number;
  hypothesis: string;
  primaryMetric: string;
  guardrailMetrics: string;
  unit: "account" | "recipient" | "household";
  stoppingPolicy: "manual_review" | "auto_conclude";
  variants: ExperimentVariant[];
}

interface ExperimentBuilderProps {
  value: ExperimentData[];
  onChange: (experiments: ExperimentData[]) => void;
}

const METRIC_OPTIONS = [
  { value: "connected_rate", label: "接通率" },
  { value: "reply_rate", label: "回复率" },
  { value: "conversion_rate", label: "转化率" },
  { value: "completion_rate", label: "完成率" },
  { value: "positive_response_rate", label: "积极回应率" },
];

const STOPPING_POLICIES = [
  { value: "manual_review", label: "人工审核", description: "由你决定何时停止" },
  { value: "auto_conclude", label: "自动结束", description: "有足够把握时自动选出胜者" },
];

function generateId() {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateVariantId() {
  return `var_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyExperiment(): ExperimentData {
  return {
    id: generateId(),
    experimentId: "",
    version: 1,
    hypothesis: "",
    primaryMetric: "connected_rate",
    guardrailMetrics: "",
    unit: "recipient",
    stoppingPolicy: "manual_review",
    variants: [
      {
        id: generateVariantId(),
        key: "control",
        name: "Control",
        allocationBps: 5000,
        isControl: true,
      },
      {
        id: generateVariantId(),
        key: "variant_a",
        name: "方案 A",
        allocationBps: 5000,
        isControl: false,
      },
    ],
  };
}

function VariantEditor({
  variant,
  onChange,
  onDelete,
  totalVariants,
  showAllocation,
}: {
  variant: ExperimentVariant;
  onChange: (variant: ExperimentVariant) => void;
  onDelete: () => void;
  totalVariants: number;
  showAllocation: boolean;
}) {
  const allocationPercent = variant.allocationBps / 100;
  
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>方案名称</Label>
            <Input
              placeholder="例如：新开场白方案"
              value={variant.name}
              onChange={(e) => onChange({ ...variant, name: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label>标识（不能包含空格）</Label>
            <Input
              placeholder="variant_a"
              value={variant.key}
              onChange={(e) => onChange({ ...variant, key: e.target.value.replace(/\s+/g, "_") })}
            />
          </div>
        </div>
        
        <div className="flex flex-col items-center gap-2">
          {variant.isControl && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
              对照组
            </span>
          )}
          {!variant.isControl && totalVariants > 2 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      
      {showAllocation && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>流量分配</Label>
            <span className="text-sm font-medium">{allocationPercent}%</span>
          </div>
          <Slider
            value={[variant.allocationBps]}
            onValueChange={([value]) => onChange({ ...variant, allocationBps: value })}
            max={10000}
            step={100}
            className="w-full"
          />
        </div>
      )}
      
      <div className="grid gap-3">
        <div className="space-y-2">
          <Label>开场白（可选）</Label>
          <Textarea
            placeholder="为此方案替换默认开场白"
            rows={2}
            value={variant.firstMessage || ""}
            onChange={(e) => onChange({ ...variant, firstMessage: e.target.value })}
          />
        </div>
        
        <div className="space-y-2">
          <Label>话术提示覆盖（可选）</Label>
          <Textarea
            placeholder="为此方案替换默认系统话术"
            rows={2}
            value={variant.prompt || ""}
            onChange={(e) => onChange({ ...variant, prompt: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function ExperimentEditor({
  experiment,
  onChange,
  onDelete,
  isExpanded,
  onToggleExpand,
}: {
  experiment: ExperimentData;
  onChange: (experiment: ExperimentData) => void;
  onDelete: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const hasError = !experiment.experimentId.trim();
  
  const totalAllocation = experiment.variants.reduce((sum, v) => sum + v.allocationBps, 0);
  const allocationValid = totalAllocation === 10000;
  
  const handleVariantChange = useCallback((index: number, variant: ExperimentVariant) => {
    const newVariants = [...experiment.variants];
    newVariants[index] = variant;
    onChange({ ...experiment, variants: newVariants });
  }, [experiment, onChange]);
  
  const handleAddVariant = useCallback(() => {
    const newVariant: ExperimentVariant = {
      id: generateVariantId(),
      key: `variant_${String.fromCharCode(97 + experiment.variants.length)}`,
      name: `方案${String.fromCharCode(65 + experiment.variants.length)}`,
      allocationBps: 0,
      isControl: false,
    };
    onChange({ ...experiment, variants: [...experiment.variants, newVariant] });
  }, [experiment, onChange]);
  
  const handleDeleteVariant = useCallback((index: number) => {
    const newVariants = experiment.variants.filter((_, i) => i !== index);
    onChange({ ...experiment, variants: newVariants });
  }, [experiment, onChange]);
  
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {hasError ? (
            <AlertCircle className="size-4 text-destructive" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )}
          <span className="font-medium text-sm">
            {experiment.experimentId.trim() || "新建对比实验"}
          </span>
          {allocationValid ? (
            <CheckCircle2 className="size-3 text-emerald-500" />
          ) : (
            <AlertCircle className="size-3 text-amber-500" />
          )}
        </button>
        
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleExpand}
        >
          {isExpanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
        
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      
      {isExpanded && (
        <div className="p-4 space-y-4">
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 flex gap-2">
            <Info className="size-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800">
              <strong>A/B 测试：</strong> 测试不同话术或策略，比较实际效果。客户将按你设置的比例随机分配到不同方案。
            </div>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>实验编号 *</Label>
              <Input
                placeholder="例如：opening_script_test（开场白测试）"
                value={experiment.experimentId}
                onChange={(e) => onChange({ 
                  ...experiment, 
                  experimentId: e.target.value.replace(/\s+/g, "_") 
                })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>主要指标</Label>
              <Select
                value={experiment.primaryMetric}
                onValueChange={(value) => onChange({ ...experiment, primaryMetric: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map((metric) => (
                    <SelectItem key={metric.value} value={metric.value}>
                      {metric.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>假设</Label>
            <Textarea
              placeholder="你希望从此次对比中了解什么？"
              rows={2}
              value={experiment.hypothesis}
              onChange={(e) => onChange({ ...experiment, hypothesis: e.target.value })}
            />
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>护栏指标（可选）</Label>
              <Input
                placeholder="例如：abandon_rate（放弃率）、cost_per_call（每次通话成本）"
                value={experiment.guardrailMetrics}
                onChange={(e) => onChange({ ...experiment, guardrailMetrics: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                需要监测是否恶化的指标
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>停止策略</Label>
              <Select
                value={experiment.stoppingPolicy}
                onValueChange={(value) => onChange({ 
                  ...experiment, 
                  stoppingPolicy: value as "manual_review" | "auto_conclude" 
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOPPING_POLICIES.map((policy) => (
                    <SelectItem key={policy.value} value={policy.value}>
                      <div className="flex flex-col items-start">
                        <span>{policy.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base">变体</Label>
                <p className="text-xs text-muted-foreground">
                  {allocationValid ? (
                    <span className="text-emerald-600">✓ 总分配比例：100%</span>
                  ) : (
                    <span className="text-amber-600">
                      ⚠ 总分配比例： {totalAllocation / 100}%（应为 100%）
                    </span>
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddVariant}
              >
                <Plus className="size-4" />
                添加方案
              </Button>
            </div>
            
            <div className="space-y-3">
              {experiment.variants.map((variant, index) => (
                <VariantEditor
                  key={variant.id}
                  variant={variant}
                  onChange={(v) => handleVariantChange(index, v)}
                  onDelete={() => handleDeleteVariant(index)}
                  totalVariants={experiment.variants.length}
                  showAllocation={experiment.variants.length > 1}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExperimentBuilder({
  value,
  onChange,
}: ExperimentBuilderProps) {
  const [expandedExperiments, setExpandedExperiments] = useState<Set<string>>(new Set());
  
  const handleAddExperiment = useCallback(() => {
    const newExperiment = createEmptyExperiment();
    onChange([...value, newExperiment]);
    setExpandedExperiments(new Set([...expandedExperiments, newExperiment.id]));
  }, [value, onChange, expandedExperiments]);
  
  const handleExperimentChange = useCallback((index: number, experiment: ExperimentData) => {
    const newValue = [...value];
    newValue[index] = experiment;
    onChange(newValue);
  }, [value, onChange]);
  
  const handleExperimentDelete = useCallback((index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  }, [value, onChange]);
  
  const toggleExpand = useCallback((id: string) => {
    setExpandedExperiments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">A/B 测试实验</h3>
          <p className="text-xs text-muted-foreground">
            测试不同策略，提高实际效果
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddExperiment}
        >
          <Plus className="size-4" />
          添加对比实验
        </Button>
      </div>
      
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <Lightbulb className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-2">
            尚未配置对比实验
          </p>
          
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddExperiment}
          >
            <Plus className="size-4" />
            创建第一个对比实验
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((experiment, index) => (
            <ExperimentEditor
              key={experiment.id}
              experiment={experiment}
              onChange={(e) => handleExperimentChange(index, e)}
              onDelete={() => handleExperimentDelete(index)}
              isExpanded={expandedExperiments.has(experiment.id)}
              onToggleExpand={() => toggleExpand(experiment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function experimentsToDefinition(experiments: ExperimentData[]): CampaignExperimentDefinition[] {
  return experiments.map((exp) => ({
    experimentId: exp.experimentId,
    version: exp.version,
    hypothesis: exp.hypothesis,
    primaryMetric: exp.primaryMetric,
    guardrailMetrics: exp.guardrailMetrics.split(",").map(s => s.trim()).filter(Boolean),
    unit: exp.unit,
    stoppingPolicy: exp.stoppingPolicy,
    variants: exp.variants.map((v) => ({
      key: v.key,
      name: v.name,
      allocationBps: v.allocationBps,
      isControl: v.isControl,
      configVersion: {
        ...(v.prompt && { prompt: v.prompt }),
        ...(v.firstMessage && { firstMessage: v.firstMessage }),
      },
    })),
  }));
}

export function definitionToExperiments(definitions: CampaignExperimentDefinition[]): ExperimentData[] {
  return definitions.map((def, index) => ({
    id: `exp_${index}_${Date.now()}`,
    experimentId: def.experimentId,
    version: def.version ?? 1,
    hypothesis: def.hypothesis,
    primaryMetric: def.primaryMetric,
    guardrailMetrics: def.guardrailMetrics?.join(", ") || "",
    unit: def.unit,
    stoppingPolicy: def.stoppingPolicy as "manual_review" | "auto_conclude",
    variants: def.variants.map((v, vIndex) => ({
      id: `var_${vIndex}_${Date.now()}`,
      key: v.key,
      name: v.name,
      allocationBps: v.allocationBps,
      isControl: v.isControl ?? false,
      prompt: v.configVersion?.prompt as string | undefined,
      firstMessage: v.configVersion?.firstMessage as string | undefined,
    })),
  }));
}
