import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = path.resolve(projectRoot, '..', '..');

/** @param {Record<string,string>} environment */
export async function startApplication(environment = {}) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const directory = fs.mkdtempSync(path.join(workspaceRoot, 'data', 'temporary', 'outreach-test-'));
  const logs = path.join(workspaceRoot, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const log = fs.openSync(path.join(logs, 'outreach-tests.log'), 'a');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, OUTREACH_DATA_DIR: directory, WA_PORT: String(port), OUTREACH_DISABLE_JOBS: '1', NODE_ENV: 'test', ...environment },
  });
  fs.closeSync(log);
  const base = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null) throw new Error('拓客测试服务提前退出，请检查 logs/outreach-tests.log');
    if (await fetch(base + '/healthz').then((response) => response.ok).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!await fetch(base + '/healthz').then((response) => response.ok).catch(() => false)) {
    child.kill();
    throw new Error('拓客测试服务启动超时');
  }
  return {
    base, directory,
    async close() {
      if (child.exitCode !== null) return;
      child.kill();
      await once(child, 'exit');
    },
  };
}

/** @param {string} base @param {string} route @param {object} [body] @param {string} [token] @param {Record<string,string>} [headers] @param {string} [method] */
export async function request(base, route, body, token, headers = {}, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, headers: response.headers, body: payload };
}
