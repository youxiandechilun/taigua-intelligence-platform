import prisma from '../../config/prisma.js';
import { PlatformApiError, platformEnabled } from './platform-client.js';
import { reserveCallPoints } from './platform-billing.js';

interface DispatchClaim {
  workspaceId: string;
  attemptId: string;
  maxDurationSeconds?: number;
  snapshot?: { maxDurationSeconds?: number };
}

export async function authorizePlatformDispatch(claim: DispatchClaim): Promise<boolean> {
  if (!platformEnabled()) return true;
  try {
    await reserveCallPoints(claim.workspaceId, claim.attemptId, claim.maxDurationSeconds ?? claim.snapshot?.maxDurationSeconds ?? 600);
    return true;
  } catch (error) {
    const message = error instanceof PlatformApiError && error.statusCode === 402
      ? '平台点数不足，任务已暂停，请充值后继续。'
      : '平台额度校验未完成，任务已暂停，请稍后继续。';
    await prisma.$transaction(async database => {
      const attempt = await database.sipAttempt.findUnique({ where: { id: claim.attemptId }, select: { taskId: true } });
      if (!attempt) return;
      await database.sipAttempt.updateMany({
        where: { id: claim.attemptId, workspaceId: claim.workspaceId, status: 'DISPATCHING', lastEventAt: null },
        data: { status: 'QUEUED', startedAt: null, leaseUntil: null },
      });
      await database.sipTask.updateMany({
        where: { id: attempt.taskId, workspaceId: claim.workspaceId, status: 'RUNNING' },
        data: { status: 'PAUSED', error: message },
      });
    });
    return false;
  }
}
