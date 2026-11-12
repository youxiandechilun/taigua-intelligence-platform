/*
 * 中文导读：客户管理：crm.import.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { BadRequestError } from "../../common/errors/badRequest.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { companyKey,regionFromAddress } from "./crm.phone.js";
import {
  crmService,
  memberAccess,
  type CrmDb,
  type Scope,
  type Row,
} from "./crm.service.js";
import { importRows, readWorkbook, validateImportRow } from "./crm.files.js";
export function legacyImportRow(c:Row,line=1){
 return validateImportRow({name:c.companyName,industry:c.industry,region:regionFromAddress(c.address||''),address:c.address,business:c.business,source:c.sourceUrl,phone:c.phone},line);
}
async function resolveOwner(db: CrmDb, s: Scope, ownerName: string, canManage: boolean) {
  if (!ownerName || ownerName === '当前账号') return undefined;
  const owners = await db.query('SELECT u."id" FROM "User" u JOIN "Member" m ON m."userId"=u."id" WHERE m."organizationId"=$1 AND m."enabled"=true AND u."banned"=false AND u."deletedAt" IS NULL AND (u."name"=$2 OR u."email"=$2)', [s.workspaceId, ownerName]);
  if (!owners.length) throw new BadRequestError(`找不到负责人“${ownerName}”，请填写本工作区员工姓名或登录账号。`);
  if (owners.length > 1) throw new BadRequestError(`负责人“${ownerName}”重名，请改用登录账号。`);
  if (!canManage && owners[0]!.id !== s.userId) throw new ForbiddenError('只有管理员可以在导入表中指定其他负责人。');
  return owners[0]!.id as string;
}
export async function previewFile(
  db: CrmDb,
  s: Scope,
  name: string,
  encoded: string,
) {
  const access = await memberAccess(db, s);
  const rows = importRows(readWorkbook(Buffer.from(encoded, "base64"), name));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.company) continue;
    try { await resolveOwner(db, s, r.ownerName, access.canManage); }
    catch (error) { r.error = error instanceof Error ? error.message : '负责人校验失败'; continue; }
    const key = companyKey(r.company.name);
    const existing = (
      await db.query(
        'SELECT "id" FROM "CrmCompany" WHERE "workspaceId"=$1 AND "nameKey"=$2 AND "deletedAt" IS NULL',
        [s.workspaceId, key],
      )
    ).length;
    (r as Row).duplicate = Boolean(existing || seen.has(key));
    seen.add(key);
  }
  return {
    rows,
    valid: rows.filter((r) => !r.error).length,
    errors: rows.filter((r) => r.error).length,
  };
}
export async function importPrepared(
  db: CrmDb,
  s: Scope,
  rows: ReturnType<typeof importRows>,
  legacy?: Row[],
) {
  const access = await memberAccess(db, s);
  let imported = 0,
    duplicates = 0;
  const errors: Row[] = [];
  const companies: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.error || !r.company || !r.contact) {
      errors.push({ line: r.line, error: r.error });
      continue;
    }
    try {
      const result = await db.transaction(async (db) => {
        const api = crmService(db);
        const currentAccess = await memberAccess(db, s);
        const original = legacy?.[i];
        if(original)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked',[s.workspaceId+':legacy:'+original.id]);
        if (
          original &&
          (
            await db.query(
              'SELECT "id" FROM "CrmLead" WHERE "workspaceId"=$1 AND "sourceContactId"=$2',
              [s.workspaceId, original.id],
            )
          ).length
        ) {
          await db.query(`UPDATE "CrmCompany" c SET "region"=CASE WHEN c."region"='' THEN $4 ELSE c."region" END,"industry"=CASE WHEN c."industry"='' THEN $5 ELSE c."industry" END,"address"=CASE WHEN c."address"='' THEN $6 ELSE c."address" END,"business"=CASE WHEN c."business"='' THEN $7 ELSE c."business" END WHERE c."workspaceId"=$1 AND c."deletedAt" IS NULL AND ($3 OR c."ownerId"=$2 OR $2=ANY(c."authorizedUserIds")) AND EXISTS (SELECT 1 FROM "CrmLead" l WHERE l."workspaceId"=c."workspaceId" AND l."companyId"=c."id" AND l."sourceContactId"=$8) RETURNING c."id"`,[s.workspaceId,s.userId,currentAccess.canManage,r.company.region,r.company.industry,r.company.address,r.company.business,original.id]);
          return { duplicate: true, companyId: null };
        }
        let c = (
          await db.query(
            'SELECT * FROM "CrmCompany" WHERE "workspaceId"=$1 AND "nameKey"=$2 AND "deletedAt" IS NULL',
            [s.workspaceId, companyKey(r.company.name)],
          )
        )[0];
        if (
          c &&
          !currentAccess.canManage &&
          c.ownerId !== s.userId &&
          !c.authorizedUserIds.includes(s.userId)
        ) {
          return { duplicate: true, companyId: null };
        }
        const importedOwnerId = await resolveOwner(db, s, r.ownerName, currentAccess.canManage);
        if (!c)
          c = await api.createCompany(s, {
            ...r.company,
            ...(original ? {status:({NEW:'REVIEW',INTERESTED:'INTERESTED',FOLLOW_UP:'FOLLOW_UP',NO_NEED:'INVALID',OPT_OUT:'OPT_OUT'} as Row)[original.status]||'REVIEW'} : {}),
            nextFollowUp: r.contact.doNotCall ? null : r.lead.nextFollowUp,
            ...(importedOwnerId ? { ownerId: importedOwnerId } : {}),
            ...(original && currentAccess.canManage
              ? { ownerId: original.ownerId }
              : {}),
          });
        const phone =
          r.contact.mobile || (r.contact.areaCode || "") + r.contact.landline;
        const existing = (
          await db.query(
            'SELECT * FROM "CrmContact" WHERE "workspaceId"=$1 AND "companyId"=$2 AND "phoneKey"=$3 AND "deletedAt" IS NULL',
            [s.workspaceId, c.id, phone],
          )
        )[0];
        let contact = existing;
        if (!contact)
          contact = await api.createContact(s, {
            ...r.contact,
            companyId: c.id,
            status: original?.status === "OPT_OUT" ? "OPT_OUT" : r.contact.status,
            doNotCall: original?.status === "OPT_OUT" || r.contact.doNotCall,
          });
        if (existing && !original) {
          return { duplicate: true, companyId: null };
        }
        const map: Record<string, string> = {
          NEW: "REVIEW",
          INTERESTED: "INTERESTED",
          FOLLOW_UP: "FOLLOW_UP",
          NO_NEED: "INVALID",
          OPT_OUT: "OPT_OUT",
        };
        const l = await api.createLead(s, {
          companyId: c.id,
          contactId: contact.id,
          status: original ? map[original.status] || "REVIEW" : r.lead.status,
          notes: original?.notes || r.lead.notes || "",
          nextFollowUp: original?.nextFollowUp
            ? new Date(original.nextFollowUp).toISOString()
            : r.lead.nextFollowUp
              ? new Date(r.lead.nextFollowUp).toISOString()
            : null,
        });
        if (original)
          await db.query(
            'UPDATE "CrmLead" SET "sourceContactId"=$3 WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',
            [s.workspaceId, l.id, original.id],
          );
        if (original?.status === "OPT_OUT")
          await api.follow(s, c.id, {
            status: "OPT_OUT",
            notes: "原客户记录已拒绝联系，导入后保留拒呼状态。",
            nextFollowUp: null,
            taskTitle: "",
          });
        return { duplicate: false, companyId: c.id };
      });
      if (result.duplicate) duplicates++;
      else {
        imported++;
        companies.push(result.companyId!);
      }
    } catch (e) {
      const code = (e as Row)?.code;
      errors.push({
        line: r.line,
        error:
          code === "23505" || (code === "P2010" && (e as Row)?.meta?.code === "23505")
            ? "已有重复记录，未覆盖原资料。"
            : e instanceof Error
              ? e.message
              : "本行未导入",
      });
    }
  }
  return { imported, duplicates, errors, companyIds: [...new Set(companies)] };
}
export async function importFile(
  db: CrmDb,
  s: Scope,
  name: string,
  encoded: string,
) {
  await memberAccess(db, s);
  return importPrepared(
    db,
    s,
    importRows(readWorkbook(Buffer.from(encoded, "base64"), name)),
  );
}
export async function importLegacy(db: CrmDb, s: Scope) {
  const m = await memberAccess(db, s);
  const source = await db.query(
    'SELECT * FROM "BusinessContact" WHERE "organizationId"=$1 AND "deletedAt" IS NULL AND ($3 OR "ownerId"=$2) ORDER BY "createdAt" LIMIT 5001',
    [s.workspaceId, s.userId, m.canManage],
  );
  if (source.length > 5000)
    throw new BadRequestError("原客户超过5000条，请按线索表分批导入。");
  const rows = source.map((c, i) => legacyImportRow(c,i+1));
  return importPrepared(db, s, rows, source);
}
