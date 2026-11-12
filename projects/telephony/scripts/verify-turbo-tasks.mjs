/*
 * 中文导读：维护与构建工具：verify-turbo-tasks.mjs。按文件内参数执行对应操作，运行前先核对目标环境。
 */
import { readFile } from "node:fs/promises";

const expected = {
  "apps/server/package.json": ["build", "lint", "check-types", "test"],
  "apps/console/package.json": ["build", "lint", "check-types"],
  "apps/web/package.json": ["build", "lint", "check-types"],
};

const missing = [];

for (const [path, scripts] of Object.entries(expected)) {
  const pkg = JSON.parse(await readFile(path, "utf8"));
  for (const script of scripts) {
    if (typeof pkg.scripts?.[script] !== "string" || pkg.scripts[script].trim() === "") {
      missing.push(`${path}: scripts.${script}`);
    }
  }
}

if (missing.length > 0) {
  console.error("Missing expected Turborepo package scripts:");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("All expected package scripts are present.");
