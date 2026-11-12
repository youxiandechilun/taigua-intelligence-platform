/*
 * 中文导读：通话记录：date-filters.ts。相关类型、配置或辅助实现集中在本文件。
 */
export type CallDateFilterInput = {
  from?: string | null;
  range?: string | null;
  to?: string | null;
};

const RANGE_MILLISECONDS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export function resolveCallDateFilters(
  input: CallDateFilterInput,
  now = new Date(),
) {
  const from = parseCalendarBoundary(input.from, "start");
  const to = parseCalendarBoundary(input.to, "end");
  if (from || to) {
    return {
      from: from?.toISOString(),
      to: to?.toISOString(),
    };
  }

  const duration = input.range
    ? RANGE_MILLISECONDS[input.range]
    : undefined;
  if (!duration) return {};

  return {
    from: new Date(now.getTime() - duration).toISOString(),
    to: now.toISOString(),
  };
}

function parseCalendarBoundary(
  value: string | null | undefined,
  boundary: "start" | "end",
) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) {
    const absolute = new Date(value);
    return Number.isNaN(absolute.getTime()) ? null : absolute;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month, day));
  const date = new Date(calendar.getTime() - 8 * 3600000 + (boundary === "end" ? 86400000 - 1 : 0));
  return calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month &&
    calendar.getUTCDate() === day ? date
    : null;
}
