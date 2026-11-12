/*
 * 中文导读：外呼任务的 PersonalizationFieldBuilder 组件，封装该界面的展示与交互。
 */
"use client";

import { Plus, Trash2, ChevronDown, ChevronUp, GripVertical, AlertCircle, CheckCircle2 } from "lucide-react";
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
import {
  CampaignIntelligenceFieldType,
  CampaignIntelligenceSource,
  CampaignIntelligenceMissingBehavior,
  type CampaignPersonalizationSchema,
} from "@/src/lib/api/resources/outbound";

export interface PersonalizationField {
  id: string;
  name: string;
  type: CampaignIntelligenceFieldType;
  source: CampaignIntelligenceSource;
  required: boolean;
  sensitive?: boolean;
  missingBehavior: CampaignIntelligenceMissingBehavior;
  invalidBehavior: CampaignIntelligenceMissingBehavior;
  defaultValue?: string | number | boolean;
  description?: string;
  maxLength?: number;
  allowedValues?: string[];
}

interface PersonalizationFieldBuilderProps {
  value: PersonalizationField[];
  onChange: (fields: PersonalizationField[]) => void;
  templates?: {
    prompt?: string;
    firstMessage?: string;
    systemPrompt?: string;
  };
  onTemplatesChange?: (templates: {
    prompt?: string;
    firstMessage?: string;
    systemPrompt?: string;
  }) => void;
}

const FIELD_TYPES: { value: CampaignIntelligenceFieldType; label: string }[] = [
  { value: "string", label: "文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "是/否" },
  { value: "date", label: "日期" },
  { value: "enum", label: "下拉选项" },
];

const FIELD_SOURCES: { value: CampaignIntelligenceSource; label: string; description: string }[] = [
  { value: "customer_attribute", label: "来自 CSV", description: "值来自 CSV 列" },
  { value: "campaign_constant", label: "固定值", description: "所有客户使用相同的值" },
  { value: "computed_safe", label: "计算值", description: "根据其他字段计算" },
];

const MISSING_BEHAVIORS: { value: CampaignIntelligenceMissingBehavior; label: string; description: string }[] = [
  { value: "fallback", label: "使用默认值", description: "缺失时使用备用值" },
  { value: "omit", label: "跳过字段", description: "在模板中留空字段" },
  { value: "skip", label: "跳过客户", description: "不呼叫此客户" },
];

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEmptyField(): PersonalizationField {
  return {
    id: generateId(),
    name: "",
    type: "string",
    source: "customer_attribute",
    required: false,
    sensitive: false,
    missingBehavior: "omit",
    invalidBehavior: "skip",
    description: "",
  };
}

function FieldEditor({
  field,
  onChange,
  onDelete,
  isExpanded,
  onToggleExpand,
}: {
  field: PersonalizationField;
  onChange: (field: PersonalizationField) => void;
  onDelete: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const hasError = !field.name.trim();
  
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground"
          title="拖动重新排序"
        >
          <GripVertical className="size-4" />
        </button>
        
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
            {field.name.trim() || "新建字段"}
          </span>
          {field.required && (
            <span className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
              必填
            </span>
          )}
          {field.sensitive && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              敏感信息
            </span>
          )}
        </button>
        
        <Select
          value={field.type}
          onValueChange={(value) => onChange({ ...field, type: value as CampaignIntelligenceFieldType })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>字段名称 *</Label>
              <Input
                placeholder="例如：customer_name（客户姓名）"
                value={field.name}
                onChange={(e) => onChange({ ...field, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                请使用小写字母和下划线，并与 CSV 列名一致。
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>此值来自哪里？</Label>
              <Select
                value={field.source}
                onValueChange={(value) => onChange({ ...field, source: value as CampaignIntelligenceSource })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_SOURCES.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      <div className="flex flex-col items-start">
                        <span>{source.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {FIELD_SOURCES.find(s => s.value === field.source)?.description}
              </p>
            </div>
          </div>
          
          {field.type === "enum" && (
            <div className="space-y-2">
              <Label>下拉选项</Label>
              <Input
                placeholder="选项一，选项二，选项三"
                value={field.allowedValues?.join(", ") || ""}
                onChange={(e) => onChange({ 
                  ...field, 
                  allowedValues: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                })}
              />
              <p className="text-xs text-muted-foreground">
                多个选项请用英文逗号分隔
              </p>
            </div>
          )}
          
          {field.type === "string" && (
            <div className="space-y-2">
              <Label>最大长度</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                placeholder="120"
                value={field.maxLength ?? ""}
                onChange={(e) => onChange({ 
                  ...field, 
                  maxLength: e.target.value ? Number(e.target.value) : undefined 
                })}
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label>说明（可选）</Label>
            <Input
              placeholder="此字段的用途"
              value={field.description || ""}
              onChange={(e) => onChange({ ...field, description: e.target.value })}
            />
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>如果值缺失</Label>
              <Select
                value={field.missingBehavior}
                onValueChange={(value) => onChange({ 
                  ...field, 
                  missingBehavior: value as CampaignIntelligenceMissingBehavior 
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSING_BEHAVIORS.map((behavior) => (
                    <SelectItem key={behavior.value} value={behavior.value}>
                      <div className="flex flex-col items-start">
                        <span>{behavior.label}</span>
                        <span className="text-xs text-muted-foreground">{behavior.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>如果值无效</Label>
              <Select
                value={field.invalidBehavior}
                onValueChange={(value) => onChange({ 
                  ...field, 
                  invalidBehavior: value as CampaignIntelligenceMissingBehavior 
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSING_BEHAVIORS.map((behavior) => (
                    <SelectItem key={behavior.value} value={behavior.value}>
                      {behavior.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {field.missingBehavior === "fallback" && (
            <div className="space-y-2">
              <Label>默认值</Label>
              <Input
                placeholder="缺失时使用的值"
                value={field.defaultValue?.toString() || ""}
                onChange={(e) => onChange({ ...field, defaultValue: e.target.value })}
              />
            </div>
          )}
          
          <div className="flex gap-4 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onChange({ ...field, required: e.target.checked })}
                className="size-4 rounded border-gray-300"
              />
              <span className="text-sm">必填字段</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.sensitive}
                onChange={(e) => onChange({ ...field, sensitive: e.target.checked })}
                className="size-4 rounded border-gray-300"
              />
              <span className="text-sm">敏感数据（PII/PHI）</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export function PersonalizationFieldBuilder({
  value,
  onChange,
  templates,
  onTemplatesChange,
}: PersonalizationFieldBuilderProps) {
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  
  const handleAddField = useCallback(() => {
    const newField = createEmptyField();
    onChange([...value, newField]);
    setExpandedFields(new Set([...expandedFields, newField.id]));
  }, [value, onChange, expandedFields]);
  
  const handleFieldChange = useCallback((index: number, field: PersonalizationField) => {
    const newValue = [...value];
    newValue[index] = field;
    onChange(newValue);
  }, [value, onChange]);
  
  const handleFieldDelete = useCallback((index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange(newValue);
  }, [value, onChange]);
  
  const toggleExpand = useCallback((id: string) => {
    setExpandedFields((prev) => {
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
          <h3 className="text-sm font-semibold">个性化字段</h3>
          <p className="text-xs text-muted-foreground">
            定义从 CSV 数据中填入的字段
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddField}
        >
          <Plus className="size-4" />
          添加字段
        </Button>
      </div>
      
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((field, index) => (
            <FieldEditor
              key={field.id}
              field={field}
              onChange={(f) => handleFieldChange(index, f)}
              onDelete={() => handleFieldDelete(index)}
              isExpanded={expandedFields.has(field.id)}
              onToggleExpand={() => toggleExpand(field.id)}
            />
          ))}
        </div>
      )}
      
      {templates && onTemplatesChange && (
        <div className="space-y-3 pt-4 border-t">
          <h4 className="text-sm font-semibold">消息模板</h4>
          <p className="text-xs text-muted-foreground">
            使用 {`{{field_name}}`} 插入个性化变量
          </p>
          
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>开场白</Label>
              <Textarea
                placeholder="您好，{{customer_name}}，这里是……"
                rows={3}
                value={templates.firstMessage || ""}
                onChange={(e) => onTemplatesChange({ ...templates, firstMessage: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>系统话术提示</Label>
              <Textarea
                placeholder="你正在致电 {{customer_name}}，沟通关于……"
                rows={4}
                value={templates.prompt || ""}
                onChange={(e) => onTemplatesChange({ ...templates, prompt: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function fieldsToSchema(fields: PersonalizationField[]): CampaignPersonalizationSchema {
  return {
    version: 1,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      source: f.source,
      required: f.required,
      sensitive: f.sensitive,
      missingBehavior: f.missingBehavior,
      invalidBehavior: f.invalidBehavior,
      defaultValue: f.defaultValue,
      description: f.description,
      maxLength: f.maxLength,
      allowedValues: f.allowedValues,
    })),
    templates: {},
    attribution: {},
  };
}

export function schemaToFields(schema: CampaignPersonalizationSchema): PersonalizationField[] {
  return schema.fields.map((f, index) => ({
    id: `field_${index}_${Date.now()}`,
    name: f.name,
    type: f.type,
    source: f.source,
    required: f.required,
    sensitive: f.sensitive ?? false,
    missingBehavior: f.missingBehavior ?? "omit",
    invalidBehavior: f.invalidBehavior ?? "skip",
    defaultValue: f.defaultValue,
    description: f.description,
    maxLength: f.maxLength,
    allowedValues: f.allowedValues,
  }));
}
