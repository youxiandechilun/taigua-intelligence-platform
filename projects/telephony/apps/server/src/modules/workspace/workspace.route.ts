/*
 * 中文导读：工作区与权限：workspace.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import authMiddleware from '../../middleware/auth.middleware.js';
import { authorized,requirePermission } from '../../middleware/authorize.middleware.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { trustedOrigins } from '../../config/origins.js';
import { getWorkspaceProfile,saveWorkspaceProfile,workspaceProfileSchema } from './workspace.profile.js';
import * as announcements from './workspace.announcements.js';
import {companyContext} from './company-access.js';
const router=Router();
router.use(authMiddleware,(req,res,next)=>requirePermission(req.path.startsWith('/announcements')?{}:{outboundCalls:['read']})(req,res,next));
router.use(authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录后管理当前工作区。');
 const member=await prisma.member.findFirst({where:{organizationId:req.auth.activeOrganizationId,userId:req.auth.userId},select:{role:true}});
 if(!member)throw new ForbiddenError('你无权访问此工作区。');
 if(req.path.startsWith('/announcements')) {
  if(req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新公告页面后再操作。');
  res.setHeader('Cache-Control','private, no-store');
 }
 if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||''))throw new ForbiddenError('请在正式系统地址保存公司设置。');
 next();
}));
const announcementScope=(req:{auth:{activeOrganizationId:string;userId:string}})=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
router.get('/announcements/active',authorized(async(req,res)=>res.json({success:true,data:await announcements.activeAnnouncements(announcementScope(req))})));
router.get('/announcements',authorized(async(req,res)=>res.json({success:true,data:await announcements.listAnnouncements(announcementScope(req),announcements.announcementListInput.parse(req.query))})));
router.post('/announcements',authorized(async(req,res)=>res.json({success:true,data:await announcements.publishAnnouncement(announcementScope(req),req.body)})));
router.put('/announcements/:id',authorized(async(req,res)=>res.json({success:true,data:await announcements.editAnnouncement(announcementScope(req),z.string().uuid().parse(req.params.id),req.body)})));
router.post('/announcements/:id/stop',authorized(async(req,res)=>res.json({success:true,data:await announcements.stopOrDeleteAnnouncement(announcementScope(req),z.string().uuid().parse(req.params.id),req.body,false)})));
router.delete('/announcements/:id',authorized(async(req,res)=>res.json({success:true,data:await announcements.stopOrDeleteAnnouncement(announcementScope(req),z.string().uuid().parse(req.params.id),req.body,true)})));
router.get('/profile',authorized(async(req,res)=>{
 const {isSystemAdmin:canEdit}=await companyContext(req.auth.activeOrganizationId,req.auth.userId);
 res.setHeader('Cache-Control','private, no-store');
 res.json({success:true,data:{...await getWorkspaceProfile(req.auth.activeOrganizationId),canEdit}});
}));
router.put('/:organizationId/profile',requirePermission({organization:['update']}),authorized(async(req,res)=>{
 if(req.params.organizationId!==req.auth.activeOrganizationId)throw new ForbiddenError("工作区已切换，请刷新公司设置后再保存。");
 const profile=await saveWorkspaceProfile(req.auth.activeOrganizationId,workspaceProfileSchema.parse(req.body));
 res.json({success:true,data:{...profile,canEdit:true}});
}));
router.use((error:unknown,_req:unknown,_res:unknown,next:(e:unknown)=>void)=>next(error instanceof z.ZodError?new BadRequestError(error.issues.map(issue=>issue.message).join('；')):error));
export default router;
