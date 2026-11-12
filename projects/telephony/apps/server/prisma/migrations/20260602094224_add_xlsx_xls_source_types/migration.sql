-- 中文导读：数据库迁移：20260602094224_add_xlsx_xls_source_types。记录这一版本的表结构或数据规则变更。
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "sourceType" ADD VALUE 'XLSX';
ALTER TYPE "sourceType" ADD VALUE 'XLS';
