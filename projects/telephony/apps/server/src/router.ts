/*
 * 中文导读：API 总路由：将各业务模块和访问中间件挂载到统一接口。
 */
import { Router } from "express";

import agentRouter from "./modules/agent/agent.route.js";
import billingRouter from "./modules/billing/billing.route.js";
import calllogRouter from "./modules/calllogs/calllog.route.js";
import dashboardRouter from "./modules/dashboard/dashboard.route.js";
import kbRouter from "./modules/kb/kb.route.js";
import phoneRouter from "./modules/numbers/phone.route.js";
import outboundCallRouter from "./modules/outbound/outbound-call.route.js";
import toolRouter from "./modules/tools/tool.route.js";
import mcpRouter from "./modules/mcp/mcp.route.js";
import secretRouter from "./modules/secrets/secret.route.js";
import widgetRouter from "./modules/widgets/widget.route.js";

import aliyunRouter from "./modules/aliyun/aliyun.route.js";

import accountsRouter from "./modules/accounts/accounts.route.js";

import businessRouter from "./modules/business/business.route.js";

import workspaceRouter from "./modules/workspace/workspace.route.js";

import companyRouter from "./modules/workspace/company.route.js";

import authMiddleware from "./middleware/auth.middleware.js";
import { authorized,requirePermission } from "./middleware/authorize.middleware.js";
import { companyContext } from "./modules/workspace/company-access.js";
import { ForbiddenError } from "./common/errors/forbidden.js";
import platformBrandingRouter from "./modules/system/platform-branding.route.js";
import automationRouter from "./modules/automation/automation.route.js";
import workspaceKnowledgeRouter from "./modules/kb/workspace-knowledge.js";
import crmRouter from "./modules/crm/crm.route.js";
import wecomRouter from "./modules/wecom/wecom.route.js";
import sipRouter from "./modules/telephony/sip.route.js";
import customerIntentRouter from "./modules/crm/customer-intent.route.js";
import recordingLearningRouter from "./modules/recording-learning/learning.route.js";
const router = Router();
router.use("/recording-learning",recordingLearningRouter);
router.use("/customer-followup",customerIntentRouter);
router.use("/telephony",sipRouter);
router.use("/crm", crmRouter);
router.use("/wecom", wecomRouter);
router.use("/workspace-knowledge", workspaceKnowledgeRouter);
router.use("/automation", automationRouter);
router.use("/platform-branding", platformBrandingRouter);
// Provider settings require management access.
// Dashboard and call routes apply their own permissions and per-record owner scope.
router.use(["/outbound-calls","/aliyun"],authMiddleware,requirePermission({outboundCalls:["read"]}),authorized(async(req,_res,next)=>{
 if(req.auth.authMethod==='session'&&!(await companyContext(req.auth.activeOrganizationId,req.auth.userId)).canManage)throw new ForbiddenError('公司通话和云配置由公司管理员管理。员工请在业务工具中处理自己的客户。');next();
}));
router.use("/company", companyRouter);
router.use("/workspaces", workspaceRouter);
router.use("/business", businessRouter);
router.use("/admin/accounts", accountsRouter);
router.use("/aliyun", aliyunRouter);

router.use("/agents", agentRouter);
router.use("/billing", billingRouter);
router.use("/numbers", phoneRouter);
router.use("/calls", calllogRouter);
router.use("/dashboard", dashboardRouter);
router.use("/kb", kbRouter);
router.use("/outbound-calls", outboundCallRouter);
router.use("/tools", toolRouter);
router.use("/mcp", mcpRouter);
router.use("/secrets", secretRouter);
router.use("/", widgetRouter);

export default router;
