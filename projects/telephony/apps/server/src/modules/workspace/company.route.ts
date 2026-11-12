/*
 * 中文导读：工作区与权限：company.route.ts。声明接口路径、中间件和处理函数。
 */
import {Router} from 'express';
import {z} from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import {authorized,requirePermission} from '../../middleware/authorize.middleware.js';
import {trustedOrigins} from '../../config/origins.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {companyContext,scopedCompanyUserIds} from './company-access.js';
import prisma from '../../config/prisma.js';
import {scopeLabels} from './company-policy.js';
import {optionalAccountPassword} from '../accounts/account-password.js';
import {navigationPolicy,saveNavigationPolicy} from './navigation-policy.js';
import * as management from './company-management.js';
const router=Router(),uuid=z.string().uuid();
router.use(authMiddleware,requirePermission({}),authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录后管理公司人员。');
 if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||''))throw new ForbiddenError('请在正式系统地址中操作。');
 res.locals.company=await companyContext(req.auth.activeOrganizationId,req.auth.userId);res.setHeader('Cache-Control','private, no-store');next();
}));
const scope=(req:{auth:{activeOrganizationId:string;userId:string}})=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const send=(res:{json:(v:unknown)=>unknown},data:unknown)=>res.json({success:true,data});
router.get('/context',authorized(async(req,res)=>{
 const c=res.locals.company as Awaited<ReturnType<typeof companyContext>>;
 const ids=await scopedCompanyUserIds(req.auth.activeOrganizationId,req.auth.userId);
 const list=(c.canManageMembers||c.canAssignCustomers||c.canManageSeats||c.permissions.lines?.includes('assign')||c.permissions.automation?.includes('update'))?await prisma.member.findMany({where:{organizationId:req.auth.activeOrganizationId,userId:{in:ids},enabled:true,deletedAt:null,user:{banned:false,deletedAt:null}},select:{userId:true,role:true,user:{select:{name:true}},companyRole:{select:{name:true}},companyDepartment:{select:{id:true,name:true}}},orderBy:{createdAt:'asc'}}):[];
 send(res,{...c,navigation:await navigationPolicy(req.auth.activeOrganizationId),scopeLabel:scopeLabels[c.dataScope],assignees:list.map(m=>({id:m.userId,name:m.user.name,role:m.companyRole?.name??m.role,department:m.companyDepartment}))});
}));
router.put('/navigation',authorized(async(req,res)=>send(res,await saveNavigationPolicy(req.auth.activeOrganizationId,req.auth.userId,req.body))));
router.use('/:organizationId',authorized(async(req,_res,next)=>{if(req.params.organizationId!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新后再操作。');next();}));
router.get('/:organizationId/organization-options',authorized(async(req,res)=>send(res,await management.assignmentUnits(scope(req)))));
router.get('/:organizationId/departments',authorized(async(req,res)=>send(res,await management.listUnits(scope(req)))));
router.post('/:organizationId/departments',authorized(async(req,res)=>send(res,await management.saveUnit(scope(req),req.body))));
router.patch('/:organizationId/departments/:id',authorized(async(req,res)=>send(res,await management.saveUnit(scope(req),req.body,uuid.parse(req.params.id)))));
router.delete('/:organizationId/departments/:id',authorized(async(req,res)=>send(res,await management.deleteUnit(scope(req),uuid.parse(req.params.id)))));
router.get('/:organizationId/roles',authorized(async(req,res)=>send(res,await management.listRoles(scope(req)))));
router.post('/:organizationId/roles',authorized(async(req,res)=>send(res,await management.saveRole(scope(req),req.body))));
router.patch('/:organizationId/roles/:id',authorized(async(req,res)=>send(res,await management.saveRole(scope(req),req.body,uuid.parse(req.params.id)))));
router.delete('/:organizationId/roles/:id',authorized(async(req,res)=>{const d=z.object({replacementRoleId:uuid.optional()}).strict().parse(req.body??{});send(res,await management.deleteRole(scope(req),uuid.parse(req.params.id),d.replacementRoleId));}));
router.get('/:organizationId/assignable-roles',authorized(async(req,res)=>send(res,await management.assignableRoles(scope(req)))));
router.get('/:organizationId/members',authorized(async(req,res)=>send(res,await management.listMembers(scope(req),req.query.deleted==='true'))));
router.post('/:organizationId/members/batch',authorized(async(req,res)=>send(res,await management.createMemberBatch(scope(req),req.body))));
router.post('/:organizationId/members',authorized(async(req,res)=>send(res,await management.createMember(scope(req),req.body))));
router.patch('/:organizationId/members/:id/assignment',authorized(async(req,res)=>send(res,await management.updateMember(scope(req),uuid.parse(req.params.id),req.body))));
router.patch('/:organizationId/members/:id/department',authorized(async(req,res)=>{const id=uuid.parse(req.params.id),d=z.object({departmentId:uuid.nullable()}).strict().parse(req.body);const m=(await management.listMembers(scope(req))).find(m=>m.id===id);if(!m)throw new ForbiddenError('员工不在授权范围。');send(res,await management.updateMember(scope(req),id,{...d,companyRoleId:m.companyRoleId,scopeDepartmentIds:m.scopeDepartmentIds,expectedAccessRevision:m.accessRevision}));}));
router.patch('/:organizationId/members/:id',authorized(async(req,res)=>{const d=z.object({enabled:z.boolean(),departmentId:uuid.nullable().optional(),handoverTo:uuid.optional()}).strict().parse(req.body);send(res,await management.memberStatus(scope(req),uuid.parse(req.params.id),d.enabled,d.handoverTo));}));
router.delete('/:organizationId/members/:id',authorized(async(req,res)=>{const d=z.object({handoverTo:uuid.optional()}).strict().parse(req.body??{});send(res,await management.deleteMember(scope(req),uuid.parse(req.params.id),d.handoverTo));}));
router.post('/:organizationId/members/:id/restore',authorized(async(req,res)=>send(res,await management.restoreMember(scope(req),uuid.parse(req.params.id)))));
router.post('/:organizationId/members/:id/reset-password',authorized(async(req,res)=>{const d=optionalAccountPassword.parse(req.body??{});send(res,await management.resetMemberPassword(scope(req),uuid.parse(req.params.id),d.password));}));
router.use((error:unknown,_req:unknown,_res:unknown,next:(e:unknown)=>void)=>{if(error instanceof z.ZodError)return next(new BadRequestError('请检查名称、组织、角色和权限字段。'));next(error);});
export default router;
