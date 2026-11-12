/*
 * 中文导读：通话记录筛选控件与查询条件输入。
 */
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Clock3, Search, X } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Input } from "@/src/components/ui/input";
import {DataAccountFilter} from "@/src/components/shared/DataAccountFilter";
import { Popover, PopoverContent, PopoverTrigger } from "@/src/components/ui/popover";
import {intentLabels,wechatLabels} from "@/src/lib/customer-followup";
import { useAgents } from "@/src/hooks/queries/agents";
import { normalizeCallPhoneSearch } from "@/src/lib/calls/phone-search";
import { CALL_DURATION_PRESETS, MAX_CALL_DURATION_SECONDS, callDurationLabel, parseCallDurationBound, resolveCallDurationFilters } from "@/src/lib/calls/duration-filters";

const ALL = "__all__";
const RANGE_LABELS: Record<string, string> = {
  "24h": "近24小时",
  "7d": "近7天",
  "30d": "近30天",
};

function calendarDate(value: string) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function CallPhoneSearch({
  value,
  onSearch,
}: {
  value: string;
  onSearch: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");

  return (
    <form className="relative" role="search" onSubmit={event => {
      event.preventDefault();
      const normalized = normalizeCallPhoneSearch(draft);
      if (normalized && !/^[0-9]{3,20}$/.test(normalized)) {
        setError("请输入至少3位号码，支持完整或部分号码");
        return;
      }
      setError("");
      setDraft(normalized);
      onSearch(normalized);
    }}>
      <Input
        type="text"
        inputMode="tel"
        autoComplete="off"
        className="h-9 w-[190px] pr-16"
        placeholder="搜索电话号码"
        aria-label="搜索电话号码，支持完整或部分号码"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "call-phone-search-error" : undefined}
        value={draft}
        onChange={event => { setDraft(event.target.value); setError(""); }}
      />
      <div className="absolute top-1 right-1 flex gap-0.5">
        {draft && <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="清除号码搜索" title="清除号码搜索" onClick={() => {
          setDraft("");
          setError("");
          onSearch("");
        }}><X aria-hidden="true" className="size-3.5" /></Button>}
        <Button type="submit" size="icon" variant="ghost" className="size-7" aria-label="搜索通话号码" title="搜索通话号码"><Search aria-hidden="true" className="size-4" /></Button>
      </div>
      {error && <p id="call-phone-search-error" role="alert" className="absolute top-full left-0 z-10 mt-1 w-max max-w-64 rounded border bg-popover px-2 py-1 text-xs text-destructive shadow-sm">{error}</p>}
    </form>
  );
}

export function CallFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: agents } = useAgents();

  const phoneNumber = params.get("phoneNumber") ?? "";
  const agentId = params.get("agentId") ?? ALL;
  const status = params.get("status") ?? ALL;
  const intent = params.get("intent") ?? ALL;
  const wechatStage = params.get("wechatStage") ?? ALL;
  const direction = params.get("direction") ?? ALL;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const range = params.get("range") ?? "";
  const { minDuration, maxDuration } = resolveCallDurationFilters({ minDuration: params.get("minDuration"), maxDuration: params.get("maxDuration") });

  const [dateOpen, setDateOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [durationOpen, setDurationOpen] = useState(false);
  const [draftMinDuration, setDraftMinDuration] = useState("");
  const [draftMaxDuration, setDraftMaxDuration] = useState("");
  const invalidDuration = (draftMinDuration !== "" && parseCallDurationBound(draftMinDuration) === undefined) ||
    (draftMaxDuration !== "" && parseCallDurationBound(draftMaxDuration) === undefined);
  const reversedDuration = !invalidDuration && draftMaxDuration !== "" && Number(draftMaxDuration) <= Number(draftMinDuration || 0);
  const durationError = invalidDuration ? "请输入有效的非负整数秒数" : reversedDuration ? "最长时长须大于最短时长" : "";
  const dateLabel = from || to
    ? `${calendarDate(from).slice(5) || "不限"} 至 ${calendarDate(to).slice(5) || "不限"}`
    : RANGE_LABELS[range] || "日期范围";
  const dateError = Boolean(draftFrom && draftTo && draftFrom > draftTo);

  function setDates(start: string, end: string, preset?: string) {
    const next = new URLSearchParams(params);
    ["page", "from", "to", "range"].forEach(key => next.delete(key));
    if (preset) next.set("range", preset);
    else {
      if (start) next.set("from", start);
      if (end) next.set("to", end);
    }
    router.replace(`${pathname}?${next.toString()}`);
    setDateOpen(false);
  }

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (key === "from" || key === "to") next.delete("range");
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function setDuration(minimum?: number, maximum?: number) {
    const next = new URLSearchParams(params);
    ["page", "minDuration", "maxDuration"].forEach(key => next.delete(key));
    if (minimum !== undefined) next.set("minDuration", String(minimum));
    if (maximum !== undefined) next.set("maxDuration", String(maximum));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    setDurationOpen(false);
  }

  function reset() {
    const next=new URLSearchParams();const owner=params.get('ownerId');if(owner)next.set('ownerId',owner);router.replace(pathname+(next.size?'?'+next.toString():''));
  }

  const hasFilters =
    Boolean(phoneNumber) ||
    agentId !== ALL ||
    status !== ALL ||
    direction !== ALL || intent !== ALL || wechatStage !== ALL ||
    params.has("minDuration") || params.has("maxDuration") ||
    Boolean(from) ||
    Boolean(to) ||
    Boolean(range);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DataAccountFilter compact />
      <CallPhoneSearch key={phoneNumber} value={phoneNumber} onSearch={value => update("phoneNumber", value)} />
      <Select value={agentId} onValueChange={(v) => update("agentId", v)}>
        <SelectTrigger className="h-9 w-[136px]" aria-label="筛选数字员工">
          <SelectValue placeholder="数字员工" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>数字员工</SelectItem>
          {(agents ?? []).map((a) => (
            <SelectItem key={a.agentId} value={a.agentId}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(v) => update("status", v)}>
        <SelectTrigger className="h-9 w-[118px]" aria-label="筛选通话状态">
          <SelectValue placeholder="任意状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>任意状态</SelectItem>
          <SelectItem value="COMPLETED">已完成</SelectItem>
          <SelectItem value="IN_PROGRESS">进行中</SelectItem>
          <SelectItem value="NEEDS_REVIEW">结果待核对</SelectItem>
          <SelectItem value="FAILED">失败</SelectItem>
          <SelectItem value="NOT_ANSWERED">未接听</SelectItem>
          <SelectItem value="SCHEDULED">已计划</SelectItem>
        </SelectContent>
      </Select>

      <Popover open={durationOpen} onOpenChange={open => {
        setDurationOpen(open);
        if (open) {
          setDraftMinDuration(minDuration === undefined ? "" : String(minDuration));
          setDraftMaxDuration(maxDuration === undefined ? "" : String(maxDuration));
        }
      }}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 max-w-[180px] gap-2 px-3" aria-label="筛选通话时长" title={callDurationLabel(minDuration, maxDuration)}>
            <Clock3 aria-hidden="true" className="size-4" />
            <span className="truncate">{callDurationLabel(minDuration, maxDuration)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 rounded-lg">
          <p className="font-medium">通话时长</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant={minDuration === undefined && maxDuration === undefined ? "secondary" : "outline"} onClick={() => setDuration()}>全部时长</Button>
            {CALL_DURATION_PRESETS.map(preset => <Button key={preset.label} size="sm" variant={minDuration === preset.minDuration && maxDuration === preset.maxDuration ? "secondary" : "outline"} onClick={() => setDuration(preset.minDuration, preset.maxDuration)}>{preset.label}</Button>)}
          </div>
          <form className="grid gap-3 border-t pt-3" onSubmit={event => {
            event.preventDefault();
            if (durationError) return;
            setDuration(parseCallDurationBound(draftMinDuration), parseCallDurationBound(draftMaxDuration));
          }}>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs text-muted-foreground">最短（秒）
                <Input type="number" inputMode="numeric" min={0} max={MAX_CALL_DURATION_SECONDS} step={1} placeholder="不限" aria-label="最短通话时长，单位秒" value={draftMinDuration} onChange={event => setDraftMinDuration(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">最长（不含，秒）
                <Input type="number" inputMode="numeric" min={1} max={MAX_CALL_DURATION_SECONDS} step={1} placeholder="不限" aria-label="最长通话时长，不含该秒数" value={draftMaxDuration} onChange={event => setDraftMaxDuration(event.target.value)} />
              </label>
            </div>
            {durationError && <p role="alert" className="text-xs text-destructive">{durationError}</p>}
            <div className="flex justify-between gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDuration()}>清除时长</Button>
              <Button type="submit" size="sm" disabled={Boolean(durationError)}>应用</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      <Select value={direction} onValueChange={(v) => update("direction", v)}>
        <SelectTrigger className="h-9 w-[100px]" aria-label="筛选通话类型">
          <SelectValue placeholder="全部类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部类型</SelectItem>
          <SelectItem value="inbound">呼入</SelectItem>
          <SelectItem value="outbound">呼出</SelectItem>
        </SelectContent>
      </Select>

      <Select value={intent} onValueChange={value=>update("intent",value)}>
        <SelectTrigger className="h-9 w-[118px]" aria-label="筛选客户意向"><SelectValue placeholder="客户意向"/></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>客户意向</SelectItem>{Object.entries(intentLabels).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={wechatStage} onValueChange={value=>update("wechatStage",value)}>
        <SelectTrigger className="h-9 w-[118px]" aria-label="筛选微信进度"><SelectValue placeholder="微信进度"/></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>微信进度</SelectItem>{Object.entries(wechatLabels).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Popover open={dateOpen} onOpenChange={open => {
        setDateOpen(open);
        if (open) {
          setDraftFrom(calendarDate(from));
          setDraftTo(calendarDate(to));
        }
      }}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 max-w-[190px] gap-2 px-3" aria-label="筛选日期范围" title={from || to ? `${calendarDate(from) || "不限"} 至 ${calendarDate(to) || "不限"}` : dateLabel}>
            <CalendarDays aria-hidden="true" className="size-4" />
            <span className="truncate">{dateLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 rounded-lg">
          <p className="font-medium">日期范围</p>
          <div className="flex gap-2">
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <Button key={value} size="sm" variant="outline" onClick={() => setDates("", "", value)}>{label}</Button>
            ))}
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs text-muted-foreground">开始日期
              <Input type="date" aria-label="开始日期" value={draftFrom} max={draftTo || undefined} onChange={e => setDraftFrom(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">结束日期
              <Input type="date" aria-label="结束日期" value={draftTo} min={draftFrom || undefined} onChange={e => setDraftTo(e.target.value)} />
            </label>
          </div>
          {dateError && <p role="alert" className="text-xs text-destructive">结束日期不能早于开始日期</p>}
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDates("", "")}>清除日期</Button>
            <Button size="sm" disabled={dateError} onClick={() => setDates(draftFrom, draftTo)}>应用</Button>
          </div>
        </PopoverContent>
      </Popover>

      {hasFilters ? (
        <Button variant="ghost" size="icon" onClick={reset} aria-label="清除筛选" title="清除筛选">
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
