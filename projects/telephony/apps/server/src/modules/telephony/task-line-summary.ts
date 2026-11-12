/*
 * 中文导读：线路与语音外呼：task-line-summary.ts。相关类型、配置或辅助实现集中在本文件。
 */
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';

// Expose only safe fields frozen in the task. Never resolve names from live
// settings: a later edit must not change what this task says it will dial.
export function taskLineSummary(input: unknown) {
  const snapshot = row(input), selection = row(snapshot.lineSelection);
  const savedRoutes = Array.isArray(snapshot.routes) && snapshot.routes.length ? snapshot.routes : [{ line: snapshot.line, lineId: selection.lineId, province: selection.province }];
  const grouped = new Map<string, { lineId: string; lineName: string; province: string; callerNumber: string; callerMode: string; callerLabel: string; recipients: number }>();
  for (const input of savedRoutes) {
    const route = row(input), line = row(route.line);
    const item = { lineId: text(route.lineId), lineName: text(line.name) || '旧任务未记录线路名称', province: text(route.province), callerNumber: text(line.callerNumber), callerMode: text(line.callerMode), callerLabel: line.callerMode === 'provider' ? '服务商分配' : text(line.callerNumber) || '未记录主叫标识', recipients: 1 };
    const key = JSON.stringify([item.lineId, item.lineName, item.province, item.callerMode, item.callerNumber]);
    const old = grouped.get(key);
    if (old) old.recipients++; else grouped.set(key, item);
  }
  const lineRoutes = [...grouped.values()];
  return {
    lineId: lineRoutes.length === 1 ? lineRoutes[0]!.lineId : '',
    serviceProvider: [...new Set(savedRoutes.map(v=>text(row(row(v).line).serviceProvider)||'好客呼'))].join('、'),
    lineName: lineRoutes.length === 1 ? lineRoutes[0]!.lineName : `多条线路（${lineRoutes.length}）`,
    province: [...new Set(lineRoutes.map(line => line.province).filter(Boolean))].join('、'),
    callerNumber: [...new Set(lineRoutes.map(line => line.callerNumber).filter(Boolean))].join('、'),
    callerMode: [...new Set(lineRoutes.map(line => line.callerMode))].length === 1 ? lineRoutes[0]!.callerMode : 'mixed',
    callerLabel: [...new Set(lineRoutes.map(line => line.callerLabel))].join('、'),
    lineRoutes,
  };
}
