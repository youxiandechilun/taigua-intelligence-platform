/*
 * 中文导读：凭据管理：secret.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from "express";

import authMiddleware from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/authorize.middleware.js";
import { requireSystemAdmin } from "../../middleware/system-admin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as secretController from "./secret.controller.js";
import { createSecretSchema } from "./secret.schema.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  requireSystemAdmin,
  requirePermission({ secrets: ["read"] }),
  secretController.listSecrets
);

router.post(
  "/",
  authMiddleware,
  requireSystemAdmin,
  requirePermission({ secrets: ["create"] }),
  validate(createSecretSchema),
  secretController.createSecret
);

router.delete(
  "/:secretId",
  authMiddleware,
  requireSystemAdmin,
  requirePermission({ secrets: ["delete"] }),
  secretController.deleteSecret
);

export default router;
