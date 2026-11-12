/*
 * 中文导读：工作区菜单可见性与功能入口权限。
 */
import {z} from 'zod';
import prisma from '../../config/prisma.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {requireSystemAdminAccess,isSystemAdminRole} from '../../lib/access-control.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';

export const navigationIds=['dashboard','agents','outbound','calls','kb','crm','wecom','tools','automation','settings'] as const;
export type NavigationId=typeof navigationIds[number];
const labels=['仪表盘','数字员工','外呼','通话记录','知识库','客户库','企业微信','业务工具','自动化','设置中心'];
const defaults=navigationIds.map((id,index)=>({id,label:labels[index]!,enabled:true}));
const itemSchema=z.object({id:z.enum(navigationIds),label:z.string().trim().min(1,'请输入菜单名称').max(20,'菜单名称最多20字').regex(/^[^\u0000-\u001f\u007f]+$/,'菜单名称不能包含换行或控制字符'),enabled:z.boolean()}).strict();
const itemsSchema=z.array(itemSchema).length(navigationIds.length).refine(items=>new Set(items.map(item=>item.id)).size===navigationIds.length,'菜单不可重复或缺少');
const inputSchema=z.object({items:itemsSchema,expectedRevision:z.number().int().min(0)}).strict();
function metadata(raw:string|null):Record<string,unknown>{try{const value=JSON.parse(raw||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}return raw?{legacyMetadata:raw}:{};}
function present(raw:unknown){
 const value=raw&&typeof raw==='object'?raw as {items?:unknown;revision?:unknown}:{};
 const parsed=itemsSchema.safeParse(value.items);
 return {items:parsed.success?parsed.data:defaults.map(item=>({...item})),revision:Number.isSafeInteger(value.revision)&&Number(value.revision)>=0?Number(value.revision):0};
}
export async function navigationPolicy(organizationId:string){
 const org=await prisma.organization.findUnique({where:{id:organizationId},select:{metadata:true}});
 if(!org)throw new ForbiddenError('工作区不存在。');
 return present(metadata(org.metadata).navigation);
}
export async function saveNavigationPolicy(organizationId:string,userId:string,raw:unknown){
 await requireSystemAdminAccess(userId);
 const input=inputSchema.parse(raw);
 const result=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  const org=await tx.organization.findUnique({where:{id:organizationId},select:{metadata:true}});
  if(!org)throw new ForbiddenError('工作区不存在。');
  const all=metadata(org.metadata),prior=present(all.navigation);
  if(prior.revision!==input.expectedRevision)throw new BadRequestError('菜单设置已在其他页面更新，请重新载入后修改。');
  const next={items:input.items,revision:prior.revision+1};
  await tx.organization.update({where:{id:organizationId},data:{metadata:JSON.stringify({...all,navigation:next})}});
  return next;
 });
 await recordAuditEvent({organizationId,userId,action:'workspace.navigation.updated',resourceType:'Organization',resourceId:organizationId,metadata:result});
 return result;
}

// Shared bootstrap endpoints stay available so a closed section cannot prevent
// sign-in, workspace switching or loading the navigation policy itself.
export function requestNavigationArea(originalUrl:string,method:string):NavigationId|null{
 const path=originalUrl.split('?')[0]!.replace(/^\/api\/v1(?=\/)/,'');
 const area=path.split('/')[1];
 if(area==='dashboard')return 'dashboard';
 if(area==='agents')return 'agents';
 if(area==='outbound-calls')return 'outbound';
 if(area==='calls'||area==='customer-followup')return 'calls';
 if(area==='kb'||area==='workspace-knowledge')return 'kb';
 if(area==='crm')return 'crm';
 if(area==='wecom')return 'wecom';
 if(area==='business'||area==='tools'||area==='mcp')return 'tools';
 if(area==='automation')return 'automation';
 if(area==='company'&&!/^\/company\/(context|navigation)\/?$/.test(path))return 'settings';
 if(area==='billing'||area==='numbers'||area==='secrets'||area==='admin')return 'settings';
 if(area==='workspaces')return method==='GET'?null:'settings';
  if(area==='aliyun' && /^\/aliyun\/import(\/|$)/.test(path))return 'outbound';
 if(area==='aliyun')return 'settings';
 if(area==='telephony'){
  if(/^\/telephony\/(tasks|manual|test-calls|demo-calls|attempts)(\/|$)/.test(path))return 'outbound';
  if(/^\/telephony\/recordings(\/|$)/.test(path))return 'calls';
  if(/^\/telephony\/line-failures(\/|$)/.test(path))return 'calls';
  if(/^\/telephony\/(my-voices|script-recordings|agents)(\/|$)/.test(path))return 'agents';
  if(method==='GET'&&/^\/telephony\/voices\/[^/]+\/(opening(\/audio)?|cached-preview|current-preview)$/.test(path))return 'agents';
  if(method==='GET'&&/^\/telephony\/(connection|capacity|lines|caller-numbers|seats|aliyun-engine)(\/|$)/.test(path))return null;
  return 'settings';
 }
 return null;
}

export async function navigationAvailable(organizationId:string,userId:string,area:NavigationId){
 const policy=await navigationPolicy(organizationId);
 if(policy.items.find(item=>item.id===area)?.enabled!==false)return true;
 const user=await prisma.user.findUnique({where:{id:userId},select:{role:true,banned:true,deletedAt:true}});
 return !!user&&!user.banned&&!user.deletedAt&&isSystemAdminRole(user.role);
}
