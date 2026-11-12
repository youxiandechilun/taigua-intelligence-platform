#!/usr/bin/env node
/*
 * 中文导读：维护与构建工具：check-release-baseline.mjs。按文件内参数执行对应操作，运行前先核对目标环境。
 */

/**
 * Produce a reviewable release-baseline report without packaging or deploying
 * anything.  The default mode is fast and read-only; --checks adds the local
 * type and Prisma checks, while --build also runs the two application builds.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const allowDirty = args.has('--allow-dirty');
const runChecks = args.has('--checks') || args.has('--build');
const runBuilds = args.has('--build');
const outputArg = process.argv.find((value) => value.startsWith('--output='));

function command(name, commandArgs, options = {}) {
  try {
    return {
      ok: true,
      value: execFileSync(name, commandArgs, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
      }).trim(),
    };
  } catch (error) {
    const details = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
    return { ok: false, value: details.slice(-2000) };
  }
}

function check(name, ok, details, blocking = true) {
  return { name, status: ok ? 'pass' : blocking ? 'fail' : 'review', details };
}

const head = command('git', ['rev-parse', 'HEAD']);
const branch = command('git', ['branch', '--show-current']);
const status = command('git', ['status', '--porcelain=v1']);
const statusLines = status.value ? status.value.split('\n').filter(Boolean) : [];
const untracked = statusLines.filter((line) => line.startsWith('?? '));
const trackedChanges = statusLines.filter((line) => !line.startsWith('?? '));
const worktreeClean = statusLines.length === 0;
const worktreeDetails = worktreeClean
  ? 'clean'
  : `${statusLines.length} changed paths (${untracked.length} untracked, ${trackedChanges.length} tracked)${allowDirty ? '; allowed for local review only' : ''}`;

const checks = [
  check('git', head.ok && branch.ok, head.ok && branch.ok ? `${branch.value || 'detached'} @ ${head.value}` : head.value, true),
  worktreeClean
    ? check('worktree', true, worktreeDetails)
    : allowDirty
      ? { name: 'worktree', status: 'review', details: worktreeDetails }
      : check('worktree', false, worktreeDetails),
];

const lockfile = existsSync(resolve(root, 'pnpm-lock.yaml'));
checks.push(check('dependency-lock', lockfile, lockfile ? 'pnpm-lock.yaml present' : 'pnpm-lock.yaml is missing'));

const schema = resolve(root, 'apps/server/prisma/schema.prisma');
const migrationDir = resolve(root, 'apps/server/prisma/migrations');
const migrationLock = resolve(migrationDir, 'migration_lock.toml');
const generatedClient = resolve(root, 'apps/server/prisma/generated/prisma/client.ts');
checks.push(check('prisma-files', existsSync(schema) && existsSync(migrationLock) && existsSync(generatedClient),
  `schema=${existsSync(schema)} migrations-lock=${existsSync(migrationLock)} generated-client=${existsSync(generatedClient)}`));

const envTemplate = resolve(root, 'apps/server/.env.dev.example');
const envText = existsSync(envTemplate) ? readFileSync(envTemplate, 'utf8') : '';
const envKeys = [...new Set([...envText.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]))];
checks.push(check('environment-template', envKeys.length > 0, envKeys.length ? `${envKeys.length} documented keys; values are not printed` : 'server environment template is missing or empty'));

if (runChecks) {
  // Prisma is a workspace dependency of the server package and its config
  // requires DATABASE_URL even though validate does not connect to a database.
  // Use the documented local shape as a harmless fallback; never print it.
  const prisma = command(
    'pnpm',
    ['--filter', 'server', 'exec', 'prisma', 'validate', '--schema', 'prisma/schema.prisma'],
    { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://quickvoice:quickvoice@localhost:5432/quickvoice' } },
  );
  checks.push(check('prisma-validate', prisma.ok, prisma.ok ? 'schema validated' : prisma.value));
  for (const packageName of ['server', 'console']) {
    const result = command('pnpm', ['--filter', packageName, 'check-types']);
    checks.push(check(`${packageName}-types`, result.ok, result.ok ? 'type check passed' : result.value));
  }
}
if (runBuilds) {
  for (const packageName of ['server', 'console']) {
    const result = command('pnpm', ['--filter', packageName, 'build']);
    checks.push(check(`${packageName}-build`, result.ok, result.ok ? 'build passed' : result.value));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  repository: { branch: branch.value || null, commit: head.value || null },
  mode: { allowDirty, checks: runChecks, builds: runBuilds },
  checks,
  // --allow-dirty only makes local inspection possible; it must never turn a
  // mixed worktree into a publishable artifact.
  releaseAllowed: worktreeClean && checks.every((item) => item.status === 'pass'),
  localReviewAllowed: allowDirty,
  boundary: {
    deployed: false,
    realTelephonyTested: false,
    providerCredentialsPrinted: false,
    note: '此报告只检查发布基线，不代表已部署、已验收真实通话或已通过供应商联调。',
  },
};

const serialized = JSON.stringify(report, null, 2);
if (outputArg) {
  const destination = resolve(root, outputArg.slice('--output='.length));
  writeFileSync(destination, `${serialized}\n`, 'utf8');
  console.log(`release baseline report: ${destination}`);
} else {
  console.log(serialized);
}
if (!report.releaseAllowed && !allowDirty) process.exitCode = 1;
