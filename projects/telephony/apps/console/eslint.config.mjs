/*
 * 中文导读：共享基础能力：eslint.config.mjs。相关类型、配置或辅助实现集中在本文件。
 */
import { defineConfig } from "eslint/config";
import { nextJsConfig } from "@repo/eslint-config/next-js";

const eslintConfig = defineConfig(nextJsConfig);

export default eslintConfig;
