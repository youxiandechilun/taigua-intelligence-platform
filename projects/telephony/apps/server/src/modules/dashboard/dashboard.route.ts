/*
 * 中文导读：数据看板：dashboard.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from "express";

import authMiddleware from "../../middleware/auth.middleware.js";
import { requirePermission, authorized } from "../../middleware/authorize.middleware.js";
import * as dashboardController from "./dashboard.controller.js";
import { modelUsageAlerts } from "../telephony/model-usage.service.js";

const router = Router();
router.get('/model-alerts',authMiddleware,requirePermission({}),authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await modelUsageAlerts({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId})});
}));

router.get(
  "/summary",
  authMiddleware,
  requirePermission({ callLogs: ["read"] }),
  dashboardController.getDashboardSummary
);

export default router;
