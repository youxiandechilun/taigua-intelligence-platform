-- 中文导读：数据库迁移：20260416004442_fix_calllog_outbound_relation。记录这一版本的表结构或数据规则变更。
/*
  Warnings:

  - A unique constraint covering the columns `[callLogId]` on the table `OutboundCall` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "OutboundCall" ADD COLUMN     "callLogId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OutboundCall_callLogId_key" ON "OutboundCall"("callLogId");

-- AddForeignKey
ALTER TABLE "OutboundCall" ADD CONSTRAINT "OutboundCall_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("callId") ON DELETE SET NULL ON UPDATE CASCADE;
