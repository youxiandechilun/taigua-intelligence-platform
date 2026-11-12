import prisma from '../../config/prisma.js';
import {
  PlatformApiError,
  platformEnabled,
  releasePlatformPoints,
  reservePlatformPoints,
  settlePlatformPoints,
} from './platform-client.js';

const terminalStates = ['COMPLETED', 'NOT_ANSWERED', 'FAILED', 'CANCELLED'];

export function callPointQuantity(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new PlatformApiError('通话时长无效。', 400, 'INVALID_QUANTITY');
  return Math.ceil(seconds / 60);
}

export async function reserveCallPoints(organizationId: string, attemptId: string, maxSeconds = 600) {
  if (!platformEnabled()) return null;
  const merchant = await prisma.taiguaMerchant.findUnique({ where: { organizationId } });
  if (!merchant) throw new PlatformApiError('该工作区尚未关联平台商户。', 403, 'MERCHANT_MISSING');
  const existing = await prisma.taiguaCallCharge.findUnique({ where: { attemptId } });
  if (existing) {
    if (existing.organizationId !== organizationId || existing.status !== 'RESERVED') {
      throw new PlatformApiError('本次通话的计费状态已变化。', 409, 'CALL_CHARGE_CLOSED');
    }
    return existing;
  }
  const quantity = Math.max(1, callPointQuantity(maxSeconds));
  const hold = await reservePlatformPoints({
    mid: merchant.merchantId,
    agent_slug: merchant.agentSlug,
    action: 'call_minute',
    quantity,
    request_id: `${merchant.agentSlug}:call:${attemptId}`,
  });
  return prisma.taiguaCallCharge.upsert({
    where: { attemptId },
    create: { attemptId, organizationId, merchantId: merchant.merchantId, holdId: hold.hold_id, reservedQuantity: quantity },
    update: {},
  });
}

export async function releaseCallPoints(attemptId: string, reason: string) {
  if (!platformEnabled()) return;
  const charge = await prisma.taiguaCallCharge.findUnique({ where: { attemptId } });
  if (!charge || ['SETTLED', 'RELEASED'].includes(charge.status)) return;
  const claimed = await prisma.taiguaCallCharge.updateMany({
    where: { attemptId, status: { in: ['RESERVED', 'PENDING_RELEASE'] } },
    data: { status: 'PENDING_RELEASE', actualQuantity: 0 },
  });
  if (!claimed.count) return;
  try {
    await releasePlatformPoints(charge.holdId, reason);
    await prisma.taiguaCallCharge.update({ where: { attemptId }, data: { status: 'RELEASED', lastError: '' } });
  } catch (error) {
    await rememberFailure(attemptId, error);
    throw error;
  }
}

export async function settleCallPoints(attemptId: string, seconds: number) {
  if (!platformEnabled()) return;
  const charge = await prisma.taiguaCallCharge.findUnique({ where: { attemptId } });
  if (!charge || ['SETTLED', 'RELEASED'].includes(charge.status)) return;
  if (charge.status === 'PENDING_RELEASE') return releaseCallPoints(attemptId, '通话未接通或已取消');
  // The call's configured duration is its prepaid ceiling. A late hang-up
  // receipt cannot turn this into a charge beyond the admitted limit.
  const quantity = charge.actualQuantity ?? Math.min(callPointQuantity(seconds), charge.reservedQuantity);
  if (quantity === 0) return releaseCallPoints(attemptId, '通话未接通或已取消');
  await prisma.taiguaCallCharge.updateMany({
    where: { attemptId, status: 'RESERVED', actualQuantity: null },
    data: { status: 'PENDING_SETTLE', actualQuantity: quantity },
  });
  const pending = await prisma.taiguaCallCharge.findUnique({ where: { attemptId } });
  if (!pending || pending.status !== 'PENDING_SETTLE' || pending.actualQuantity === null) return;
  try {
    await settlePlatformPoints(charge.holdId, pending.actualQuantity);
    await prisma.taiguaCallCharge.update({ where: { attemptId }, data: { status: 'SETTLED', lastError: '' } });
  } catch (error) {
    await rememberFailure(attemptId, error);
    throw error;
  }
}

async function rememberFailure(attemptId: string, error: unknown) {
  const code = error instanceof PlatformApiError ? error.code : 'PLATFORM_UNAVAILABLE';
  await prisma.taiguaCallCharge.update({ where: { attemptId }, data: { lastError: code } });
}

export async function reconcileCallPoints() {
  if (!platformEnabled()) return;
  const charges = await prisma.taiguaCallCharge.findMany({
    where: { status: { in: ['RESERVED', 'PENDING_SETTLE', 'PENDING_RELEASE'] } },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  if (!charges.length) return;
  const attempts = await prisma.sipAttempt.findMany({
    where: { id: { in: charges.map(charge => charge.attemptId) }, status: { in: terminalStates } },
    select: { id: true, result: true },
  });
  const finished = new Map(attempts.map(attempt => [attempt.id, attempt]));
  for (const charge of charges) {
    const attempt = finished.get(charge.attemptId);
    if (!attempt && charge.status === 'RESERVED') continue;
    try {
      if (charge.status === 'PENDING_RELEASE') await releaseCallPoints(charge.attemptId, '通话已取消');
      else {
        const result = attempt?.result;
        const duration = result && typeof result === 'object' && !Array.isArray(result) && typeof result.durationSeconds === 'number' ? result.durationSeconds : 0;
        await settleCallPoints(charge.attemptId, charge.actualQuantity === null ? duration : charge.actualQuantity * 60);
      }
    } catch { /* The durable pending state is retried on the next worker tick. */ }
  }
}

export async function applyPlatformCallUsage(input: { organizationId: string; callId: string; connectedSeconds: number; final: boolean }) {
  const charge = await prisma.taiguaCallCharge.findUnique({ where: { attemptId: input.callId } });
  if (!charge || charge.organizationId !== input.organizationId) {
    throw new PlatformApiError('通话尚未完成平台额度预授权。', 402, 'CALL_NOT_RESERVED');
  }
  if (input.final) await settleCallPoints(input.callId, input.connectedSeconds);
  const limitReached = input.connectedSeconds >= charge.reservedQuantity * 60;
  return {
    action: limitReached && !input.final ? 'stop' as const : 'continue' as const,
    reason: limitReached ? 'platform_duration_limit' : 'platform_points',
    chargedMicros: 0n,
    platformQuantity: input.final ? Math.min(callPointQuantity(input.connectedSeconds), charge.reservedQuantity) : 0,
  };
}
