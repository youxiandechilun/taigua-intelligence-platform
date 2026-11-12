/*
 * 中文导读：业务线索：business.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from "express";
import { z } from "zod";
import authMiddleware from "../../middleware/auth.middleware.js";
import {
  authorized,
  requirePermission,
} from "../../middleware/authorize.middleware.js";
import { trustedOrigins } from "../../config/origins.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import * as service from "./business.service.js";
import { normalizePhone } from "./business.research.js";
import { companyContext } from "../workspace/company-access.js";
const router = Router();
router.use(authMiddleware, requirePermission({}));
router.use("/contacts",requirePermission({crm:["read"]}));
router.use("/jobs",requirePermission({outboundCalls:["read"]}));
router.use((req, _res, next) => {
  if (req.auth?.authMethod !== "session")
    return next(new ForbiddenError("请登录后使用业务工具。"));
  if (
    !["GET", "HEAD"].includes(req.method) &&
    !trustedOrigins.includes(req.get("origin") || "")
  )
    return next(new ForbiddenError("请在系统正式地址中操作。"));
  if (req.get("x-workspace-id") !== req.auth?.activeOrganizationId)
    return next(new ForbiddenError("工作区已切换，请刷新业务工具后再操作。"));
  next();
});
const scope = (req: Parameters<Parameters<typeof authorized>[0]>[0]) => ({
  organizationId: req.auth.activeOrganizationId,
  ownerId: req.auth.userId,
});
const contactScope = async (
  req: Parameters<Parameters<typeof authorized>[0]>[0],
) => {
  const context = await companyContext(
    req.auth.activeOrganizationId,
    req.auth.userId,
  );
  const companyWide = req.query.view === "company";
  if (companyWide && !context.canManage)
    throw new ForbiddenError("仅公司管理员可以查看公司客户。");
  return { ...scope(req), companyWide };
};
const send = (
  res: Parameters<Parameters<typeof authorized>[0]>[1],
  data: unknown,
) => res.json({ success: true, data });
const id = z.string().uuid();
const lead = z
  .object({
    companyName: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(7).max(30),
    industry: z.string().trim().max(80).default(""),
    address: z.string().trim().max(200).default(""),
    business: z.string().trim().max(300).default(""),
    sourceUrl: z.string().max(2000).default(""),
  })
  .strict();
router.get(
  "/contacts",
  authorized(async (req, res) =>
    send(res, await service.listContacts(await contactScope(req))),
  ),
);
router.post(
  "/contacts",
  requirePermission({ crm: ["create"] }),
  authorized(async (req, res) => {
    const input = lead.parse(req.body);
    input.phone = normalizePhone(input.phone, input.address || input.companyName);
    if (!input.phone)
      throw new BadRequestError("请输入国内手机号或带区号的座机号码。");
    if (input.sourceUrl && !/^https?:\/\//i.test(input.sourceUrl))
      throw new BadRequestError("来源网址需要以 http:// 或 https:// 开头。");
    send(res, (await service.saveContact(scope(req), input))[0]);
  }),
);
router.post(
  "/contacts/delete",
  requirePermission({ crm: ["delete"] }),
  authorized(async (req, res) => {
    const input = z
      .object({ ids: z.array(id).min(1).max(500) })
      .strict()
      .parse(req.body);
    send(res, await service.deleteContacts(await contactScope(req), input.ids));
  }),
);
router.patch(
  "/contacts/:id",
  requirePermission({ crm: ["update"] }),
  authorized(async (req, res) => {
    const input = z
      .object({
        status: z.enum([
          "NEW",
          "INTERESTED",
          "FOLLOW_UP",
          "NO_NEED",
          "OPT_OUT",
        ]),
        notes: z.string().max(4000),
        nextFollowUp: z.iso.datetime({ offset: true }).nullable(),
        wecomStatus: z.enum(["NONE", "REQUESTED", "ADDED", "DECLINED"]),
        handoffStatus: z.enum(["NONE", "PENDING", "ACCEPTED", "DONE"]),
        handoffReason: z.string().max(1000),
      })
      .strict()
      .parse(req.body);
    send(
      res,
      await service.updateContact(
        await contactScope(req),
        id.parse(req.params.id),
        {
          ...input,
          nextFollowUp: input.nextFollowUp
            ? new Date(input.nextFollowUp)
            : null,
        },
      ),
    );
  }),
);
router.post(
  "/contacts/:id/assign",
  requirePermission({crm:["assign"]}),
  authorized(async (req, res) => {
    const input = z.object({ ownerId: id }).strict().parse(req.body);
    const context = await companyContext(
      req.auth.activeOrganizationId,
      req.auth.userId,
    );
    send(
      res,
      await service.assignContact(
        { ...scope(req), companyWide: context.canManage },
        id.parse(req.params.id),
        input.ownerId,
      ),
    );
  }),
);
router.get(
  "/contacts/:id/history",
  authorized(async (req, res) =>
    send(
      res,
      await service.assignmentHistory(
        await contactScope(req),
        id.parse(req.params.id),
      ),
    ),
  ),
);
router.get(
  "/jobs",
  authorized(async (req, res) => send(res, await service.listJobs(scope(req)))),
);
router.post(
  "/jobs",
  requirePermission({ outboundCalls: ["create"] }),
  authorized(async (req, res) => {
    const input = z
      .object({
        industry: z.string().trim().min(1).max(80),
        region: z.string().trim().min(1).max(30).default("中国大陆"),
        target: z.number().int().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    send(
      res,
      await service.createJob(
        scope(req),
        input.industry,
        input.region,
        input.target,
      ),
    );
  }),
);
router.post(
  "/jobs/:id/action",
  requirePermission({ outboundCalls: ["create"] }),
  authorized(async (req, res) => {
    const input = z
      .object({
        action: z.enum(["pause", "resume"]),
        sources: z.array(z.string().url().max(2000)).max(100).default([]),
      })
      .strict()
      .parse(req.body);
    send(
      res,
      await service.changeJob(
        scope(req),
        id.parse(req.params.id),
        input.action,
        input.sources,
      ),
    );
  }),
);
router.get(
  "/jobs/:id/export",
  authorized(async (req, res) => {
    const job = await service.ownedJob(scope(req), id.parse(req.params.id));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(job.industry + "-国内企业线索.xlsx")}`,
    );
    res.send(service.leadWorkbook(job.results, false, job));
  }),
);
router.get(
  "/contacts/export",
  requirePermission({crm:["export"]}),
  authorized(async (req, res) => {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename*=UTF-8''" + encodeURIComponent("客户联系表.xlsx"),
    );
    res.send(
      service.leadWorkbook(
        await service.listContacts(await contactScope(req)),
        true,
      ),
    );
  }),
);
export default router;
