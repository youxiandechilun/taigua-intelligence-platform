/*
 * 中文导读：HTTP 请求中间件：authorize.middleware。在业务处理前后执行本文件定义的公共规则。
 */
// Authorization middleware factory.
//
// Usage:
//   router.post(
//     "/",
//     authMiddleware,
//     requirePermission({ agent: ["create"] }),
//     validate(schema),
//     controller.handler,
//   );
//
// Evaluates permissions against the user's role in req.auth.activeOrganizationId
// via better-auth's hasPermission API. Internal callers bypass the check per
// the trust-boundary policy in auth.middleware.ts. API keys are scoped to one
// organization by auth.middleware.ts and must also carry explicit route scopes.

import type { IncomingHttpHeaders } from "node:http";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { APIError } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import prisma from "../config/prisma.js";
import { UnauthenticatedError } from "../common/errors/unauthenticated.js";
import { ForbiddenError } from "../common/errors/forbidden.js";
import {companyContext} from "../modules/workspace/company-access.js";
import {grants,companyResources} from "../modules/workspace/company-policy.js";
import type { RequestAuth } from "../types/express.js";

import {navigationPolicy,requestNavigationArea} from "../modules/workspace/navigation-policy.js";
const navigationChecks=new WeakMap<Request,Promise<void>>();
async function assertNavigationAccess(req:Request){
 const area=requestNavigationArea(req.originalUrl,req.method);
 if(!area||!req.auth?.activeOrganizationId||req.auth.authMethod==='internal')return;
 const policy=await navigationPolicy(req.auth.activeOrganizationId),item=policy.items.find(item=>item.id===area);
 if(item?.enabled===false&&(req.auth.authMethod!=='session'||!(await companyContext(req.auth.activeOrganizationId,req.auth.userId)).isSystemAdmin))throw new ForbiddenError(`${item.label}已由超级管理员关闭。`);
}
export type Permissions = Record<string, string[]>;

// Request type after `requirePermission` has run: `auth` is non-optional and
// `activeOrganizationId` is guaranteed to be a string. The guarantee holds
// because:
//   - session / apiKey flow: requirePermission throws ForbiddenError if
//     activeOrganizationId is null.
//   - internal flow: auth.middleware.ts rejects the request if internalOrgId
//     is not a non-empty string before populating req.auth.
export type AuthorizedRequest = Request & {
  auth: RequestAuth & { activeOrganizationId: string };
};

type AuthorizedHandler = (
  req: AuthorizedRequest,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

// Wrap a handler that runs behind `requirePermission` so it sees a narrowed
// request type and doesn't need to re-check `activeOrganizationId`. Only use
// this on routes where `requirePermission` is in the middleware chain.
export const authorized =
  (handler: AuthorizedHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req as AuthorizedRequest, res, next)).catch(next);

export const requirePermission =
  (permissions: Permissions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) {
        throw new UnauthenticatedError("Unauthorized");
      }

      // Trusted server-to-server caller — skip authorization entirely.
      if (req.auth.authMethod === "internal") {
        return next();
      }

      if (!req.auth.activeOrganizationId) {
        throw new ForbiddenError("No active organization for this request");
      }

      let navigationCheck=navigationChecks.get(req);
      if(!navigationCheck){navigationCheck=assertNavigationAccess(req);navigationChecks.set(req,navigationCheck);}
      await navigationCheck;

      // API keys keep their existing management restriction. Session requests use
      // the same fixed-role policy as the console and company services below.
      if (req.auth.authMethod==='apiKey'&&Object.entries(permissions).some(([resource, actions]) => ['agent','agentConfiguration'].includes(resource) && actions.some(action => action !== 'read'))) {
        const access = await companyContext(req.auth.activeOrganizationId, req.auth.userId);
        if (!access.isSystemAdmin) throw new ForbiddenError('数字员工参数只能由超级管理员设置。');
      }
      if (req.auth.authMethod === "apiKey") {
        if (!hasApiKeyPermission(req.auth.apiKeyPermissions, permissions)) {
          throw new ForbiddenError("Insufficient permissions");
        }
        return next();
      }

      if (
        !(await hasSessionPermission(
          req.headers,
          req.auth.activeOrganizationId,
          permissions,
        ))
      ) {
        throw new ForbiddenError("Insufficient permissions");
      }

      return next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Shared Better Auth permission evaluation for cookie-authenticated HTTP and
 * Socket.IO requests. The organization id must always come from the session,
 * never from client event data.
 */
export async function hasSessionPermission(
  headers: IncomingHttpHeaders,
  organizationId: string,
  permissions: Permissions,
) {
  try {
    const session = await auth.api.getSession({headers:fromNodeHeaders(headers)});
    if(!session)return false;
    const member=await prisma.member.findFirst({where:{organizationId,userId:session.user.id,enabled:true,user:{banned:false}}});
    if(!member)return false;
    const access=await companyContext(organizationId,session.user.id);
    if(access.isSystemAdmin)return true;
    if("billing" in permissions&&!access.allData)return false;
    const technical=new Set(["secrets","apiKey","tools","mcp","system","organization"]);
    if(Object.entries(permissions).some(([r,a])=>technical.has(r)&&a.length>0))return false;
    return Object.entries(permissions).every(([resource,actions])=>resource in companyResources&&actions.every(action=>grants(access.permissions,resource,action)));
  } catch (error) {
    // Better Auth throws when membership/session/org is gone instead of
    // returning success:false. Treat that as denial, not an auth outage.
    if (error instanceof APIError && [400, 401, 403, 404].includes(error.statusCode)) {
      return false;
    }
    throw error;
  }
}

type CurrentSessionPermissionDependencies = {
  getSession: (headers: IncomingHttpHeaders) => Promise<{
    user: { id: string };
    session?: { activeOrganizationId?: string | null };
  } | null>;
  hasPermission: (
    headers: IncomingHttpHeaders,
    organizationId: string,
    permissions: Permissions,
  ) => Promise<boolean>;
};

const currentSessionPermissionDependencies: CurrentSessionPermissionDependencies =
  {
    getSession: async (headers) =>
      (await auth.api.getSession({
        headers: fromNodeHeaders(headers),
      })) as Awaited<
        ReturnType<CurrentSessionPermissionDependencies["getSession"]>
      >,
    hasPermission: hasSessionPermission,
  };

/**
 * Revalidates a long-lived connection against current server-side session
 * state. Matching the user and active organization prevents a socket from
 * retaining access after membership removal, sign-out, or an organization
 * switch.
 */
export async function hasCurrentSessionPermission(
  headers: IncomingHttpHeaders,
  expectedUserId: string,
  expectedOrganizationId: string,
  permissions: Permissions,
  dependencies: CurrentSessionPermissionDependencies = currentSessionPermissionDependencies,
) {
  const session = await dependencies.getSession(headers);
  if (
    !session ||
    session.user.id !== expectedUserId ||
    session.session?.activeOrganizationId !== expectedOrganizationId
  ) {
    return false;
  }
  const resourceAreas:Record<string,string>={agent:'agents',agentConfiguration:'agents',outboundCalls:'outbound',callLogs:'calls',knowledgeSource:'kb',crm:'crm',wecom:'wecom',automation:'automation'};
  const areas=Object.keys(permissions).map(resource=>resourceAreas[resource]).filter(Boolean);
  if(areas.length){
    const policy=await navigationPolicy(expectedOrganizationId);
    if(policy.items.some(item=>areas.includes(item.id)&&!item.enabled)&&!(await companyContext(expectedOrganizationId,expectedUserId)).isSystemAdmin)return false;
  }
  return dependencies.hasPermission(
    headers,
    expectedOrganizationId,
    permissions,
  );
}

export function hasApiKeyPermission(
  granted: Record<string, string[]> | undefined,
  requested: Permissions,
) {
  if (!granted) return false;

  return Object.entries(requested).every(([resource, actions]) => {
    const resourceActions = granted[resource] ?? [];
    return actions.every(
      (action) =>
        resourceActions.includes(action) ||
        resourceActions.includes("*") ||
        granted["*"]?.includes("*") === true,
    );
  });
}

export default requirePermission;
