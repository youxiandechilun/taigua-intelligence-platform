/*
 * 中文导读：客户管理：crm.db.ts。相关类型、配置或辅助实现集中在本文件。
 */
import prisma from '../../config/prisma.js';
import type {CrmDb} from './crm.service.js';
import type {Prisma} from '../../../prisma/generated/prisma/client.js';
export const crmDbFor=(client:typeof prisma|Prisma.TransactionClient):CrmDb=>({query:(sql,values=[])=>client.$queryRawUnsafe(sql.replace(/^SELECT (pg_advisory_xact_lock\(.*\))\s*;?$/is,'SELECT $1::text AS locked'),...values),transaction:fn=>'$transaction' in client?client.$transaction(tx=>fn(crmDbFor(tx)),{maxWait:10000,timeout:60000}):fn(crmDbFor(client))});
export const crmDb=crmDbFor(prisma);
