/*
 * 中文导读：共享基础能力：provider-spend.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { inngest } from "../config/inngest.js";
import { runProviderSpendMonitor } from "../modules/billing/provider-spend.service.js";

export const monitorProviderSpend = inngest.createFunction(
  {
    id: "monitor-provider-spend",
    concurrency: { limit: 1 },
    retries: 2,
    triggers: { cron: "TZ=UTC */5 * * * *" },
  },
  async ({ step }) =>
    step.run("collect-provider-usage-and-notify-team", () =>
      runProviderSpendMonitor(),
    ),
);
