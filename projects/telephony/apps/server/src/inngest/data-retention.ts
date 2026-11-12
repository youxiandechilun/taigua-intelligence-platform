/*
 * 中文导读：共享基础能力：data-retention.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { InngestFunction } from "inngest";

import { inngest } from "../config/inngest.js";
import { runRetention } from "../modules/retention/retention.service.js";

export const dataRetention: InngestFunction.Any = inngest.createFunction(
  {
    id: "data-retention",
    retries: 1,
    triggers: { cron: "TZ=UTC 0 3 * * *" },
  },
  async ({ step }) => {
    return step.run("apply-retention-policies", () => runRetention());
  }
);
