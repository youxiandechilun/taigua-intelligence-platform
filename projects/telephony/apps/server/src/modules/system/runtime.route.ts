/*
 * 中文导读：系统管理：runtime.route.ts。声明接口路径、中间件和处理函数。
 */
import { voiceBackend } from "../../config/voice-backend.js";
import { Router } from "express";

import { billingMode } from "../../config/billing-mode.js";

const router = Router();

/**
 * Minimal cross-service contract used by the AI runtime before it accepts
 * voice jobs. No customer or infrastructure configuration is exposed.
 */
router.get("/runtime-mode", (_req, res) => {
  res.json({
    success: true,
    data: {
      service: "server",
      runtimeProtocolVersion: 1,
      billingMode,
      voiceBackend,
    },
  });
});

export default router;
