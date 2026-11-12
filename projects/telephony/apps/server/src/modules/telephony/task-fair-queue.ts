/*
 * 中文导读：按虚拟进度选择下一项任务；新任务从当前进度加入，恢复任务最多补偿一个虚拟轮次。
 * 本函数只做任务选择；选择后的进度持久化与实际起呼由调度工作器负责。
 * 同一任务可能有多个号码候选，选择前先按 taskId 合并，避免号码多的任务获得额外权重。
 */
export type FairCandidate = {
  taskId: string;
  weight: number;
  priority: boolean;
};

export type FairTurn = {
  taskId: string;
  pass: number;
  lastDispatchedAt: Date | string | null;
};

export type FairChoice = {
  index: number;
  taskId: string;
  pass: number;
  weight: number;
};
/* 中文注释：按虚拟进度选择任务；相同进度时先照顾较久未派发的任务，避免新任务独占额度。 */


// A newly available task starts at the current virtual time. A returning task
// can be at most one virtual round behind, preventing an accumulated burst.
export function chooseFairTask(candidates: FairCandidate[], turns: FairTurn[]): FairChoice | null {
  const tasks = new Map<string, { index: number; candidate: FairCandidate }>();
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    if (!Number.isSafeInteger(candidate.weight) || candidate.weight < 1) throw new Error('Invalid task scheduling weight');
    const prior = tasks.get(candidate.taskId);
    if (!prior || (!prior.candidate.priority && candidate.priority)) tasks.set(candidate.taskId, { index, candidate });
  }
  if (!tasks.size) return null;
  const current = new Map(turns.filter(turn => tasks.has(turn.taskId)).map(turn => {
    if (!Number.isFinite(turn.pass) || turn.pass < 0) throw new Error('Invalid task scheduling state');
    return [turn.taskId, turn] as const;
  }));
  const known = [...current.values()];
  let minimum = Infinity;
  let second = Infinity;
  let minimumTask = '';
  for (const turn of known) {
    if (turn.pass < minimum) {
      second = minimum;
      minimum = turn.pass;
      minimumTask = turn.taskId;
    } else if (turn.pass < second) second = turn.pass;
  }
  const baseline = known.length ? minimum : 0;
  let best: (FairChoice & { priority: boolean; last: number }) | undefined;
  for (const { index, candidate } of tasks.values()) {
    const turn = current.get(candidate.taskId);
    const nextMinimum = candidate.taskId === minimumTask ? second : minimum;
    const otherMin = Number.isFinite(nextMinimum) ? nextMinimum : baseline;
    const pass = turn ? Math.max(turn.pass, otherMin - 1) : baseline;
    const last = turn?.lastDispatchedAt ? new Date(turn.lastDispatchedAt).getTime() : 0;
    if (!Number.isFinite(last)) throw new Error('Invalid task scheduling time');
    const next = { index, taskId: candidate.taskId, pass, weight: candidate.weight, priority: candidate.priority, last };
    if (!best || pass < best.pass - 1e-9 ||
        (Math.abs(pass - best.pass) <= 1e-9 && (last < best.last ||
          (last === best.last && candidate.priority && !best.priority) ||
          (last === best.last && candidate.priority === best.priority && candidate.taskId < best.taskId)))) best = next;
  }
  return best ? { index: best.index, taskId: best.taskId, pass: best.pass, weight: best.weight } : null;
}
