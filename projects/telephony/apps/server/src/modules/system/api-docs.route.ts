/*
 * 中文导读：系统管理：api-docs.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router, type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "../../config/swagger.js";
import authMiddleware from "../../middleware/auth.middleware.js";

export function createApiDocsRouter(
  authenticate: RequestHandler = authMiddleware,
) {
  const router = Router();

  router.get("/docs.json", authenticate, (_req, res) => {
    res.json(swaggerSpec);
  });
  router.use(
    "/docs",
    authenticate,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      swaggerOptions: {
        persistAuthorization: false,
        withCredentials: true,
      },
    }),
  );

  return router;
}

export default createApiDocsRouter();
