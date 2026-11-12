/*
 * 中文导读：工具管理的 ParamEditor 组件，封装该界面的展示与交互。
 */
"use client";

import { uiLabel } from "@/src/lib/locale";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Switch } from "@/src/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import type { ToolParam } from "@/src/lib/api/types";

const EMPTY_PARAM: ToolParam = {
  name: "",
  type: "String",
  valueType: "LLM Prompt",
  description: "",
  allowedValues: [],
  required: false,
  value: null,
};

interface ParamEditorProps {
  label: string;
  hint?: string;
  value: ToolParam[];
  onChange: (params: ToolParam[]) => void;
  disableAdd?: boolean;
  readonlyNames?: boolean;
  disabled?: boolean;
}

function AllowedValueInput({
  values,
  onChange,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
  };

  const remove = (val: string) => onChange(values.filter((v) => v !== val));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="输入允许的值"
          className="h-9 flex-1 text-xs"
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={add}
          disabled={disabled || !draft.trim()}
        >
          添加
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded border bg-muted/60 px-2 py-0.5 font-mono text-xs"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                disabled={disabled}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamCard({
  param,
  onChange,
  onRemove,
  readonlyName,
  disabled,
}: {
  param: ToolParam;
  onChange: (p: ToolParam) => void;
  onRemove: () => void;
  readonlyName?: boolean;
  disabled?: boolean;
}) {
  const set = <K extends keyof ToolParam>(key: K, val: ToolParam[K]) =>
    onChange({ ...param, [key]: val });
  const usesConfiguredValue = param.valueType !== "LLM Prompt";
  const configuredValue = param.value == null ? "" : String(param.value);
  const configuredValueLabel =
    param.valueType === "Dynamic Variable" ? "动态变量标识" : "固定值";
  const configuredValuePlaceholder =
    param.valueType === "Dynamic Variable"
      ? "例如：accountId（账号编号）"
      : "每次工具调用都会发送此值";

  function updateValueType(value: string) {
    const nextValueType = value as ToolParam["valueType"];
    onChange({
      ...param,
      valueType: nextValueType,
      value: nextValueType === "LLM Prompt" ? null : param.value ?? "",
    });
  }

  return (
    <div className="space-y-3 border bg-muted/20 p-4">
      {/* Type + Value Type */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">数据类型</Label>
          <Select
            value={param.type}
            onValueChange={(v) => set("type", v as ToolParam["type"])}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["String", "Number", "Boolean"] as const).map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{uiLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">取值方式</Label>
          <Select
            value={param.valueType}
            onValueChange={updateValueType}
            disabled={disabled}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["LLM Prompt", "Static Value", "Dynamic Variable"] as const).map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{uiLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">参数名称</Label>
        <Input
          value={param.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="例如：status（状态）、limit（条数）、page（页码）"
          className="h-9 text-xs"
          disabled={disabled || readonlyName}
          readOnly={readonlyName}
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">说明</Label>
        <Input
          value={param.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="例如：从对话中提取状态筛选条件"
          className="h-9 text-xs"
          disabled={disabled}
        />
      </div>

      {usesConfiguredValue && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{configuredValueLabel}</Label>
          <Input
            value={configuredValue}
            onChange={(e) => set("value", e.target.value)}
            placeholder={configuredValuePlaceholder}
            className="h-9 font-mono text-xs"
            disabled={disabled}
          />
          {param.valueType === "Dynamic Variable" && (
            <p className="text-xs text-muted-foreground">
              运行时有匹配的动态变量时，使用对应变量值。
            </p>
          )}
        </div>
      )}

      {/* Allowed Values */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">允许的值（可选）</Label>
        <AllowedValueInput
          values={param.allowedValues}
          onChange={(v) => set("allowedValues", v)}
          disabled={disabled}
        />
      </div>

      {/* Required + Delete */}
      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={param.required}
            onCheckedChange={(v) => set("required", v)}
            disabled={disabled}
          />
          <div>
            <p className="text-sm font-medium leading-none">必填</p>
            <p className="mt-0.5 text-xs text-muted-foreground">必须提供参数</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={disabled || readonlyName}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function ParamEditor({
  label,
  hint,
  value,
  onChange,
  disableAdd = false,
  readonlyNames = false,
  disabled = false,
}: ParamEditorProps) {
  const update = (index: number, param: ToolParam) =>
    onChange(value.map((p, i) => (i === index ? param : p)));

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const add = () => onChange([...value, { ...EMPTY_PARAM }]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground/70">{hint}</p>}
        </div>
        {!disableAdd && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={add}
            disabled={disabled}
          >
            <Plus className="size-3.5" />
            添加
          </Button>
        )}
      </div>

      {value.length === 0 ? (
        <div className="flex items-center justify-center border border-dashed py-6 text-xs text-muted-foreground">
          {disableAdd
            ? "在网址中添加 {param} 占位符，用于填充路径参数"
            : `尚未配置${label.toLowerCase()}`}
        </div>
      ) : (
        <div className="space-y-3">
          {value.map((param, i) => (
            <ParamCard
              key={i}
              param={param}
              onChange={(p) => update(i, p)}
              onRemove={() => remove(i)}
              readonlyName={readonlyNames}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
