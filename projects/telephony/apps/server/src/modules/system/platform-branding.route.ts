/*
 * 中文导读：系统管理：platform-branding.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router, type RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { auth } from "../../lib/auth.js";
import prisma from "../../config/prisma.js";
import { trustedOrigins } from "../../config/origins.js";
import { UnauthenticatedError } from "../../common/errors/unauthenticated.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { requireSystemAdminAccess } from "../../lib/access-control.js";

const router = Router();
const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const schema = z.object({ loginSlogan: z.string().trim().min(1, "请输入登录页标语").max(120, "标语最多 120 字").regex(/^[^\r\n\u0000-\u001f\u007f]+$/, "标语请使用单行文字") }).strict();
const fallback = "让国货之光在全球市场绽放";
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

// Expose only this public sentence; never return workspace configuration or credentials.
router.get("/", wrap(async (_req, res) => {
  const value = await prisma.platformBranding.findUnique({ where: { id: "global" }, select: { loginSlogan: true } });
  res.json({ success: true, data: { loginSlogan: value?.loginSlogan ?? fallback } });
}));
router.put("/", wrap(async (req, res) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new UnauthenticatedError("请先登录。");
  await requireSystemAdminAccess(session.user.id);
  if (!trustedOrigins.includes(req.get("origin") || "")) throw new ForbiddenError("请在系统正式地址中操作。");
  const input = schema.parse(req.body);
  const result = await prisma.platformBranding.upsert({ where: { id: "global" }, create: { id: "global", ...input }, update: input, select: { loginSlogan: true } });
  res.json({ success: true, data: result });
}));
export default router;
