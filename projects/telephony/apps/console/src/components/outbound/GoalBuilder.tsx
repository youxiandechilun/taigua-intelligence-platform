/*
 * 中文导读：外呼任务的 GoalBuilder 组件，封装该界面的展示与交互。
 */
"use client";

import { Plus, Trash2, ChevronDown, ChevronUp, Target, AlertCircle, CheckCircle2, Info } from "lucide-react";
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
import type { CampaignGoalDefinition } from "@/src/lib/api/resources/outbound";

export interface GoalData {
  id: string;
  key: string;
  version: number;
  metric: string;
  customMetric?: string;
  timeWindow?: string;
  attributionModel: "first_touch" | "last_touch" | "linear";
  description?: string;
}

interface GoalBuilderProps {
  value: GoalData[];
  onChange: (goals: GoalData[]) => void;
}

const METRIC_OPTIONS = [
  { value: "reply", label: "客户回复", description: "客户在通话中作出了回应" },
  { value: "positive_response", label: "积极回应", description: "客户表达了兴趣或同意" },
  { value: "appointment_scheduled", label: "已预约", description: "已完成预约" },
  { value: "callback_requested", label: "请求回拨", description: "客户要求回拨" },
  { value: "transferred", label: "转接人工", description: "通话已转接给人工座席" },
  { value: "custom", label: "自定义指标", description: "定义你自己的成功标准" },
];

const ATTRIBUTION_MODELS = [
  { value: "first_touch", label: "首次触达", description: "将归因计给最先达成目标的活动" },
  { value: "last_touch", label: "最后触达", description: "将归因计给目标达成前最近的活动" },
  { value: "linear", label: "平均分配", description: "在整个路径中的所有活动之间平均分配归因" },
];

function generateId() {
  return `goal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyGoal(): GoalData {
  return {
    id: generateId(),
    key: "",
    version: 1,
    metric: "reply",
    attributionModel: "first_touch",
    description: "",
  };
}

function GoalEditor({
  goal,
  onChange,
  onDelete,
  isExpanded,
  onToggleExpand,
}: {
  goal: GoalData;
  onChange: (goal: GoalData) => void;
  onDelete: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const hasError = !goal.key.trim();
  const selectedMetric = METRIC_OPTIONS.find(m => m.value === goal.metric);
  
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <Target className="size-4 text-muted-foreground" />
        
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
            {goal.key.trim() || "新建目标"}
          </span>
          {selectedMetric && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded">
              {selectedMetric.label}
            </span>
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
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 flex gap-2">
            <Info className="size-4 text-emerald-600 mt-0.5 shrink-0" />
            <div className="text-sm text-emerald-800">
              <strong>转化目标：</strong> 定义外呼任务的成功标准，系统会跟踪客户是否完成这些动作。
            </div>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>目标标识 *</Label>
              <Input
                placeholder="例如：appointment_booked（预约成功）"
                value={goal.key}
                onChange={(e) => onChange({ 
                  ...goal, 
                  key: e.target.value.replace(/\s+/g, "_") 
                })}
              />
              <p className="text-xs text-muted-foreground">
                目标的唯一标识，不能包含空格
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>成功指标</Label>
              <Select
                value={goal.metric}
                onValueChange={(value) => onChange({ ...goal, metric: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map((metric) => (
                    <SelectItem key={metric.value} value={metric.value}>
                      <div className="flex flex-col items-start">
                        <span>{metric.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {goal.metric === "custom" && (
            <div className="space-y-2">
              <Label>自定义指标定义</Label>
              <Textarea
                placeholder="描述什么情况算成功转化"
                rows={2}
                value={goal.customMetric || ""}
                onChange={(e) => onChange({ ...goal, customMetric: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                定义目标判断标准，例如客户明确同意预约
              </p>
            </div>
          )}
          
          <div className="space-y-2">
            <Label>说明（可选）</Label>
            <Textarea
              placeholder="达成此目标对外呼任务意味着什么？"
              rows={2}
              value={goal.description || ""}
              onChange={(e) => onChange({ ...goal, description: e.target.value })}
            />
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>归因模型</Label>
              <Select
                value={goal.attributionModel}
                onValueChange={(value) => onChange({ 
                  ...goal, 
                  attributionModel: value as "first_touch" | "last_touch" | "linear" 
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTRIBUTION_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      <div className="flex flex-col items-start">
                        <span>{model.label}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>跟踪时间范围（可选）</Label>
              <Select
                value={goal.timeWindow || ""}
                onValueChange={(value) => onChange({ 
                  ...goal, 
                  timeWindow: value || undefined 
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="不限" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">不限</SelectItem>
                  <SelectItem value="1h">1 小时</SelectItem>
                  <SelectItem value="24h">24 小时</SelectItem>
                  <SelectItem value="7d">7 天</SelectItem>
                  <SelectItem value="30d">30 天</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                通话结束后，继续跟踪目标的时间
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function GoalBuilder({
  value,
  onChange,
}: GoalBuilderProps) {
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());
  
  const handleAddGoal = useCallback(() => {
    const newGoal = createEmptyGoal();
    onChange([...value, newGoal]);
    setExpandedGoals(new Set([...expandedGoals, newGoal.id]));
  }, [value, onChange, expandedGoals]);
  
  const handleGoalChange = useCallback((index: number, goal: GoalData) => {
    const newValue = [...value];
    newValue[index] = goal;
    onChange(newValue);
  }, [value, onChange]);
  
  const handleGoalDelete = useCallback((index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  }, [value, onChange]);
  
  const toggleExpand = useCallback((id: string) => {
    setExpandedGoals((prev) => {
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
          <h3 className="text-sm font-semibold">转化目标</h3>
          <p className="text-xs text-muted-foreground">
            定义外呼任务的成功标准
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddGoal}
        >
          <Plus className="size-4" />
          添加目标
        </Button>
      </div>
      
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <Target className="size-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-2">
            尚未定义目标
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            目标用于衡量外呼效果，例如客户回复、预约成功和转人工。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddGoal}
          >
            <Plus className="size-4" />
            添加第一个目标
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((goal, index) => (
            <GoalEditor
              key={goal.id}
              goal={goal}
              onChange={(g) => handleGoalChange(index, g)}
              onDelete={() => handleGoalDelete(index)}
              isExpanded={expandedGoals.has(goal.id)}
              onToggleExpand={() => toggleExpand(goal.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function goalsToDefinition(goals: GoalData[]): CampaignGoalDefinition[] {
  return goals.map((goal) => ({
    key: goal.key,
    version: goal.version,
    definition: {
      metric: goal.metric,
      ...(goal.customMetric && { customDefinition: goal.customMetric }),
      ...(goal.timeWindow && { timeWindow: goal.timeWindow }),
    },
    attributionPolicy: {
      model: goal.attributionModel,
    },
    ...(goal.description && { description: goal.description }),
  }));
}

export function definitionToGoals(definitions: CampaignGoalDefinition[]): GoalData[] {
  return definitions.map((def, index) => {
    const definition = def.definition as { 
      metric?: string; 
      customDefinition?: string; 
      timeWindow?: string 
    };
    const attributionPolicy = def.attributionPolicy as { model?: string };
    
    return {
      id: `goal_${index}_${Date.now()}`,
      key: def.key,
      version: def.version ?? 1,
      metric: definition.metric ?? "reply",
      customMetric: definition.customDefinition,
      timeWindow: definition.timeWindow,
      attributionModel: (attributionPolicy.model as "first_touch" | "last_touch" | "linear") ?? "first_touch",
      description: (def as { description?: string }).description,
    };
  });
}
