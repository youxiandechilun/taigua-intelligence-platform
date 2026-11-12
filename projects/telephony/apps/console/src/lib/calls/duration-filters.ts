/*
 * 中文导读：通话记录：duration-filters.ts。相关类型、配置或辅助实现集中在本文件。
 */
export const MAX_CALL_DURATION_SECONDS = 2_147_483_647;

export const CALL_DURATION_PRESETS = [
  { label: "不足10秒", minDuration: undefined, maxDuration: 10 },
  { label: "10–30秒", minDuration: 10, maxDuration: 30 },
  { label: "30–60秒", minDuration: 30, maxDuration: 60 },
  { label: "1–3分钟", minDuration: 60, maxDuration: 180 },
  { label: "3分钟及以上", minDuration: 180, maxDuration: undefined },
] as const;

export function parseCallDurationBound(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= MAX_CALL_DURATION_SECONDS ? seconds : undefined;
}

export function resolveCallDurationFilters(values: {
  minDuration: string | null;
  maxDuration: string | null;
}): { minDuration?: number; maxDuration?: number } {
  const minDuration = parseCallDurationBound(values.minDuration);
  const maxDuration = parseCallDurationBound(values.maxDuration);
  if (maxDuration !== undefined && maxDuration <= (minDuration ?? 0)) return {};
  return { minDuration, maxDuration };
}

export function callDurationLabel(minDuration?: number, maxDuration?: number): string {
  if (minDuration === undefined && maxDuration === undefined) return "通话时长";
  const preset = CALL_DURATION_PRESETS.find(item => item.minDuration === minDuration && item.maxDuration === maxDuration);
  if (preset) return preset.label;
  if (maxDuration === undefined) return `${minDuration}秒及以上`;
  if (minDuration === undefined) return `不足${maxDuration}秒`;
  return `${minDuration}–${maxDuration}秒`;
}
