/*
 * 中文导读：线路与语音外呼：line-failures.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import { z } from 'zod';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { crmDb } from '../crm/crm.db.js';
import type { Scope } from '../crm/crm.service.js';
import { companyContext } from '../workspace/company-access.js';

const querySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const code = (value: unknown) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) ? value : '';
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Actual attempts form the ledger. Periodic monitor alerts are aggregated observations.
export async function lineFailureHistory(scope: Scope, raw: unknown) {
  const input = querySchema.parse(raw);
  const access = await companyContext(scope.workspaceId, scope.userId);
  if (!access.permissions.callLogs?.includes('read')) throw new ForbiddenError('当前账号无权查看通话失败记录。');
  const rows = await crmDb.query(`WITH eligible AS (
    SELECT a."id",a."taskId",a."attemptNumber",a."status",a."finishedAt",a."lastEventAt",
      a."result"->>'reason' AS reason,a."result"->'diagnostics' AS diagnostics,
      COALESCE(a."result"->'dispatchedLine',t."snapshot"->'routes'->a."recipientIndex"->'line',t."snapshot"->'route'->'line',t."snapshot"->'line') AS line,
      t."name" AS "taskName",t."recipients"->a."recipientIndex"->>'phoneNumber' AS "phoneNumber",
      COALESCE(NULLIF(btrim(u."name"),''),'未记录员工') AS "ownerName",
      c."callId",COALESCE(a."finishedAt",a."lastEventAt",a."startedAt",t."createdAt") AS "sortAt"
    FROM "SipAttempt" a JOIN "SipTask" t ON t."workspaceId"=a."workspaceId" AND t."id"=a."taskId"
    LEFT JOIN "User" u ON u."id"=t."createdBy"
    LEFT JOIN "CallLog" c ON c."organizationId"=a."workspaceId" AND c."callId"=a."id" AND c."deleted"=false
    WHERE a."workspaceId"=$1 AND t."deletedAt" IS NULL AND ($3::boolean OR t."createdBy"=$2)
      AND COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP')='HAOKEHU_SIP'
      AND (a."status" IN ('FAILED','NOT_ANSWERED','NEEDS_REVIEW') OR
        a."status"='COMPLETED' AND a."result"->>'reason'='VOICE_SERVICE_ERROR')
  ) SELECT * FROM eligible e
    WHERE $4::text IS NULL OR (e."sortAt",e."id") < (SELECT anchor."sortAt",anchor."id" FROM eligible anchor WHERE anchor."id"=$4)
    ORDER BY e."sortAt" DESC,e."id" DESC LIMIT $5`,
    [scope.workspaceId, scope.userId, access.canViewWorkspaceData, input.cursor || null, input.limit + 1]);
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit).map(row => {
    const rawDiagnostics = object(row.diagnostics), line = object(row.line);
    const sipStatus = typeof rawDiagnostics.sipStatus === 'number' && Number.isInteger(rawDiagnostics.sipStatus) && rawDiagnostics.sipStatus >= 100 && rawDiagnostics.sipStatus <= 699 ? rawDiagnostics.sipStatus : undefined;
    const recordedAt = row.finishedAt || row.lastEventAt;
    return {
      id: String(row.id), taskId: String(row.taskId), taskName: text(row.taskName, 100), attemptNumber: Number(row.attemptNumber), status: String(row.status),
      occurredAt: recordedAt ? new Date(recordedAt).toISOString() : null,
      lineName: text(line.name, 80) || '线路名称未记录', provider: 'HAOKEHU_SIP' as const,
      phoneNumber: text(row.phoneNumber, 40), ownerName: text(row.ownerName, 100), callId: typeof row.callId === 'string' ? row.callId : null,
      reason: code(row.reason), diagnostics: { ...(sipStatus !== undefined ? { sipStatus } : {}),
        cause: code(rawDiagnostics.cause) || undefined, sipDisposition: code(rawDiagnostics.sipDisposition) || undefined,
        leg: rawDiagnostics.leg === 'EMPLOYEE' || rawDiagnostics.leg === 'CUSTOMER' ? rawDiagnostics.leg : undefined },
    };
  });
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null, scope: access.canViewWorkspaceData ? 'workspace' as const : 'self' as const };
}
