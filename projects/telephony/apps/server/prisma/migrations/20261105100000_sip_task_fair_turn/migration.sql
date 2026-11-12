-- 中文导读：数据库迁移：20261105100000_sip_task_fair_turn。记录这一版本的表结构或数据规则变更。
CREATE TABLE "SipTaskFairTurn" (
  "taskId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "pass" DOUBLE PRECISION NOT NULL,
  "lastOfferedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDispatchedAt" TIMESTAMPTZ,
  CONSTRAINT "SipTaskFairTurn_pkey" PRIMARY KEY ("taskId", "provider"),
  CONSTRAINT "SipTaskFairTurn_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "SipTask"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMENT ON TABLE "SipTaskFairTurn" IS 'taigua-fair-release-20261105';
