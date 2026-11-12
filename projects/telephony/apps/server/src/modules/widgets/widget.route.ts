/*
 * 中文导读：网页通话组件：widget.route.ts。声明接口路径、中间件和处理函数。
 */
import { isAliyunVoice } from "../../config/voice-backend.js";
import CustomApiError from "../../common/errors/customApiError.js";
import { Router } from "express";

import authMiddleware from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorize.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as widgetController from "./widget.controller.js";
import {
  createAgentWidgetSchema,
  createPublicWidgetSessionSchema,
  endPublicWidgetSessionSchema,
  updateAgentWidgetSchema,
} from "./widget.schema.js";

const router = Router();
  router.use((req, _res, next) => {
    if (isAliyunVoice && (req.method !== "GET" || ["/search", "/countries"].includes(req.path))) {
      return next(new CustomApiError("当前使用阿里云通话后端，请使用阿里云任务与配置入口。旧线路和网站语音通道已停用。", 409));
    }
    next();
  });

// Public CORS is mounted before request parsing in index.ts.

router.get(
  "/public/widgets/:widgetId/config",
  widgetController.getPublicWidgetConfig,
);

router.post(
  "/public/widgets/:widgetId/sessions",
  validate(createPublicWidgetSessionSchema),
  widgetController.createPublicWidgetSession,
);

router.post(
  "/public/widgets/:widgetId/sessions/:sessionId/end",
  validate(endPublicWidgetSessionSchema),
  widgetController.endPublicWidgetSession,
);

router.get(
  "/agents/:agentId/widgets",
  authMiddleware,
  requirePermission({ agentWidget: ["read"] }),
  widgetController.listAgentWidgets,
);

router.post(
  "/agents/:agentId/widgets",
  authMiddleware,
  requirePermission({ agentWidget: ["create"] }),
  validate(createAgentWidgetSchema),
  widgetController.createAgentWidget,
);

router.get(
  "/widgets/:widgetId",
  authMiddleware,
  requirePermission({ agentWidget: ["read"] }),
  widgetController.getAgentWidget,
);

router.patch(
  "/widgets/:widgetId",
  authMiddleware,
  requirePermission({ agentWidget: ["update"] }),
  validate(updateAgentWidgetSchema),
  widgetController.updateAgentWidget,
);

router.delete(
  "/widgets/:widgetId",
  authMiddleware,
  requirePermission({ agentWidget: ["delete"] }),
  widgetController.deleteAgentWidget,
);

export default router;
