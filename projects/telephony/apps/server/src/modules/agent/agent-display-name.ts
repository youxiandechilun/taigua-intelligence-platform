/*
 * 中文导读：数字员工与话术：agent-display-name.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { CrmDb } from '../crm/crm.service.js';

type NamedRecord = {
  agentId?: string | null;
  userId?: string | null;
  createdBy?: string | null;
  agentName?: string | null;
};
const nameKey = (agentId: string, ownerId?: string | null) => JSON.stringify([agentId, ownerId || null]);

// Apply only to rows the caller has already authorized. Names follow the record
// owner, including when an administrator reads another employee's task or call.
// This changes display metadata only; execution snapshots remain immutable.
export async function withCurrentAgentNames<T extends NamedRecord>(
  db: CrmDb, organizationId: string, records: T[], ownerField: 'userId' | 'createdBy' = 'userId',
): Promise<(T & { agentName: string | null })[]> {
  const requested = new Map<string, { agentId: string; ownerId: string | null }>();
  for (const record of records) if (record.agentId) {
    requested.set(nameKey(record.agentId, record[ownerField]), { agentId: record.agentId, ownerId: record[ownerField] || null });
  }
  if (!requested.size) return records.map(record => ({ ...record, agentName: record.agentName || null }));
  const rows = await db.query(`SELECT requested."agentId",requested."ownerId",
    NULLIF(btrim(a."name"),'') AS name
    FROM jsonb_to_recordset($2::jsonb) AS requested("agentId" text,"ownerId" text)
    JOIN "Agent" a ON a."agentId"=requested."agentId" AND a."organizationId"=$1
    LEFT JOIN "EmployeePlaybook" p ON p."workspaceId"=$1 AND p."agentId"=a."agentId" AND p."userId"=requested."ownerId"`,
    [organizationId, JSON.stringify([...requested.values()])]);
  const names = new Map(rows.map(row => [nameKey(row.agentId, row.ownerId), row.name as string | null]));
  return records.map(record => ({ ...record, agentName: record.agentId ? names.get(nameKey(record.agentId, record[ownerField])) || record.agentName || null : record.agentName || null }));
}
