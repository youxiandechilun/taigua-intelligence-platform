/*
 * 中文导读：线路与语音外呼：redial-line.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { memberAccess, type CrmDb, type Row, type Scope } from '../crm/crm.service.js';
import { defaultLine, provinces, resolveRecipientLines, selectedLine, type RouteChoice } from './routing.service.js';
import { sameTaskLine, sameTaskRoutes, taskLineIdentity } from './task-line-compatibility.js';

export const redialLineIdSchema = z.union([z.string().uuid(), z.literal('haokehu-default'), z.literal('')]).default('');
const lineOverrideSchema = z.object({
  lineId: z.union([z.string().uuid(), z.literal('haokehu-default')]),
  province: z.enum(provinces),
  lineIdentity: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RedialLineOverride = z.infer<typeof lineOverrideSchema>;

export function makeRedialLineOverride(route: RouteChoice): RedialLineOverride {
  return lineOverrideSchema.parse({lineId: route.lineId, province: route.province, lineIdentity: taskLineIdentity(route.line)});
}

// The UI selects a concrete line, whose caller province comes from current line
// configuration. Recipient coverage is evaluated separately by carrier policy.
export async function selectedRedialLine(scope: Scope, lineId: string, db: CrmDb): Promise<RouteChoice> {
  const stored = lineId === 'haokehu-default'
    ? (await db.query('SELECT "provinces" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1', [scope.workspaceId]))[0] || {provinces: ['广东']}
    : (await db.query('SELECT "provinces" FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "id"=$2 AND "enabled"=true AND "deletedAt" IS NULL', [scope.workspaceId, lineId]))[0];
  const province = Array.isArray(stored?.provinces)
    ? stored.provinces.find((value: unknown): value is typeof provinces[number] => typeof value === 'string' && (provinces as readonly string[]).includes(value))
    : undefined;
  if (!province) throw new BadRequestError('所选线路已停用或尚未配置地区，请重新选择。');
  return selectedLine(scope, {lineId, province}, db);
}

export type SipAttemptRouteResolution = {attempt: Row; route: RouteChoice; error?: never} | {attempt: Row; route?: never; error: unknown};

// Batch by selected line so large task lists do not perform one catalog/member
// read per queued number. Each failure remains local to its route group.
export async function resolveSipAttemptRoutes(db: CrmDb, task: Row, attempts: Row[]): Promise<SipAttemptRouteResolution[]> {
  const scope = {workspaceId: task.workspaceId, userId: task.createdBy};
  const originals = attempts.filter(attempt => attempt.result?.lineOverride === undefined);
  let originalRoutes: Promise<RouteChoice[]> | undefined;
  const selected = new Map<string, Promise<RouteChoice>>();
  const original = () => {
    if (!originalRoutes) {
      originalRoutes = task.snapshot.routes
        ? resolveRecipientLines(scope, originals.map(attempt => task.recipients[attempt.recipientIndex]), db, task.snapshot.lineSelection)
        : (async () => {
          const [line, access, scopes] = await Promise.all([
            defaultLine(task.workspaceId, db), memberAccess(db, scope),
            db.query('SELECT "assignedUserIds" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1', [task.workspaceId]),
          ]);
          const assignees = scopes[0]?.assignedUserIds || [];
          if (!access.isSystemAdmin && assignees.length && !assignees.includes(task.createdBy))
            throw new ForbiddenError('默认线路尚未分配给任务创建人，请联系管理员。');
          return originals.map(() => ({line, lineId: '', province: ''}));
        })();
    }
    return originalRoutes;
  };
  const originalPositions = new Map(originals.map((attempt, index) => [attempt, index]));
  return Promise.all(attempts.map(async (attempt): Promise<SipAttemptRouteResolution> => {
    try {
      let route: RouteChoice;
      if (attempt.result?.lineOverride !== undefined) {
        const parsed = lineOverrideSchema.safeParse(attempt.result.lineOverride);
        if (!parsed.success) throw new BadRequestError('所选线路记录无效，请重新选择线路。');
        const override = parsed.data, key = JSON.stringify(override);
        let routed = selected.get(key);
        if (!routed) {
          routed = (async () => {
            const value = await selectedLine(scope, override, db);
            if (taskLineIdentity(value.line) !== override.lineIdentity)
              throw new BadRequestError('所选线路的主叫或接入参数已变化，请重新选择线路。');
            return value;
          })();
          selected.set(key, routed);
        }
        route = await routed;
      } else {
        route = (await original())[originalPositions.get(attempt)!]!;
        const matches = task.snapshot.routes
          ? sameTaskRoutes([task.snapshot.routes[attempt.recipientIndex]], [route])
          : sameTaskLine(task.snapshot.line, route.line);
        if (!matches) throw new BadRequestError('任务线路分配或接入参数已变化，请重新选择线路。');
      }
      if (route.line.trunkKey !== attempt.trunkKey)
        throw new BadRequestError('线路共享标识已变化，请重新选择线路。');
      return {attempt, route};
    } catch (error) { return {attempt, error}; }
  }));
}

// Always authorize as the original creator, including administrator redials.
// The returned trunk must match the attempt so the worker holds its actual lock.
export async function resolveSipAttemptRoute(db: CrmDb, task: Row, attempt: Row): Promise<RouteChoice> {
  const resolved = (await resolveSipAttemptRoutes(db, task, [attempt]))[0]!;
  if (!resolved.route) throw resolved.error;
  return resolved.route;
}
