/*
 * 中文导读：用量与费用：billing.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from "express";

import authMiddleware from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorize.middleware.js";
import * as billingController from "./billing.controller.js";
import validate from "../../middleware/validate.middleware.js";
import {
  createTopUpCheckoutSchema,
  updateAutoRechargeSchema,
} from "./billing.schema.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import type { NextFunction, Request, Response } from "express";
import { requireBuiltInBillingManager } from "./billing-manager.middleware.js";
import { authorized } from "../../middleware/authorize.middleware.js";
import { cloudUsage } from "./cloud-usage.service.js";
import { requireSystemAdmin } from "../../middleware/system-admin.middleware.js";
import { aliyunAccountBill } from "./aliyun-bill.service.js";

const router = Router();

router.get('/aliyun-account',authMiddleware,requireSystemAdmin,authorized(async(req,res)=>{
  if(req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新。');
  const month=String(req.query.month??'');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new ForbiddenError('请选择正确的账期。');
  res.setHeader('Cache-Control','no-store');
  res.json({success:true,data:await aliyunAccountBill(req.auth.activeOrganizationId,month)});
}));

router.get('/cloud-usage', authMiddleware, requirePermission({billing:['read']}), authorized(async(req,res)=>{
  if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录后查看公司用量。');
  if(req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新。');
  res.setHeader('Cache-Control','no-store');
  res.json({success:true,data:await cloudUsage(req.auth.activeOrganizationId,req.auth.userId)});
}));

const requireInternal = (req: Request, _res: Response, next: NextFunction) =>
  req.auth?.authMethod === "internal"
    ? next()
    : next(new ForbiddenError("Call usage ingest is internal-only"));

router.get(
  "/summary",
  authMiddleware,
  requirePermission({ billing: ["read"] }),
  billingController.getSummary,
);

router.get(
  "/transactions",
  authMiddleware,
  requirePermission({ billing: ["read"] }),
  billingController.getTransactions,
);

router.post(
  "/top-ups/checkout",
  authMiddleware,
  requirePermission({ billing: ["manage"] }),
  requireBuiltInBillingManager,
  validate(createTopUpCheckoutSchema),
  billingController.createTopUp,
);

router.post(
  "/payment-method/setup",
  authMiddleware,
  requirePermission({ billing: ["manage"] }),
  requireBuiltInBillingManager,
  billingController.setupPaymentMethod,
);

router.patch(
  "/auto-recharge",
  authMiddleware,
  requirePermission({ billing: ["manage"] }),
  requireBuiltInBillingManager,
  validate(updateAutoRechargeSchema),
  billingController.configureAutoRecharge,
);

router.post(
  "/calls/usage",
  authMiddleware,
  requireInternal,
  billingController.ingestCallUsage,
);

router.get(
  "/calls/:callId/cost",
  authMiddleware,
  requirePermission({ billing: ["read"] }),
  billingController.getCallCost,
);

router.get(
  "/usage",
  authMiddleware,
  requirePermission({ callLogs: ["read"] }),
  billingController.getBillingUsage,
);

export default router;
