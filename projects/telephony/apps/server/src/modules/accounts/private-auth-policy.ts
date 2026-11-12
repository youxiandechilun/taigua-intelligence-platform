/*
 * 中文导读：员工账号：private-auth-policy.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../../lib/auth.js";
import prisma from "../../config/prisma.js";

// Accounts are administrator managed. Users may create their own private
// workspaces, but may not invite other accounts or join their workspaces.
const blocked = new Set([
  "/sign-up/email", "/sign-in/social", "/link-social", "/change-email",
  "/request-password-reset", "/forget-password", "/reset-password", "/delete-user",
  "/organization/delete", "/organization/invite-member",
  "/organization/accept-invitation", "/organization/add-member", "/organization/remove-member",
  "/organization/update-member-role", "/organization/leave",
  "/admin/create-user", "/admin/set-user-password", "/admin/set-role",
  "/admin/remove-user", "/admin/update-user", "/admin/ban-user", "/admin/unban-user",
]);
export const privateAuthPolicy: RequestHandler = async (req, res, next) => {
 try {
  const path = req.path.toLowerCase().replace(/\/+$/, "");
  if (blocked.has(path) || path.startsWith("/callback/")) {
    res.status(403).json({ success: false, code: "ADMIN_MANAGED_ACCOUNTS", message: "账号由管理员统一创建和维护，请联系管理员。" });
    return;
  }
  if(path==='/organization/list'){
   const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
   if(!session){res.status(401).json({message:'请先登录。'});return;}
   const organizations=await prisma.organization.findMany({
    where:{deletedAt:null,members:{some:{userId:session.user.id,enabled:true,deletedAt:null,user:{banned:false,deletedAt:null}}}},
    select:{id:true,name:true,slug:true,logo:true,createdAt:true,metadata:true},orderBy:{createdAt:'asc'}
   });
   res.setHeader('Cache-Control','no-store');res.json(organizations);return;
  }
   if (path.startsWith('/organization/') && !['/organization/list', '/organization/create', '/organization/set-active'].includes(path)) {
   const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
   if(!session){res.status(401).json({message:'请先登录。'});return;}
   let orgId=req.body?.organizationId||req.query.organizationId||session.session.activeOrganizationId;
   if(typeof req.query.organizationSlug==='string'){const org=await prisma.organization.findFirst({where:{slug:req.query.organizationSlug},select:{id:true}});orgId=org?.id;}
   const member=typeof orgId==='string'?await prisma.member.findFirst({where:{organizationId:orgId,userId:session.user.id,enabled:true,deletedAt:null,organization:{deletedAt:null},user:{banned:false,deletedAt:null}}}):null;
   if(!member){res.status(403).json({message:'该公司工作区未分配或已停用，请联系管理员。'});return;}
  }
  next();
 }catch(error){next(error);}
};
