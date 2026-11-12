/*
 * 中文导读：员工账号：accounts.route.ts。声明接口路径、中间件和处理函数。
 */
import {isSystemAdminRole} from "../../lib/access-control.js";
import { generateAccountPassword, optionalAccountPassword } from "./account-password.js";
import { accountUsername } from "./account-identity.js";
import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { recordAuditEvent } from "../audit/audit-log.service.js";
import { auth } from "../../lib/auth.js";
import prisma from "../../config/prisma.js";
import { trustedOrigins } from "../../config/origins.js";
import { crmDb } from "../crm/crm.db.js";
import { deleteCompany, restoreCompany } from "./company-lifecycle.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { UnauthenticatedError } from "../../common/errors/unauthenticated.js";

const router = Router();
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,40}$/, "账号须为 3 至 40 位字母、数字、下划线或短横线");
const nameSchema = z.string().trim().min(1).max(80);
const uuid = z.string().uuid();
const domain = process.env.ACCOUNT_EMAIL_DOMAIN || "dx.zezejun.cn";
const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(wrap(async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new UnauthenticatedError("请先登录。");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, banned: true, deletedAt: true } });
  if (!user || user.banned || user.deletedAt || !isSystemAdminRole(user.role)) throw new ForbiddenError("仅超级管理员可以管理平台账号和公司工作区。");
  if (!["GET", "HEAD"].includes(req.method) && !trustedOrigins.includes(req.get("origin") || "")) throw new ForbiddenError("请在系统正式地址中操作。");
  res.locals.adminId = session.user.id;
  res.locals.sessionId = session.session.id;
  res.locals.impersonatedBy = session.session.impersonatedBy;
  res.locals.activeOrganizationId = session.session.activeOrganizationId;
  res.setHeader("Cache-Control", "no-store");
  next();
}));
const selectUser = { id: true, name: true, email: true, role: true, banned: true, deletedAt: true, createdAt: true, departmentId: true, department: { select: { id: true, name: true } }, members: { select: { id: true, role: true, enabled: true, companyDepartment: {select:{id:true,name:true}}, organization: { select: { id: true, name: true } } } } } as const;
const present = <T extends { email: string }>(u: T) => ({ ...u, username: accountUsername(u.email, domain) });
async function departmentExists(id: string | null | undefined) {
  if (id && !await prisma.department.findUnique({ where: { id } })) throw new BadRequestError("该部门不存在，请重新选择。");
}
async function manageable(id: string, adminId: string, allowDeleted = false) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, deletedAt: true, members: { select: { organizationId: true } } } });
  if (!user || (user.deletedAt && !allowDeleted)) throw new BadRequestError("账号不存在或已删除。");
  if (user.id === adminId || user.role?.split(",").includes("admin")) throw new ForbiddenError("此操作不适用于系统管理员账号。");
  return user;
}
router.get('/switch-options',wrap(async(_req,res)=>{
 const orgId=res.locals.activeOrganizationId;
 if(!orgId||res.locals.impersonatedBy)throw new ForbiddenError('请以超级管理员身份选择当前工作区。');
 const actor=await prisma.member.findFirst({where:{organizationId:orgId,userId:res.locals.adminId,enabled:true,deletedAt:null,organization:{deletedAt:null}}});
 if(!actor)throw new ForbiddenError('当前工作区不可用。');
 const rows=await prisma.member.findMany({where:{organizationId:orgId,enabled:true,deletedAt:null,user:{banned:false,deletedAt:null,id:{not:res.locals.adminId}}},select:{user:{select:{id:true,name:true,email:true,role:true}}},orderBy:{createdAt:'asc'},take:1000});
 res.json({success:true,data:rows.filter(row=>!isSystemAdminRole(row.user.role)).map(({user})=>({id:user.id,name:user.name,username:present(user).username}))});
}));
router.patch('/me/username',wrap(async(req,res)=>{
 if(res.locals.impersonatedBy)throw new ForbiddenError('请先返回超级管理员。');
 const input=z.object({username:usernameSchema,expectedUsername:z.string().min(1).max(256),currentPassword:z.string().min(1).max(128)}).strict().parse(req.body);
 const userId=res.locals.adminId as string;
 const current=await prisma.user.findUniqueOrThrow({where:{id:userId},select:{email:true}});
 const currentAccount=await prisma.account.findFirst({where:{userId,providerId:'credential'},select:{id:true,password:true}});
 if(!currentAccount?.password||!await bcrypt.compare(input.currentPassword,currentAccount.password))throw new BadRequestError('当前密码不正确。');
 if(present(current).username!==input.expectedUsername)throw new BadRequestError('登录账号已更新，请重新打开此页。');
 const email=`${input.username}@${domain}`;
 if(email===current.email){res.json({success:true,data:{username:input.username}});return;}
 try{
  await prisma.$transaction(async tx=>{
   const actor=await tx.user.findUnique({where:{id:userId},select:{email:true,role:true,banned:true,deletedAt:true}});
   const credential=await tx.account.findUnique({where:{id:currentAccount.id},select:{password:true}});
   if(!actor||actor.banned||actor.deletedAt||!isSystemAdminRole(actor.role))throw new ForbiddenError('仅超级管理员可以修改自己的登录账号。');
   if(actor.email!==current.email||credential?.password!==currentAccount.password)throw new BadRequestError('账号资料已变化，请重新验证。');
   await tx.user.update({where:{id:userId},data:{email}});
   await tx.session.deleteMany({where:{userId,id:{not:res.locals.sessionId}}});
  });
 }catch(error){if((error as {code?:string}).code==='P2002')throw new BadRequestError('登录账号已被使用，请换一个。');throw error;}
 await recordAuditEvent({organizationId:res.locals.activeOrganizationId,userId,action:'system.account.username_changed',resourceType:'user',resourceId:userId,metadata:{previousUsername:input.expectedUsername,username:input.username}});
 res.json({success:true,data:{username:input.username}});
}));
router.get("/", wrap(async (req, res) => {
  res.json({ success: true, data: (await prisma.user.findMany({ where: { deletedAt: req.query.deleted === "true" ? { not: null } : null }, select: selectUser, orderBy: { createdAt: "desc" }, take: 1000 })).map(present) });
}));
router.get("/departments", wrap(async (_req, res) => res.json({ success: true, data: await prisma.department.findMany({ orderBy: { name: "asc" } }) })));
router.post("/departments", wrap(async (req, res) => {
  const { name } = z.object({ name: nameSchema }).strict().parse(req.body);
  if (await prisma.department.findUnique({ where: { name } })) throw new BadRequestError("部门名称已存在。");
  res.status(201).json({ success: true, data: await prisma.department.create({ data: { id: randomUUID(), name } }) });
}));
router.patch("/departments/:id", wrap(async (req, res) => {
  const id = uuid.parse(req.params.id); const { name } = z.object({ name: nameSchema }).strict().parse(req.body);
  if (!await prisma.department.findUnique({ where: { id } })) throw new BadRequestError("部门不存在。");
  if (await prisma.department.findFirst({ where: { name, id: { not: id } } })) throw new BadRequestError("部门名称已存在。");
  res.json({ success: true, data: await prisma.department.update({ where: { id }, data: { name } }) });
}));
router.post("/", wrap(async (req, res) => {
  const input = z.object({ username: usernameSchema, name: nameSchema, departmentId: uuid.nullable().optional(), organizationId: uuid, companyRole:z.enum(["admin","member"]), accountType:z.enum(["employee","super_admin"]).default("employee") }).strict().parse(req.body);
  await departmentExists(input.departmentId);
  const email = `${input.username}@${domain}`;
  if (await prisma.user.findUnique({ where: { email } })) throw new BadRequestError("账号已存在，请换一个账号名称。");
  const initialPassword = generateAccountPassword(); const hash = await bcrypt.hash(initialPassword, 10); const userId = randomUUID(); const orgId = input.organizationId;
  const result = await prisma.$transaction(async tx => {
    const actor=await tx.user.findUnique({where:{id:res.locals.adminId},select:{role:true,banned:true,deletedAt:true}});
    if(!actor||actor.banned||actor.deletedAt||!isSystemAdminRole(actor.role))throw new ForbiddenError("只有超级管理员可以创建平台账号。");
    const company=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Organization" WHERE "id"=${orgId} AND "deletedAt" IS NULL FOR SHARE`;
    if(!company.length)throw new BadRequestError("请选择正常使用的公司工作区。");
    await tx.user.create({ data: { id: userId, email, name: input.name, emailVerified: true, role: input.accountType === "super_admin" ? "admin" : "user", departmentId: input.departmentId ?? null } });
    await tx.account.create({ data: { id: randomUUID(), accountId: userId, providerId: "credential", userId, password: hash } });
    await tx.member.create({ data: { id: randomUUID(), userId, organizationId: orgId, role: input.accountType === "super_admin" ? "admin" : input.companyRole, createdAt: new Date() } });
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: selectUser });
  });
  await recordAuditEvent({organizationId:orgId,userId:res.locals.adminId,action:input.accountType === "super_admin"?"system.super_admin.created":"system.account.created",resourceType:"user",resourceId:userId});
  res.status(201).json({ success: true, data: { account: present(result), credentials: { username: input.username, password: initialPassword } } });
}));
router.patch("/:id/department", wrap(async (req, res) => {
  const id = uuid.parse(req.params.id); const { departmentId } = z.object({ departmentId: uuid.nullable() }).strict().parse(req.body);
  if (!await prisma.user.findUnique({ where: { id } })) throw new BadRequestError("账号不存在。");
  await departmentExists(departmentId);
  res.json({ success: true, data: present(await prisma.user.update({ where: { id }, data: { departmentId }, select: selectUser })) });
}));
router.patch("/:id/status", wrap(async (req, res) => {
  const id = uuid.parse(req.params.id); const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
  const user = await manageable(id, res.locals.adminId);
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id }, data: { banned: !enabled, banReason: enabled ? null : "管理员已停用", banExpires: null } });
    if (!enabled) {
      await tx.session.deleteMany({ where: { userId: id } });
      // Company API keys belong to the workspace, not the suspended employee.
      await tx.$executeRaw`UPDATE "LeadSearchJob" SET "status"='PAUSED',"message"='账号已停用，任务已暂停' WHERE "ownerId"=${id} AND "status"='SEARCHING'`;
    }
  });
  res.json({ success: true, data: { enabled } });
}));
router.post("/:id/reset-password", wrap(async (req, res) => {
  const id = uuid.parse(req.params.id); await manageable(id, res.locals.adminId);
  const input = optionalAccountPassword.parse(req.body ?? {});
  const newPassword = input.password ?? generateAccountPassword(); const hash = await bcrypt.hash(newPassword, 10);
  const user = await prisma.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
    const updated = await tx.account.updateMany({ where: { userId: id, providerId: "credential" }, data: { password: hash } });
    if (!updated.count) throw new BadRequestError("该账号缺少密码登录配置，请联系技术支持。");
    await tx.session.deleteMany({ where: { userId: id } });
    return user;
  });
  res.json({ success: true, data: { username: present(user).username, password: newPassword } });
}));
router.delete("/:id", wrap(async (req, res) => {
 const id = uuid.parse(req.params.id); await manageable(id, res.locals.adminId);
 await prisma.$transaction(async tx => {
  await tx.user.update({where:{id},data:{deletedAt:new Date(),banned:true,banReason:"管理员已删除账号",banExpires:null}});
  await tx.session.deleteMany({where:{userId:id}});
  await tx.$executeRaw`UPDATE "LeadSearchJob" SET "status"='PAUSED',"message"='账号已删除，任务已暂停' WHERE "ownerId"=${id} AND "status"='SEARCHING'`;
 });
 res.json({success:true,data:{deleted:true}});
}));
router.post("/:id/restore", wrap(async (req,res) => {
 const id = uuid.parse(req.params.id); const user = await manageable(id,res.locals.adminId,true);
 if(!user.deletedAt) throw new BadRequestError("此账号未删除。");
 await prisma.user.update({where:{id},data:{deletedAt:null,banned:true,banReason:"已恢复，等待管理员启用"}});
 res.json({success:true,data:{restored:true}});
}));
router.put("/:id/membership",wrap(async(req,res)=>{
 const userId=uuid.parse(req.params.id);const input=z.object({organizationId:uuid,companyRole:z.enum(["admin","member"]),enabled:z.boolean()}).strict().parse(req.body);
 await manageable(userId,res.locals.adminId);
 await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"company-user:"+userId}))::text AS locked`;
  const company=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Organization" WHERE "id"=${input.organizationId} AND "deletedAt" IS NULL FOR SHARE`;
  if(!company.length)throw new BadRequestError("公司工作区不存在或已移入回收站。");
  const membership=await tx.member.findFirst({where:{organizationId:input.organizationId,userId}});
  if(membership?.role==="owner")throw new ForbiddenError("不能在此修改工作区所有者。");
  if(membership)await tx.member.update({where:{id:membership.id},data:{role:input.companyRole,enabled:input.enabled,...(input.enabled?{deletedAt:null}:{}),companyRoleId:null,scopeDepartmentIds:[]}});
  else await tx.member.create({data:{id:randomUUID(),organizationId:input.organizationId,userId,role:input.companyRole,enabled:input.enabled,createdAt:new Date()}});
  await tx.session.deleteMany({where:{userId,activeOrganizationId:input.organizationId}});
  if(!input.enabled)await tx.$executeRaw`UPDATE "LeadSearchJob" SET "status"='PAUSED',"message"='公司权限已停用，任务已暂停' WHERE "organizationId"=${input.organizationId} AND "ownerId"=${userId} AND "status"='SEARCHING'`;
 });
 await recordAuditEvent({organizationId:input.organizationId,userId:res.locals.adminId,action:"company.membership.assigned",resourceType:"user",resourceId:userId,metadata:{companyRole:input.companyRole,enabled:input.enabled}});
 res.json({success:true,data:{userId,...input}});
}));
router.get("/companies",wrap(async(req,res)=>{
 const companies=await prisma.organization.findMany({where:{deletedAt:req.query.deleted==="true"?{not:null}:null},select:{id:true,name:true,deletedAt:true,members:{where:{userId:res.locals.adminId},select:{enabled:true,deletedAt:true}}},orderBy:{createdAt:"asc"}});
 res.json({success:true,data:companies.map(({members,...company})=>({...company,accessStatus:members.some(m=>m.enabled&&!m.deletedAt)?'ACTIVE':members.length?'DISABLED':'UNASSIGNED'}))});
}));
router.delete("/companies/:id",wrap(async(req,res)=>{
 const organizationId=uuid.parse(req.params.id);
 const {confirmationName}=z.object({confirmationName:nameSchema}).strict().parse(req.body);
 const data=await deleteCompany(crmDb,{organizationId,confirmationName,actorId:res.locals.adminId,activeOrganizationId:res.locals.activeOrganizationId});
 res.json({success:true,data});
}));
router.post("/companies/:id/restore",wrap(async(req,res)=>{
 const organizationId=uuid.parse(req.params.id);
 z.object({}).strict().parse(req.body??{});
 const data=await restoreCompany(crmDb,{organizationId,actorId:res.locals.adminId});
 res.json({success:true,data});
}));
router.post("/companies",wrap(async(req,res)=>{
 const {name}=z.object({name:nameSchema}).strict().parse(req.body);const id=randomUUID();
 const company=await prisma.$transaction(async tx=>{
  const org=await tx.organization.create({data:{id,name,slug:`company-${id}`,createdAt:new Date(),logo:null},select:{id:true,name:true}});
  await tx.member.create({data:{id:randomUUID(),organizationId:id,userId:res.locals.adminId,role:"owner",createdAt:new Date()}});
  await tx.billingAccount.create({data:{organizationId:id}});return org;
 });res.status(201).json({success:true,data:company});
}));
export default router;
