/*
 * 中文导读：共享基础能力：query-index.ts。相关类型、配置或辅助实现集中在本文件。
 */
// Read endpoints run separately so publishing list changes does not interrupt
// the API used by live calls, recordings, and dispatch workers.
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import cors from "cors";
import helmet from "helmet";
import { trustedOrigins } from "./config/origins.js";
import { trustedProxies } from "./config/trusted-proxies.js";
import { authClientIpMiddleware } from "./middleware/auth-client-ip.middleware.js";
import rateLimitMiddleware from "./middleware/rateLimit.middleware.js";
import errorHandler from "./middleware/error.middleware.js";
import notFound from "./middleware/notFound.middleware.js";
import sipRouter from "./modules/telephony/sip.route.js";
import calllogRouter from "./modules/calllogs/calllog.route.js";
import { createReadinessRouter } from "./modules/system/readiness.route.js";
import { getReadiness } from "./modules/system/readiness.service.js";
import { closeRateLimitStore } from "./middleware/rate-limit-store.js";
import { closeRedisConnection } from "./config/redis.js";
import prisma from "./config/prisma.js";

const app = express();
const apiVersion = process.env.API_VERSION || "v1";
const base = `/api/${apiVersion}`;
app.set("trust proxy", trustedProxies());
app.use(authClientIpMiddleware);
app.use(helmet());
app.use(cors({ origin: trustedOrigins, methods: ["GET"], credentials: true,
  exposedHeaders: ["Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"] }));
// Reject every write and every unrelated read before entering the original
// routers. Their authentication, workspace permissions, and owner scope remain.
app.use((req, res, next) => {
  const allowed = req.path === `${base}/health` || req.path === `${base}/ready` ||
    req.path === `${base}/calls` || req.path === `${base}/telephony/tasks` ||
    new RegExp(`^${base}/telephony/tasks/[a-f0-9-]{36}$`, "i").test(req.path);
  if (req.method !== "GET" || !allowed) return res.status(404).json({ success: false, message: "Not found" });
  res.setHeader("X-Taigua-Query-Release", "20261028-duration-summary");
  next();
});
app.get(`${base}/health`, (_req, res) => res.json({ success: true, message: "Query server ready" }));
app.use(`${base}/ready`, createReadinessRouter(getReadiness));
app.use(rateLimitMiddleware);
app.use(`${base}/telephony`, sipRouter);
app.use(`${base}/calls`, calllogRouter);
app.use(notFound);
app.use(errorHandler);

const server = createServer(app);
server.listen(Number(process.env.PORT || 8512), "127.0.0.1", () => {
  console.log("[query-api] authenticated task and call queries ready");
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await closeRateLimitStore();
  await closeRedisConnection();
  await prisma.$disconnect();
  clearTimeout(deadline);
}
process.once("SIGINT", () => void shutdown().catch(() => process.exit(1)));
process.once("SIGTERM", () => void shutdown().catch(() => process.exit(1)));
