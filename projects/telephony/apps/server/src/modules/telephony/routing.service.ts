/*
 * 中文导读：为外呼选择可用线路，并处理路由配置和任务预览。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import {scopedOwnerSql,grants} from '../workspace/company-policy.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { crmDb } from '../crm/crm.db.js';
import { type CrmDb, type Scope, type Row, memberAccess } from '../crm/crm.service.js';
import { companyContext,scopedCompanyUserIds } from '../workspace/company-access.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { NotFoundError } from '../../common/errors/notFound.js';
import { lineSchema, type LineSettings } from './sip.schema.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import type { RecipientInput } from '../aliyun/aliyun.schema.js';

export const provinces = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆'] as const;
export function provinceOf(region: string): string {
  return provinces.find(p => region.includes(p)) || '';
}
const inputSchema = z.object({
  expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  line: lineSchema,
  provinces: z.array(z.enum(provinces)).min(1).max(31).transform(v => [...new Set(v)]),
  note: z.string().trim().max(500).default(''),
  enabled: z.boolean().default(true),
  assignedUserIds: z.array(z.string().min(1).max(100)).max(200).default([]).transform(v => [...new Set(v)]),
}).strict();
export type RouteChoice = { line: LineSettings; lineId: string; province: string };

export type LineHealth = {
  state: 'healthy' | 'degraded' | 'offline';
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string;
  cooldownUntil: string | null;
  checkedAt: string | null;
};

const emptyLineHealth = (): LineHealth => ({
  state: 'healthy',
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: '',
  cooldownUntil: null,
  checkedAt: null,
});

export function lineHealthFromSettings(value: unknown): LineHealth {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).health
    : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLineHealth();
  const h = raw as Record<string, unknown>;
  // Historical failures remain visible; they no longer suspend dispatch.
  const state = h.state === 'offline' || h.state === 'degraded' ? 'degraded' : 'healthy';
  const failures = typeof h.consecutiveFailures === 'number' && Number.isFinite(h.consecutiveFailures)
    ? Math.max(0, Math.floor(h.consecutiveFailures))
    : 0;
  return {
    state,
    consecutiveFailures: failures,
    lastSuccessAt: typeof h.lastSuccessAt === 'string' ? h.lastSuccessAt : null,
    lastFailureAt: typeof h.lastFailureAt === 'string' ? h.lastFailureAt : null,
    lastFailureReason: typeof h.lastFailureReason === 'string' ? h.lastFailureReason.slice(0, 200) : '',
    cooldownUntil: null,
    checkedAt: typeof h.checkedAt === 'string' ? h.checkedAt : null,
  };
}

function lineSettingsFromStored(value: unknown): LineSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  delete raw.health;
  delete raw.removedAt;
  return lineSchema.parse(raw);
}

const regionalLineSettings=(r:Row)=>({line:lineSettingsFromStored(r.settings),provinces:r.provinces,note:r.note||'',enabled:r.enabled,assignedUserIds:r.assignedUserIds});
// Kept for callers using the existing API; failure history is informational.
export function lineDispatchable(_health: LineHealth, _now = new Date()) {
  return true;
}

export async function defaultLineConfiguration(workspaceId: string, db: CrmDb = crmDb) {
  const stored = (await db.query('SELECT "settings" FROM "SipConnection" WHERE "workspaceId"=$1', [workspaceId]))[0]?.settings || {};
  const removedAt = typeof stored.removedAt === 'string' && stored.removedAt ? stored.removedAt : null;
  return { line: lineSettingsFromStored(stored), removed: removedAt !== null, removedAt };
}
export async function defaultLine(workspaceId: string, db: CrmDb = crmDb) {
  const stored = await defaultLineConfiguration(workspaceId, db);
  if (stored.removed) throw new BadRequestError('默认线路已移除，请选择其他可用线路，或由超级管理员先恢复后配置。');
  return stored.line;
}
async function rows(workspaceId: string, db: CrmDb) {
  return db.query('SELECT * FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL ORDER BY "createdAt","id"', [workspaceId]);
}
export async function regionalCatalog(s: Scope) {
  const [context, list, stored, scopes, removed] = await Promise.all([companyContext(s.workspaceId, s.userId), rows(s.workspaceId, crmDb),defaultLineConfiguration(s.workspaceId),crmDb.query('SELECT * FROM "SipDefaultLineScope" WHERE "workspaceId"=$1',[s.workspaceId]),crmDb.query('SELECT * FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NOT NULL ORDER BY "updatedAt" DESC',[s.workspaceId])]);
  const d=scopes[0]||{provinces:['广东'],assignedUserIds:[]};
  const base={id:'haokehu-default',settings:stored.line,provinces:d.provinces,assignedUserIds:d.assignedUserIds,note:'',enabled:!stored.removed,defaultLine:true,removedAt:stored.removedAt};
  if(stored.removed)removed.unshift(base);else list.unshift(base);
  const allowed=new Set(await scopedCompanyUserIds(s.workspaceId,s.userId));
  const canManage=grants(context.permissions,'lines','assign');
  return { canConfigure: context.isSystemAdmin, canManage, provinces, removedLines:context.isSystemAdmin?removed.map(r=>({id:r.id,name:r.settings.name,provinces:r.provinces,note:r.note,enabled:false,liveEnabled:r.settings.liveEnabled,line:lineSettingsFromStored(r.settings),assignedUserIds:r.assignedUserIds,defaultLine:r.defaultLine===true,removedAt:r.removedAt||r.deletedAt||null})):[],
    lines: list.filter(r => context.isSystemAdmin || !r.assignedUserIds.length || r.assignedUserIds.includes(s.userId) || canManage&&r.assignedUserIds.some((id:string)=>allowed.has(id))).map(r => ({
      id: r.id, revision:configurationRevision(regionalLineSettings(r)), assignmentRevision:configurationRevision([...r.assignedUserIds].sort()),scopeRevision:configurationRevision([...r.provinces].sort()), serviceProvider:r.settings.serviceProvider||'好客呼', defaultLine:r.defaultLine===true, quotaPending:false, name: r.settings.name, provinces: r.provinces, note: r.note, enabled: r.enabled, liveEnabled:r.settings.liveEnabled,
      ...(canManage ? { assignedUserIds: r.assignedUserIds.filter((id:string)=>allowed.has(id)),publicLine:!r.assignedUserIds.length,canAssign:context.allData||r.assignedUserIds.length>0 } : {}),
      ...(context.isSystemAdmin ? { line: lineSettingsFromStored(r.settings), health: lineHealthFromSettings(r.settings) } : { health: lineHealthFromSettings(r.settings) }),
    })),
  };
}
async function validEmployees(db: CrmDb, workspaceId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await db.query('SELECT "userId" FROM "Member" WHERE "organizationId"=$1 AND "enabled"=true AND "userId"=ANY($2::text[])', [workspaceId, ids]);
  if (found.length !== ids.length) throw new BadRequestError('线路分配中有不属于当前公司的员工。');
}
export async function assertSharedLine(db: CrmDb, line: LineSettings, exceptWorkspace?: string, exceptRoute?: string) {
  const peers = await db.query(`SELECT "settings" FROM "SipConnection" WHERE COALESCE("settings"->>'removedAt','')='' AND ($1::text IS NULL OR "workspaceId"<>$1) UNION ALL SELECT "settings" FROM "SipRegionalLine" WHERE "deletedAt" IS NULL AND ($2::text IS NULL OR "id"<>$2)`, [exceptWorkspace || null, exceptRoute || null]);
  if (line.serverIp && peers.some(p => p.settings.serverIp === line.serverIp && p.settings.port === line.port && p.settings.transport === line.transport && (p.settings.prefix||'')===(line.prefix||'') && (p.settings.employeePrefix||'')===(line.employeePrefix||'') && p.settings.trunkKey !== line.trunkKey)) throw new BadRequestError('同一网关和拨号前缀必须使用相同的共用线路标识。');
  if (line.serverIp && peers.some(p => p.settings.trunkKey === line.trunkKey && p.settings.serverIp && ['serverIp','port','transport','prefix','employeePrefix','codecs','concurrency','callsPerSecond'].some(k => !isDeepStrictEqual(p.settings[k], line[k as keyof LineSettings])))) throw new BadRequestError('同一共用线路的地址、编码及并发规则必须一致。');
}
export async function saveRegionalLine(s: Scope, id: string | null, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('线路参数仅系统超级管理员可以修改。');
  const data = inputSchema.parse(input);
  // Creating or editing never starts a call. Actual activation still has a server readiness gate.
  if (data.line.liveEnabled && (!data.line.serverIp || (data.line.callerMode!=='provider'&&!data.line.callerNumber) || !data.line.whitelistConfirmed)) throw new BadRequestError('请先填写线路参数并完成白名单确认。');
  return crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-line-config']);
    const list = await rows(s.workspaceId, db), prior = id ? list.find(r => r.id === id) : null;
    if (id && !prior) throw new NotFoundError('线路不存在或不属于当前工作区。');
    if(prior)assertConfigurationRevision(data.expectedRevision,regionalLineSettings(prior));
    if (!id && list.length >= 50) throw new BadRequestError('当前工作区最多配置50条省份线路。');
    for (const key of [...new Set([prior?.settings.trunkKey, data.line.trunkKey].filter(Boolean))].sort()) await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-trunk:' + key]);
    await validEmployees(db, s.workspaceId, data.assignedUserIds);
    await assertSharedLine(db, data.line, undefined, id || undefined);
    const lineId = id || randomUUID();
    const storedSettings = prior?.settings?.health ? { ...data.line, health: prior.settings.health } : data.line;
    await db.query(`INSERT INTO "SipRegionalLine" ("id","workspaceId","settings","provinces","note","enabled","assignedUserIds") VALUES ($1,$2,$3::jsonb,$4::text[],$5,$6,$7::text[]) ON CONFLICT ("id") DO UPDATE SET "settings"=(EXCLUDED."settings"-'health')||CASE WHEN "SipRegionalLine"."settings" ? 'health' THEN jsonb_build_object('health',"SipRegionalLine"."settings"->'health') ELSE '{}'::jsonb END,"provinces"=EXCLUDED."provinces","note"=EXCLUDED."note","enabled"=EXCLUDED."enabled","assignedUserIds"=EXCLUDED."assignedUserIds","updatedAt"=NOW() RETURNING "id"`, [lineId, s.workspaceId, JSON.stringify(storedSettings), data.provinces, data.note, data.enabled, data.assignedUserIds]);
    return { id: lineId };
  });
}
export async function assignRegionalLine(s: Scope, id: string, input: unknown) {
  if(id==='haokehu-default')return assignDefaultLine(s,input);
  const access=await memberAccess(crmDb,s);
  if(!grants(access.permissions,'lines','assign'))throw new ForbiddenError('当前角色不能分配线路。');
  const data = z.object({ assignedUserIds: inputSchema.shape.assignedUserIds,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(input);
  return crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['company-policy:'+s.workspaceId]);
    const currentAccess=await memberAccess(db,s);if(!grants(currentAccess.permissions,'lines','assign'))throw new ForbiddenError('线路分配权限已变更。');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-line-config']);
    const route=(await rows(s.workspaceId, db)).find(r => r.id === id);
    if (!route) throw new NotFoundError('线路不存在。');
    assertConfigurationRevision(data.expectedRevision,[...route.assignedUserIds].sort());
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+route.settings.trunkKey]);
    await validEmployees(db, s.workspaceId, data.assignedUserIds);
    const permitted=await db.query(`SELECT m."userId" FROM "Member" m WHERE m."organizationId"=$1 AND ${scopedOwnerSql('m."userId"')}`,[s.workspaceId,s.userId]);
    const allowed=new Set(permitted.map(m=>m.userId));
    if(data.assignedUserIds.some(id=>!allowed.has(id)))throw new ForbiddenError('只能为授权组织内的人员分配线路。');
    if(!currentAccess.allData){if(!route.assignedUserIds.length)throw new ForbiddenError('全公司公共线路的分配规则由全公司管理员维护。');data.assignedUserIds=[...new Set([...route.assignedUserIds.filter((id:string)=>!allowed.has(id)),...data.assignedUserIds])];}
    if(!currentAccess.allData&&!data.assignedUserIds.length)throw new ForbiddenError('部门范围内不能将专属线路改为全公司公共线路。');
    await db.query('UPDATE "SipRegionalLine" SET "assignedUserIds"=$3::text[],"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"', [s.workspaceId, id, data.assignedUserIds]);
    return { assigned: true };
  });
}
export async function archiveRegionalLine(s: Scope, id: string) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('线路由系统超级管理员管理。');
  if(id==='haokehu-default')return archiveDefaultLine(s);
  return crmDb.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-line-config']);
    const r = (await rows(s.workspaceId, db)).find(v => v.id === id);
    if (!r) throw new NotFoundError('线路不存在。');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-trunk:' + r.settings.trunkKey]);
    // Expired review leases remain historical records without reserving the line; missing leases still block removal.
    if ((await db.query(`SELECT "id" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "trunkKey"=$2 AND ("status" IN ('DISPATCHING','DIALING','CONNECTED') OR ("status"='NEEDS_REVIEW' AND ("leaseUntil" IS NULL OR "leaseUntil">NOW()))) LIMIT 1`, [s.workspaceId, r.settings.trunkKey])).length) throw new BadRequestError('线路还有通话或待核对记录，请处理后再移除。');
    await db.query('UPDATE "SipRegionalLine" SET "deletedAt"=NOW(),"enabled"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"', [s.workspaceId, id]);
    return { archived: true };
  });
}
async function archiveDefaultLine(s:Scope) {
  const result=await crmDb.transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-line-config']);
    const stored=await defaultLineConfiguration(s.workspaceId,db);
    if(stored.removed)return {archived:true};
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+stored.line.trunkKey]);
    // Expired review leases remain historical records without reserving the line; missing leases still block removal.
    if((await db.query(`SELECT "id" FROM "SipAttempt" WHERE "workspaceId"=$1 AND "trunkKey"=$2 AND ("status" IN ('DISPATCHING','DIALING','CONNECTED') OR ("status"='NEEDS_REVIEW' AND ("leaseUntil" IS NULL OR "leaseUntil">NOW()))) LIMIT 1`,[s.workspaceId,stored.line.trunkKey])).length)
      throw new BadRequestError('默认线路还有通话或待核对记录，请处理后再移除。');
    if((await db.query(`SELECT t."id" FROM "SipTask" t JOIN "SipAttempt" a ON a."workspaceId"=t."workspaceId" AND a."taskId"=t."id" WHERE t."workspaceId"=$1 AND t."status"='RUNNING' AND t."deletedAt" IS NULL AND COALESCE(t."snapshot"->>'provider','HAOKEHU_SIP')='HAOKEHU_SIP' AND a."trunkKey"=$2 AND a."status"='QUEUED' LIMIT 1`,[s.workspaceId,stored.line.trunkKey])).length)
      throw new BadRequestError('默认线路还有运行中的排队任务，请先暂停相关任务再移除。');
    const removedAt=new Date().toISOString();
    await db.query(`INSERT INTO "SipConnection" ("workspaceId","settings","updatedAt") VALUES ($1,$2::jsonb,NOW())
      ON CONFLICT ("workspaceId") DO UPDATE SET "settings"=jsonb_set(jsonb_set("SipConnection"."settings",'{removedAt}',to_jsonb($3::text)),'{liveEnabled}','false'::jsonb),"updatedAt"=NOW() RETURNING "workspaceId"`,[s.workspaceId,JSON.stringify({...stored.line,liveEnabled:false,removedAt}),removedAt]);
    return {archived:true};
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'sip.default-line.archived',resourceType:'SipConnection',resourceId:s.workspaceId});
  return result;
}
export async function resolveRecipientLines(s: Scope, recipients: RecipientInput[], db: CrmDb = crmDb, selection?:{lineId?:string;province?:string}): Promise<RouteChoice[]> {
  if(selection?.lineId){const selected=await selectedLine(s,selection,db);return recipients.map(()=>selected);}
  const ids = [...new Set(recipients.map(r => r.crmCompanyId).filter(Boolean))];
  const [stored, list, companies, defaultScopes] = await Promise.all([defaultLineConfiguration(s.workspaceId, db), rows(s.workspaceId, db), ids.length ? db.query('SELECT "id","region" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) AND "deletedAt" IS NULL', [s.workspaceId, ids]) : Promise.resolve([] as Row[]), db.query('SELECT "assignedUserIds" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1', [s.workspaceId])]);
  const base=stored.line;
  const access = await memberAccess(db, s);
  const defaultAssignees = defaultScopes[0]?.assignedUserIds || [];
  const regions = new Map(companies.map(c => [c.id, provinceOf(c.region)]));
  return recipients.map(r => {
    const province = regions.get(r.crmCompanyId) || '';
    // Adding another carrier must not silently replace the default carrier.
    // Alternative carriers are available through an explicit line selection.
    const sameProvider = list.filter(v => (v.settings.serviceProvider || '好客呼') === base.serviceProvider);
    const route = province ? (sameProvider.find(v => v.enabled && v.provinces.includes(province)) || sameProvider.find(v => v.provinces.includes(province))) : undefined;
    if (!route) {
      if(stored.removed)throw new BadRequestError('没有匹配的可用地区线路，默认线路已移除，请明确选择其他线路。');
      if (!access.isSystemAdmin && defaultAssignees.length && !defaultAssignees.includes(s.userId))
        throw new ForbiddenError('默认线路尚未分配给你，请联系管理员。'); return { line: base, lineId: '', province };
    } if (!route.enabled) throw new BadRequestError(province + '线路已停用，请联系管理员。');
    if (!access.isSystemAdmin && route.assignedUserIds.length && !route.assignedUserIds.includes(s.userId)) throw new ForbiddenError(province + '线路尚未分配给你，请联系管理员。');
    return { line: lineSettingsFromStored(route.settings), lineId: route.id, province };
  });
}

/**
 * Health is stored beside each line's settings to avoid a disruptive schema
 * migration. A shared trunk updates every local definition using that trunk,
 * so regional routing cannot accidentally send work to a known bad gateway.
 */
export async function readLineHealth(workspaceId: string, line: Pick<LineSettings, 'trunkKey'>, db: CrmDb = crmDb) {
  const rows = await db.query(`SELECT 'connection' AS "kind","workspaceId" AS "id","settings" FROM "SipConnection" WHERE "workspaceId"=$1 AND COALESCE("settings"->>'removedAt','')='' AND "settings"->>'trunkKey'=$2 UNION ALL SELECT 'regional' AS "kind","id","settings" FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL AND "settings"->>'trunkKey'=$2`, [workspaceId, line.trunkKey]);
  if (!rows.length) return emptyLineHealth();
  return rows.map(row => lineHealthFromSettings(row.settings)).sort((a, b) => b.consecutiveFailures - a.consecutiveFailures)[0] || emptyLineHealth();
}

export async function isLineDispatchable(_workspaceId: string, _line: Pick<LineSettings, 'trunkKey'>, _db: CrmDb = crmDb) {
  return true;
}

export async function recordLineOutcome(workspaceId: string, line: Pick<LineSettings, 'trunkKey'>, success: boolean, reason = '', db: CrmDb = crmDb): Promise<{ updated: number }> {
  if (db === crmDb)
    return crmDb.transaction(d => recordLineOutcome(workspaceId, line, success, reason, d));
  if (!line.trunkKey) return { updated: 0 };
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['sip-health:' + workspaceId + ':' + line.trunkKey]);
  const rows = await db.query(`SELECT 'connection' AS "kind","workspaceId" AS "id","settings" FROM "SipConnection" WHERE "workspaceId"=$1 AND COALESCE("settings"->>'removedAt','')='' AND "settings"->>'trunkKey'=$2 UNION ALL SELECT 'regional' AS "kind","id","settings" FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL AND "settings"->>'trunkKey'=$2`, [workspaceId, line.trunkKey]);
  const now = new Date().toISOString();
  let updated = 0;
  for (const row of rows) {
    const current = lineHealthFromSettings(row.settings);
    const health: LineHealth = success
      ? {...emptyLineHealth(), lastSuccessAt: now, checkedAt: now}
      : (() => {
        const consecutiveFailures = current.consecutiveFailures + 1;
        return {
          ...current,
          state: 'degraded',
          consecutiveFailures,
          lastFailureAt: now,
          lastFailureReason: reason.slice(0, 200),
          cooldownUntil: null,
          checkedAt: now,
        };
      })();
    const changed = row.kind === 'connection'
      ? await db.query(`UPDATE "SipConnection" SET "settings"=jsonb_set(COALESCE("settings",'{}'::jsonb),'{health}',$3::jsonb,true),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND COALESCE("settings"->>'removedAt','')='' AND "settings"->>'trunkKey'=$2 RETURNING "workspaceId"`, [workspaceId, line.trunkKey, JSON.stringify(health)])
      : await db.query(`UPDATE "SipRegionalLine" SET "settings"=jsonb_set(COALESCE("settings",'{}'::jsonb),'{health}',$3::jsonb,true),"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "settings"->>'trunkKey'=$4 AND "deletedAt" IS NULL RETURNING "id"`, [workspaceId, row.id, JSON.stringify(health), line.trunkKey]);
    updated += changed.length;
  }
  return {updated};
}

export async function selectedLine(s:Scope,selection:{lineId?:string;province?:string},db:CrmDb=crmDb):Promise<RouteChoice>{
 if(!selection.lineId||!selection.province)throw new BadRequestError('请选择省份和具体线路。');
 const access=await memberAccess(db,s);
 if(selection.lineId==='haokehu-default'){
  const scope=(await db.query('SELECT * FROM "SipDefaultLineScope" WHERE "workspaceId"=$1',[s.workspaceId]))[0]||{provinces:['广东'],assignedUserIds:[]};
  if(!scope.provinces.includes(selection.province))throw new BadRequestError('所选线路省份已变化，请重新选择。');
  if(!access.isSystemAdmin&&scope.assignedUserIds.length&&!scope.assignedUserIds.includes(s.userId))throw new ForbiddenError('此线路尚未分配给你。');
  return {line:await defaultLine(s.workspaceId,db),lineId:selection.lineId,province:selection.province};
 }
 const r=(await rows(s.workspaceId,db)).find(r=>r.id===selection.lineId);
 if(!r||!r.enabled||!r.provinces.includes(selection.province))throw new BadRequestError('所选线路已停用或省份已变化，请重新选择。');
 if(!access.isSystemAdmin&&r.assignedUserIds.length&&!r.assignedUserIds.includes(s.userId))throw new ForbiddenError('此线路尚未分配给你。');
 return {line:lineSettingsFromStored(r.settings),lineId:r.id,province:selection.province};
}
export async function saveDefaultScope(s:Scope,input:unknown){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('默认线路省份由超级管理员配置。');
 const data=z.object({provinces:inputSchema.shape.provinces,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(input);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-line-config']);
  const current=(await db.query('SELECT "provinces" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1',[s.workspaceId]))[0];
  assertConfigurationRevision(data.expectedRevision,[...(current?.provinces||['广东'])].sort());
  const line=await defaultLine(s.workspaceId,db);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+line.trunkKey]);
  await db.query('INSERT INTO "SipDefaultLineScope"("workspaceId","provinces","updatedAt") VALUES ($1,$2::text[],NOW()) ON CONFLICT ("workspaceId") DO UPDATE SET "provinces"=EXCLUDED."provinces","updatedAt"=NOW() RETURNING "workspaceId"',[s.workspaceId,data.provinces]);
 });return {saved:true,revision:configurationRevision([...data.provinces].sort())};
}
async function assignDefaultLine(s:Scope,input:unknown){
 const data=z.object({assignedUserIds:inputSchema.shape.assignedUserIds,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(input);
 return crmDb.transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+s.workspaceId]);const a=await memberAccess(db,s);if(!a.allData||!grants(a.permissions,'lines','assign'))throw new ForbiddenError('默认公共线路由全公司授权管理员分配。');await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-line-config']);const current=(await db.query('SELECT "assignedUserIds" FROM "SipDefaultLineScope" WHERE "workspaceId"=$1',[s.workspaceId]))[0];assertConfigurationRevision(data.expectedRevision,[...(current?.assignedUserIds||[])].sort());const line=await defaultLine(s.workspaceId,db);await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+line.trunkKey]);await validEmployees(db,s.workspaceId,data.assignedUserIds);await db.query('INSERT INTO "SipDefaultLineScope"("workspaceId","assignedUserIds","updatedAt") VALUES ($1,$2::text[],NOW()) ON CONFLICT ("workspaceId") DO UPDATE SET "assignedUserIds"=EXCLUDED."assignedUserIds","updatedAt"=NOW() RETURNING "workspaceId"',[s.workspaceId,data.assignedUserIds]);return {assigned:true};});
}
export async function restoreRegionalLine(s:Scope,id:string){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('线路由超级管理员管理。');
 if(id==='haokehu-default'){
  const result=await crmDb.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-line-config']);
   const stored=await defaultLineConfiguration(s.workspaceId,db);if(!stored.removed)throw new BadRequestError('默认线路未移除，无需恢复。');
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['sip-trunk:'+stored.line.trunkKey]);
   await db.query(`UPDATE "SipConnection" SET "settings"=("settings"-'removedAt')||'{"liveEnabled":false}'::jsonb,"updatedAt"=NOW() WHERE "workspaceId"=$1 RETURNING "workspaceId"`,[s.workspaceId]);
   return {restored:true};
  });
  await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:'sip.default-line.restored',resourceType:'SipConnection',resourceId:s.workspaceId});
  return result;
 }
 const changed=await crmDb.query('UPDATE "SipRegionalLine" SET "deletedAt"=NULL,"enabled"=false,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 AND "deletedAt" IS NOT NULL RETURNING "id"',[s.workspaceId,id]);if(!changed.length)throw new NotFoundError('线路不存在。');return {restored:true};
}
