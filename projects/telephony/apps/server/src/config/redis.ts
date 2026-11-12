/*
 * 中文导读：后端 redis 配置与依赖初始化。
 */
import { Redis } from "ioredis";
import { closeRedisClient } from "../workers/shutdown.js";

export const redisConnection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export async function closeRedisConnection() {
  await closeRedisClient(redisConnection);
}
