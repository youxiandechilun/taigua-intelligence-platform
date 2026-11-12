/*
 * 中文导读：登录会话、身份验证与认证配置。
 */
import { validateWorkspaceLogo } from "../modules/workspace/workspace.profile.js";
import { APIError, betterAuth } from "better-auth";
import { AUTH_IP_ADDRESS_OPTIONS } from "../middleware/auth-client-ip.middleware.js";
import { createAuthMiddleware } from "better-auth/api";
import type { Invitation } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { stripe } from "@better-auth/stripe";
import bcrypt from "bcryptjs";

import prisma from "../config/prisma.js";
import { stripeClient } from "../config/stripe.js";
import { sendEmail, sendWorkspaceInvitation } from "./mailer.js";
import { ac, roles } from "./permissions.js";

import { plans } from "../../data/plans.js";
import {
  isSecureServerUrl,
  serverBaseUrl,
  trustedOrigins,
} from "../config/origins.js";
import { cleanupOrganizationDeletionHook } from "../modules/organization/organization-cleanup.service.js";
import { ensureBillingAccount } from "../modules/billing/wallet-ledger.service.js";
import { maybeGrantSignupCredit } from "../modules/billing/signup-credit.service.js";
import { ORGANIZATION_API_KEY_PERMISSIONS } from "../middleware/api-key-auth.js";
import { isHostedBilling } from "../config/billing-mode.js";
import { isSystemAdminRole } from "./access-control.js";
import { recordAuditEvent } from "../modules/audit/audit-log.service.js";

// ─── Better Auth server instance ────────────────────────────────────────────
export const auth = betterAuth({
  baseURL: serverBaseUrl,
  basePath: `/api/${process.env.API_VERSION! || "v1"}/auth`,
  trustedOrigins,
  advanced: {
    ipAddress: AUTH_IP_ADDRESS_OPTIONS,
    useSecureCookies: isSecureServerUrl,
    crossSubDomainCookies: {
      enabled: !!process.env.COOKIE_DOMAIN,
      domain: process.env.COOKIE_DOMAIN,
    },
  },
  // Employee logins can share one office IP. Keep a short login guard,
  // but allow a batch of employees to sign in together.
  rateLimit: {
    customRules: {
      "/sign-in/email": { window: 10, max: 100 },
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  hooks: {
    // Organization API keys are platform credentials in this deployment.
    // Better Auth otherwise treats an organization admin as sufficient, which
    // would let a company administrator create a credential for integrations.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/organization/set-active') {
        const session = ctx.context.session ?? (ctx.headers ? await auth.api.getSession({ headers: ctx.headers }) : null);
        if (!session?.user?.id)
          throw new APIError('UNAUTHORIZED', { message: '请先登录。' });
        // Clearing the active selection grants no workspace access.
        if (ctx.body?.organizationId === null)
          return;
        const requestedId = ctx.body?.organizationId, requestedSlug = ctx.body?.organizationSlug;
        if ((requestedId !== undefined && typeof requestedId !== 'string') || (requestedSlug !== undefined && typeof requestedSlug !== 'string'))
          throw new APIError('BAD_REQUEST', { message: '请选择有效的公司工作区。' });
        let organizationId = requestedId;
        if (!organizationId && requestedSlug) {
          const organization = await prisma.organization.findFirst({ where: { slug: requestedSlug, deletedAt: null }, select: { id: true } });
          organizationId = organization?.id;
          if (!organizationId)
            throw new APIError('FORBIDDEN', { message: '该公司工作区未分配或已停用，请联系管理员。' });
        }
        organizationId ||= session.session.activeOrganizationId;
        if (!organizationId)
          return;
        const member = await prisma.member.findFirst({ where: { organizationId, userId: session.user.id, enabled: true, deletedAt: null, organization: { deletedAt: null }, user: { banned: false, deletedAt: null } }, select: { id: true } });
        if (!member)
          throw new APIError('FORBIDDEN', { message: '该公司工作区未分配或已停用，请联系管理员。' });
        return;
      } if (ctx.path === '/admin/stop-impersonating') {
        const session=ctx.headers?await auth.api.getSession({headers:ctx.headers}):null;
        const originalId=session?.session.impersonatedBy;
        const original=originalId?await prisma.user.findUnique({where:{id:originalId},select:{role:true,banned:true,deletedAt:true}}):null;
        if(!original||original.banned||original.deletedAt||!isSystemAdminRole(original.role))throw new APIError('FORBIDDEN',{message:'原超级管理员账号已不可用，请重新登录。'});
        return;
      }
      if(ctx.path==='/change-password'){
        const session=ctx.headers?await auth.api.getSession({headers:ctx.headers}):null;
        const user=session?await prisma.user.findUnique({where:{id:session.user.id},select:{role:true,banned:true,deletedAt:true}}):null;
        if(!user||user.banned||user.deletedAt||session?.session.impersonatedBy||!isSystemAdminRole(user.role))throw new APIError('FORBIDDEN',{message:'仅超级管理员可修改自己的密码。'});
        const password=(ctx.body as {newPassword?:unknown}|undefined)?.newPassword;
        if(typeof password!=='string'||password.length<8||Buffer.byteLength(password,'utf8')>72)throw new APIError('BAD_REQUEST',{message:'新密码至少8位，最多72字节。'});
        return;
      }
      const restricted=ctx.path?.startsWith("/api-key/")||ctx.path?.startsWith("/admin/")||["/organization/create-role","/organization/update-role","/organization/delete-role","/organization/update-member-role","/organization/remove-member","/organization/invite-member","/organization/create","/organization/update","/organization/delete"].includes(ctx.path||"");
      if(!restricted)return;
      const session = ctx.context.session ?? (ctx.headers?await auth.api.getSession({headers:ctx.headers}):null);
      if (!session?.user?.id) throw new APIError("UNAUTHORIZED",{message:"请先登录。"});
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, banned: true, deletedAt:true } });
      if (!user || user.banned || user.deletedAt || !isSystemAdminRole(user.role)) {
        throw new APIError("FORBIDDEN", { message: "此入口仅超级管理员可操作，人员和角色请在账号与部门中管理。" });
      }
      if(ctx.path==='/admin/impersonate-user'){
        if(session.session.impersonatedBy)throw new APIError('FORBIDDEN',{message:'请先返回超级管理员再切换账号。'});
        const orgId=session.session.activeOrganizationId,targetId=(ctx.body as {userId?:unknown}|undefined)?.userId;
        if(!orgId||typeof targetId!=='string'||targetId===session.user.id)throw new APIError('BAD_REQUEST',{message:'请选择当前工作区的员工账号。'});
        const [actor,target]=await Promise.all([
          prisma.member.findFirst({where:{organizationId:orgId,userId:session.user.id,enabled:true,deletedAt:null,organization:{deletedAt:null}}}),
          prisma.member.findFirst({where:{organizationId:orgId,userId:targetId,enabled:true,deletedAt:null,organization:{deletedAt:null},user:{banned:false,deletedAt:null}},select:{user:{select:{role:true}}}})
        ]);
        if(!actor||!target||isSystemAdminRole(target.user.role))throw new APIError('FORBIDDEN',{message:'只能切换到当前工作区中正常使用的员工账号。'});
      }
      if (["/admin/ban-user", "/admin/remove-user", "/admin/set-role"].includes(ctx.path || "")) {
        const targetId=(ctx.body as {userId?:string}|undefined)?.userId;
        const target=targetId?await prisma.user.findUnique({where:{id:targetId},select:{role:true}}):null;
        if(target&&isSystemAdminRole(target.role))throw new APIError("FORBIDDEN",{message:"超级管理员账号不能在此入口停用、删除或降级。"});
      }
    }),
    // Better Auth swallows sendInvitationEmail failures. This hook covers both
    // creation and resend, and returns a delivery error to the caller.
    after: createAuthMiddleware(async (ctx) => {
      if(['/admin/impersonate-user','/admin/stop-impersonating','/change-password'].includes(ctx.path||'')){
        const result=ctx.context.returned as {session?:{userId?:string;activeOrganizationId?:string;impersonatedBy?:string};user?:{id?:string};token?:unknown}|undefined;
        if(result&&typeof result==='object'&&!(result instanceof APIError)){
          const prior=ctx.context.session;
          const orgId=prior?.session.activeOrganizationId||result.session?.activeOrganizationId;
          const actorId=ctx.path==='/admin/impersonate-user'?result.session?.impersonatedBy:ctx.path==='/admin/stop-impersonating'?result.user?.id:prior?.user.id;
          if(orgId&&actorId&&(result.session||ctx.path==='/change-password'&&'token' in result))await recordAuditEvent({organizationId:orgId,userId:actorId,action:ctx.path==='/admin/impersonate-user'?'system.account.switched':ctx.path==='/admin/stop-impersonating'?'system.account.switch_ended':'system.account.password_changed',resourceType:'user',resourceId:ctx.path==='/admin/stop-impersonating'?prior?.user.id:result.user?.id||actorId});
        }
        return;
      }
      if (ctx.path !== "/organization/invite-member") return;
      const invitation = ctx.context.returned as Invitation | undefined;
      if (!invitation || invitation.status !== "pending") return;
      try {
        const [org, inviter] = await Promise.all([
          ctx.context.adapter.findOne<{ name: string }>({
            model: "organization",
            where: [{ field: "id", value: invitation.organizationId }],
          }),
          ctx.context.adapter.findOne<{ name: string }>({
            model: "user",
            where: [{ field: "id", value: invitation.inviterId }],
          }),
        ]);
        if (!org || !inviter) throw new Error("Invitation context is unavailable");
        await sendWorkspaceInvitation({
          invitationId: invitation.id,
          email: invitation.email,
          role: invitation.role,
          workspaceName: org.name,
          inviterName: inviter.name,
          expiresAt: invitation.expiresAt,
        });
      } catch {
        console.error("[organization] invitation email delivery failed", {
          organizationId: invitation.organizationId,
        });
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "Could not send the invitation email. Retry using Resend in pending invites.",
        });
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          if (session.impersonatedBy) {
            const original = ctx?.context?.session;
            const organizationId = original?.session?.activeOrganizationId;
            if (ctx?.path !== '/admin/impersonate-user' || !organizationId || original?.user?.id !== session.impersonatedBy || original.session.impersonatedBy || ctx.body?.userId !== session.userId)
              throw new APIError('FORBIDDEN', { message: '切换账号的工作区已失效，请重新选择。' });
            const [actor, target] = await Promise.all([
              prisma.member.findFirst({ where: { organizationId, userId: original.user.id, enabled: true, deletedAt: null, organization: { deletedAt: null }, user: { banned: false, deletedAt: null } }, select: { user: { select: { role: true } } } }),
              prisma.member.findFirst({ where: { organizationId, userId: session.userId, enabled: true, deletedAt: null, organization: { deletedAt: null }, user: { banned: false, deletedAt: null } }, select: { user: { select: { role: true } } } })
            ]);
            if (!actor || !isSystemAdminRole(actor.user.role) || !target || isSystemAdminRole(target.user.role))
              throw new APIError('FORBIDDEN', { message: '只能切换到当前工作区中正常使用的员工账号。' });
            return { data: { ...session, activeOrganizationId: organizationId } };
          } const member = await prisma.member.findFirst({ where: { userId: session.userId, enabled: true, deletedAt: null, organization: { deletedAt: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { organizationId: true } });
          if (!member) throw new APIError("FORBIDDEN", { message: "账号未分配工作区，请联系管理员。" });
          return { data: { ...session, activeOrganizationId: member.organizationId } };
        },
      },
    },
    user: {
      update: {
        after: async (user) => {
          if (user.emailVerified) {
            await maybeGrantSignupCredit({ userId: user.id });
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: true,
    onExistingUserSignUp: () => {
      // Throw synchronously; Better Auth swallows rejected background promises.
      throw new APIError("UNPROCESSABLE_ENTITY", {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "This email is already registered. Please sign in or reset your password.",
      });
    },
    password: {
      hash: async (password) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }) => {
        return await bcrypt.compare(password, hash);
      },
    },
    async sendResetPassword({ user, url }) {
      await sendEmail("resetPassword", user.email, url, user.name);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendEmail("verifyEmail", user.email, url, user.name);
    },
  },
  socialProviders: {},
  plugins: [
    admin(),
    apiKey({
      references: "organization",
      enableSessionForAPIKeys: false,
      enableMetadata: false,
      // API traffic is limited after successful authentication by the shared
      // Redis-backed limiter in rateLimit.middleware.ts. Keeping Better Auth's
      // per-key limiter enabled would apply its 10-request daily default first.
      rateLimit: { enabled: false },
      permissions: {
        defaultPermissions: ORGANIZATION_API_KEY_PERMISSIONS,
      },
    }),
    organization({
      ac,
      roles,
      dynamicAccessControl: {
        enabled: true,
      },
      requireEmailVerificationOnInvitation: true,
      organizationHooks: {
        beforeCreateOrganization: async ({ organization, user }) => {
          const account = await prisma.user.findUnique({ where: { id: user.id }, select: { banned: true, role: true } });
          if (!account || account.banned) throw new APIError("FORBIDDEN", { message: "账号不可用，请联系管理员。" });
          const ownsWorkspace = await prisma.member.findFirst({where:{userId:user.id,role:"owner",enabled:true}});
          if(!account.role?.split(",").includes("admin")&&!ownsWorkspace)throw new APIError("FORBIDDEN",{message:"员工账号不能新增公司工作区，请联系管理员。"});
          const name = organization.name?.trim() ?? "";
          if (!name || name.length > 80) throw new APIError("BAD_REQUEST", { message: "请填写 1 至 80 个字符的工作区名称。" });
          return { data: { ...organization, name, logo: null } };
        },
        beforeUpdateOrganization: async ({ organization }) => {
          const name=organization.name?.trim();
          if(name!==undefined&&(!name||name.length>80))throw new APIError("BAD_REQUEST",{message:"请填写 1 至 80 个字符的工作区名称。"});
          let logo=organization.logo;
          if(logo!==undefined){try{logo=validateWorkspaceLogo(logo);}catch{throw new APIError("BAD_REQUEST",{message:"请在公司与品牌设置中上传 Logo 图片。"});}}
          return {data:{...organization,...(name!==undefined?{name}:{}),...(logo!==undefined?{logo}:{})}};
        },
        afterCreateOrganization: async ({ organization: org, user }) => {
          await ensureBillingAccount(org.id);
          await maybeGrantSignupCredit({
            userId: user.id,
            organizationId: org.id,
          });
        },
        beforeDeleteOrganization: async ({ organization: org }) => {
          try {
            await cleanupOrganizationDeletionHook(org);
          } catch (error) {
            console.error("[organization] external cleanup blocked deletion", {
              organizationId: org.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown cleanup error",
            });
            throw new APIError("BAD_REQUEST", {
              message:
                "Organization deletion did not complete. Cleanup is retry-safe and may already have released provider resources; retry after checking provider connectivity.",
            });
          }
        },
      },
    }),
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
      createCustomerOnSignUp: false,
      subscription: {
        enabled: true,
        defaultPlan: "free",
        plans: plans,
        authorizeReference: async ({ user, referenceId, action }) => {
          // Prepaid wallets replace new plan purchases. Keep the plugin active
          // only so existing subscriptions can be viewed and sunset cleanly.
          if (
            action === "upgrade-subscription" ||
            action === "restore-subscription" ||
            action === "billing-portal"
          ) {
            return false;
          }
          const member = await prisma.member.findUnique({
            where: {
              organizationId_userId: {
                organizationId: referenceId,
                userId: user.id,
              },
            },
            select: { role: true },
          });
          if (action === "list-subscription") return member !== null;
          return member?.role === "owner" || member?.role === "admin";
        },
      },
      organization: isHostedBilling ? { enabled: true } : undefined,
    }),
  ],
});
