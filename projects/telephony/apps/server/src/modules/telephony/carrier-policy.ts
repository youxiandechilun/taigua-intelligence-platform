/*
 * 中文导读：线路与语音外呼：carrier-policy.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { LineSettings } from './sip.schema.js';
import type { CrmDb, Scope } from '../crm/crm.service.js';
import type { RecipientInput } from '../aliyun/aliyun.schema.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { enabledTestNumberPhones, normalizeTestNumberPhone } from './test-number-whitelist.settings.js';

export function carrierWindowOpen(line: Pick<LineSettings,'carrierPolicy'>, now = new Date()) {
  if (!line.carrierPolicy) return true;
  const time = new Date(now.getTime()+8*3600000).toISOString().slice(11,16);
  return time >= line.carrierPolicy.start && time < line.carrierPolicy.end;
}

export async function carrierRecipientIssue(db:CrmDb, s:Scope, line:LineSettings, recipient:RecipientInput) {
  return (await carrierRecipientIssues(db, s, [{ line }], [recipient]))[0]!;
}
// One batch read avoids a database round trip for every imported phone number.
// The dispatch worker repeats this check under the trunk lock before each call.
export async function carrierRecipientIssues(db: CrmDb, s: Scope, routes: { line: LineSettings }[], recipients: RecipientInput[]): Promise<string[]> {
  const companies = [...new Set(recipients.flatMap((recipient, index) => routes[index]?.line.carrierPolicy?.blockedProvinces?.length && recipient.crmCompanyId ? [recipient.crmCompanyId] : []))];
  const limited = routes.map(route => route.line).filter(line => line.carrierPolicy?.maxCallsPerNumberPerDay! > 0);
  const trunks = [...new Set(limited.map(line => line.trunkKey))];
  const numbers = [...new Set(recipients.map(recipient => recipient.phoneNumber))];
  const [regions, history, whitelisted] = await Promise.all([
    companies.length ? db.query('SELECT "id","region" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) AND "deletedAt" IS NULL', [s.workspaceId, companies]) : Promise.resolve([]),
    trunks.length ? db.query(`WITH recent_tasks AS MATERIALIZED (
SELECT DISTINCT a."taskId",a."workspaceId" FROM "SipAttempt" a
WHERE a."trunkKey"=ANY($1::text[]) AND a."startedAt">=NOW()-INTERVAL '24 hours'
), matching_recipients AS MATERIALIZED (
SELECT t.id,t."workspaceId",(r.ordinality-1)::int AS idx,
  jsonb_array_length(CASE WHEN jsonb_typeof(t.recipients)='array' THEN t.recipients ELSE '[]'::jsonb END) AS len,
  r.value->>'phoneNumber' AS number
FROM recent_tasks recent JOIN "SipTask" t ON t.id=recent."taskId" AND t."workspaceId"=recent."workspaceId"
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.recipients)='array' THEN t.recipients ELSE '[]'::jsonb END) WITH ORDINALITY r(value,ordinality)
WHERE r.value->>'phoneNumber'=ANY($2::text[])
) SELECT a."trunkKey",r.number AS "phoneNumber",count(*)::int AS count
FROM matching_recipients r JOIN "SipAttempt" a ON a."taskId"=r.id AND a."workspaceId"=r."workspaceId"
  AND a."recipientIndex"=ANY(ARRAY[r.idx,r.idx-r.len])
WHERE a."trunkKey"=ANY($1::text[]) AND a."startedAt">=NOW()-INTERVAL '24 hours'
GROUP BY a."trunkKey",r.number`, [trunks, numbers]) : Promise.resolve([]),
    limited.length ? enabledTestNumberPhones(s.workspaceId, db) : Promise.resolve(new Set<string>()),
  ]);
  const regionById = new Map(regions.map(company => [company.id, company.region]));
  const counts = new Map(history.map(row => [JSON.stringify([row.trunkKey, row.phoneNumber]), Number(row.count)]));
  return recipients.map((recipient, index) => {
    const line = routes[index]!.line, policy = line.carrierPolicy;
  if (!policy) return '';
  // Carrier gateways enforce their mobile coverage. Also stop known CRM
  // locations locally; a selected caller province is not a recipient location.
      const blocked = (policy.blockedProvinces || []).find(province => regionById.get(recipient.crmCompanyId)?.includes(province));
    if (blocked) return `${line.serviceProvider}不支持拨打${blocked}地区，请选择其他线路`;

      let normalized = recipient.phoneNumber;
      try { normalized = normalizeTestNumberPhone(normalized); } catch { /* Invalid numbers cannot match a canonical whitelist entry. */ }
      if (!whitelisted.has(normalized) && policy.maxCallsPerNumberPerDay > 0 && (counts.get(JSON.stringify([line.trunkKey, recipient.phoneNumber])) || 0) >= policy.maxCallsPerNumberPerDay) return `已达到${line.serviceProvider}单个号码24小时内${policy.maxCallsPerNumberPerDay}次的上限`;

      return '';
    });
}
export function carrierBatchSummary(recipients: RecipientInput[], issues: string[]) {
  const reasons = new Map<string, number>();
  for (const reason of issues.filter(Boolean))
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  const skippedCount = issues.filter(Boolean).length;
  return { totalCount: recipients.length, acceptedCount: recipients.length - skippedCount, skippedCount, skipReasons: [...reasons].map(([reason, count]) => ({ reason, count })) };
}

export async function assertCarrierRecipient(db:CrmDb,s:Scope,line:LineSettings,recipient:RecipientInput) {
  const issue=await carrierRecipientIssue(db,s,line,recipient);
  if(issue)throw new BadRequestError(issue+'。');
}
