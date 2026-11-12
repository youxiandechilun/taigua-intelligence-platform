/*
 * 中文导读：线路与语音外呼：service-providers.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crmDb } from '../crm/crm.db.js';
import { type Scope } from '../crm/crm.service.js';
import { companyContext } from '../workspace/company-access.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';

export async function serviceProviders(s: Scope) {
  const [context, providers, used] = await Promise.all([
    companyContext(s.workspaceId, s.userId),
    crmDb.query('SELECT "id","name" FROM "SipServiceProvider" WHERE "workspaceId"=$1 ORDER BY "createdAt","id"', [s.workspaceId]),
    crmDb.query(`SELECT "settings"->>'serviceProvider' AS name FROM "SipConnection" WHERE "workspaceId"=$1 AND COALESCE("settings"->>'removedAt','')='' UNION SELECT "settings"->>'serviceProvider' AS name FROM "SipRegionalLine" WHERE "workspaceId"=$1 AND "deletedAt" IS NULL`, [s.workspaceId]),
  ]);
  const names = new Map<string, {id:string;name:string}>();
  for (const item of [{id:'builtin-haokehu',name:'好客呼'}, ...used.filter(v=>v.name).map(v=>({id:v.name,name:v.name})), ...providers]) names.set(item.name, {id:item.id,name:item.name});
  return { canConfigure:context.isSystemAdmin, providers:[...names.values()] };
}

export async function createServiceProvider(s: Scope, input: unknown) {
  if (!(await companyContext(s.workspaceId, s.userId)).isSystemAdmin) throw new ForbiddenError('服务商由超级管理员新增。');
  const {name} = z.object({name:z.string().trim().min(1,'请填写服务商名称').max(80)}).strict().parse(input);
  const result = await crmDb.query(`INSERT INTO "SipServiceProvider"("id","workspaceId","name") VALUES ($1,$2,$3) ON CONFLICT ("workspaceId","name") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id","name"`, [randomUUID(),s.workspaceId,name]);
  return result[0];
}
