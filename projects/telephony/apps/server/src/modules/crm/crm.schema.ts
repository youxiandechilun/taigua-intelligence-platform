/*
 * 中文导读：客户管理：crm.schema.ts。定义请求数据结构与校验约束。
 */
import { z } from 'zod';
export const statuses=['REVIEW','READY','CONNECTED','INTERESTED','FOLLOW_UP','WON','INVALID','OPT_OUT'] as const;
const text=(n:number)=>z.string().trim().max(n);
export const companyInput=z.object({name:text(160).min(2),industry:text(80).default(''),region:text(80).default(''),address:text(300).default(''),business:text(1000).default(''),website:text(2000).refine(v=>!v||/^https?:\/\//.test(v),'官网需要 http:// 或 https:// 开头').default(''),creditCode:text(18).refine(v=>!v||/^[0-9A-Z]{18}$/.test(v),'信用代码应为18位大写字母或数字').default(''),phone:text(60).default(''),source:text(2000).default(''),ownerId:text(100).optional(),authorizedUserIds:z.array(text(100)).max(100).optional(),status:z.enum(statuses).default('REVIEW'),tags:z.array(text(40).min(1)).max(30).default([]),nextFollowUp:z.iso.datetime({offset:true}).nullable().default(null)}).strict();
export const contactInput=z.object({companyId:z.string().uuid(),name:text(80).default(''),position:text(80).default(''),mobile:text(60).default(''),landline:text(60).default(''),areaCode:text(8).default(''),extension:text(6).regex(/^\d*$/).default(''),wechatNote:text(500).default(''),email:text(200).refine(v=>!v||z.email().safeParse(v).success,'邮箱格式不正确').default(''),status:z.enum(statuses).default('REVIEW'),doNotCall:z.boolean().default(false)}).strict();
export const leadInput=z.object({companyId:z.string().uuid(),contactId:z.string().uuid().nullable().default(null),status:z.enum(statuses),notes:text(4000).default(''),nextFollowUp:z.iso.datetime({offset:true}).nullable().default(null)}).strict();
export const taskInput=z.object({companyId:z.string().uuid(),contactId:z.string().uuid().nullable().default(null),ownerId:text(100).optional(),title:text(160).min(1),notes:text(4000).default(''),dueAt:z.iso.datetime({offset:true})}).strict();
export const followInput=z.object({contactId:z.string().uuid().nullable().default(null),status:z.enum(statuses),notes:text(4000).min(1),nextFollowUp:z.iso.datetime({offset:true}).nullable().default(null),taskTitle:text(160).default('')}).strict();
export const listInput=z.object({q:text(160).default(''),industry:text(80).default(''),region:text(80).default(''),status:z.enum(statuses).optional(),tag:text(40).default(''),companyId:z.string().uuid().optional(),due:z.enum(['true','false']).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)});
export type CrmCompanyInput=z.infer<typeof companyInput>;
