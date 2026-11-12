/*
 * 中文导读：外呼任务：quick-outbound.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { DialLine, DialSelection } from './dialing-lines';
import type { TaskActionResult, TaskCreationResult } from '../api/resources/telephony';

/** Choose only on a province change; a later refresh must not silently change the route. */
export function defaultProvinceLine(lines: DialLine[], province: string): DialSelection | null {
  const candidates = lines.filter(line => line.provinces.includes(province));
  const line = candidates.find(line => line.enabled && line.ready) ?? candidates[0];
  return line ? { provider: line.provider, province, lineId: line.id } : null;
}

export function quickOutboundSchedule(
  timing: 'now' | 'scheduled',
  start: string,
  end: string,
  now = new Date(),
) {
  const startTime = timing === 'now' ? now : new Date(start);
  const endTime = timing === 'now' ? new Date(now.getTime() + 86400000) : new Date(end);
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
    throw new Error('请填写有效的预约时间');
  }
  if (endTime <= startTime) throw new Error('结束时间必须晚于开始时间');
  if (timing === 'scheduled' && startTime.getTime() < now.getTime() - 60000) {
    throw new Error('预约开始时间已经过去，请重新选择');
  }
  return { startTime: startTime.toISOString(), endTime: endTime.toISOString() };
}

export function quickOutboundName(name: string, now = new Date()) {
  return name.trim() || '外呼 ' + now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export type QuickOutboundPhase = 'creating' | 'starting' | 'recovering';
export type QuickOutboundSubmissionResult = TaskCreationResult & { startError: string; unresolved: boolean };

async function boundedRequest<T>(request: (signal: AbortSignal) => Promise<T>, timeout: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('服务器响应超时'));
          controller.abort();
        }, timeout);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function rejectedRequest(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  return status >= 400 && status < 500 && status !== 408;
}

export async function createAndStartQuickOutbound(api: {
  requestId: string;
  recoverOnly?: boolean;
  create: (signal: AbortSignal) => Promise<TaskCreationResult>;
  start: (id: string, signal: AbortSignal) => Promise<TaskActionResult>;
  status: (id: string, signal: AbortSignal) => Promise<TaskCreationResult | undefined>;
  onPhase?: (phase: QuickOutboundPhase) => void;
}): Promise<QuickOutboundSubmissionResult> {
  const recover = async (id: string) => {
    api.onPhase?.('recovering');
    return boundedRequest(signal => api.status(id, signal), 12000).catch(() => undefined);
  };
  const known = (saved: TaskCreationResult): QuickOutboundSubmissionResult => ({
    ...saved, unresolved: false,
    startError: saved.status === 'DRAFT' ? '任务已保存，尚未启动，请在任务详情中启动。' : '',
  });
  const unresolved = (saved?: TaskCreationResult): QuickOutboundSubmissionResult => ({
    ...saved, id: api.requestId, status: saved?.status || 'UNKNOWN', unresolved: true,
    startError: '暂未收到服务器的最终结果。请点击“查询提交结果”，系统将查询同一任务。',
  });
  if (api.recoverOnly) {
    const recovered = await recover(api.requestId);
    return recovered ? known(recovered) : unresolved();
  }
  let saved: TaskCreationResult;
  api.onPhase?.('creating');
  try { saved = await boundedRequest(api.create, 30000); }
  catch (error) {
    if (rejectedRequest(error)) throw error;
    const recovered = await recover(api.requestId);
    // A recovery lookup never initiates another start request.
    return recovered ? known(recovered) : unresolved();
  }
  // Replaying a creation request must never resume a task paused elsewhere.
  if (saved.status !== 'DRAFT') return known(saved);
  api.onPhase?.('starting');
  try {
    const started = await boundedRequest(signal => api.start(saved.id, signal), 30000);
    return { ...saved, ...started, status: started.status || 'RUNNING', startError: '', unresolved: false };
  } catch (error) {
    const recovered = await recover(saved.id);
    if (recovered && recovered.status !== 'DRAFT') return known(recovered);
    if (rejectedRequest(error)) return {
      ...saved, ...recovered, unresolved: false,
      startError: error instanceof Error ? error.message : '任务尚未启动，请查看任务详情。',
    };
    return unresolved(recovered || saved);
  }
}
