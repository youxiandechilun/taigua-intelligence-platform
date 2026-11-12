/*
 * 中文导读：共享基础能力：reindex-knowledge-sources.ts。相关类型、配置或辅助实现集中在本文件。
 */
import "dotenv/config";

import prisma from "../src/config/prisma.js";
import { reindexActiveKnowledgeSources } from "../src/modules/kb/kb.service.js";
import { getKbQueue } from "../src/queues/kb.queue.js";

async function main() {
  const result = await reindexActiveKnowledgeSources();
  console.log(JSON.stringify(result));
  if (result.failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await getKbQueue().close();
  await prisma.$disconnect();
}
