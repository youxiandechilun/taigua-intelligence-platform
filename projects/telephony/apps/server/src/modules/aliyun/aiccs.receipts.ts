/*
 * 中文导读：阿里云连接：aiccs.receipts.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { Router, json as bodyParser } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import prisma from "../../config/prisma.js";
import { saveCall, syncTask } from "./aiccs.service.js";
import type { Recipient } from "./aliyun.service.js";
import type { Prisma } from "../../../prisma/generated/prisma/client.js";
const itemSchema = z.object({ taskId: z.string().min(1).max(200), outId: z.string().max(200).optional(), callId: z.string().min(1).max(200) }).passthrough();
const batchSchema = z.array(itemSchema).max(100);
export const receiptsRouter = Router();
receiptsRouter.use('/:kind/:token', (req, res, next) => {
  const token = process.env.AICCS_CALLBACK_TOKEN || "";
  const received = typeof req.params.token === "string" ? req.params.token : "";
  const expectedBytes = Buffer.from(token);
  const receivedBytes = Buffer.from(received);
  const equal = token.length >= 32 && receivedBytes.length === expectedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
  if (!equal) { res.status(401).json({ code: 1, msg: "认证失败" }); return; }
  if (!["report", "record", "note"].includes(String(req.params.kind))) { res.status(404).end(); return; }
  // Only structural diagnostics; never log URLs, tokens, phone numbers or body values.
  res.on('finish', () => console.info('[aiccs-receipt]', JSON.stringify({ method: req.method, kind: req.params.kind, status: res.statusCode, json: req.is('application/json') === 'application/json', batch: Array.isArray(req.body), count: Array.isArray(req.body) ? req.body.length : undefined, fields: ['taskId', 'outId', 'callId', 'test'].filter(k => { const v = Array.isArray(req.body) ? req.body[0] : req.body; return v && typeof v === 'object' && k in v; }) })));
  next();
});
// Connectivity checks are authenticated and never create call records.
receiptsRouter.get('/:kind/:token', (_req, res) => { res.json({ code: 0, msg: "接收端可用" }); });
receiptsRouter.post('/:kind/:token', bodyParser({ limit: '512kb' }), async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ code: 1, msg: "回执格式不正确" }); return; }
  if (!parsed.data.length) { res.json({ code: 0, msg: "接收成功" }); return; }
  try {
    const kind = String(req.params.kind);
    // Inbox insert precedes ACK; retries insert identical rows only once.
    await prisma.aliyunReceipt.createMany({ data: parsed.data.map(payload => ({ id: createHash('sha256').update(kind + JSON.stringify(payload)).digest('hex'), kind, payload: payload as Prisma.InputJsonValue })), skipDuplicates: true });
    res.json({ code: 0, msg: "接收成功" });
  } catch { res.status(503).json({ code: 1, msg: "暂时无法接收，请重推" }); }
});
const toDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return undefined;
  const date = new Date(value.replace(' ', 'T') + '+08:00');
  return Number.isNaN(date.getTime()) ? undefined : date;
};
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let current: Promise<void> | undefined;
async function processInbox() {
  if (running) return;
  running = true;
  try {
    const rows = await prisma.aliyunReceipt.findMany({ where: { processedAt: null, attempts: { lt: 360 } }, orderBy: { receivedAt: 'asc' }, take: 100 });
    for (const row of rows) {
      try {
        const p = itemSchema.parse(row.payload);
        const tasks = await prisma.aliyunTask.findMany({ where: { provider: 'aiccs', remoteId: p.taskId }, take: 2 });
        const task = tasks.length === 1 ? tasks[0] : undefined;
        const recipient = task && (task.recipients as unknown as Recipient[]).find(r => r.referenceId === p.outId);
        if (!task || !recipient) {
          await prisma.aliyunReceipt.update({ where: { id: row.id }, data: { processedAt: new Date(), errorCode: 'UNOWNED_RECEIPT' } });
          continue;
        }
        if (row.kind === 'report') {
          if (typeof p.callee !== 'string' || p.callee !== recipient.phoneNumber) throw new Error('RECIPIENT_MISMATCH');
          const duration = typeof p.duration === 'number' && Number.isInteger(p.duration) && p.duration >= 0 ? p.duration : 0;
          await saveCall(task, recipient, { callId: p.callId, duration, status: p.smartStatusCode === 'ANSWERED' || duration > 0 ? 'COMPLETED' : 'NOT_ANSWERED', startTime: toDate(p.startTime) || toDate(p.originateTime), endTime: toDate(p.endTime) });
        } else {
          const existing = await prisma.callLog.findUnique({ where: { callId: recipient.referenceId } });
          if (!existing) throw new Error('WAITING_FOR_REPORT');
          if (existing.sessionId !== p.callId) throw new Error('RECIPIENT_MISMATCH');
          if (!existing.deleted) await saveCall(task, recipient, { callId: p.callId, duration: existing.durationSeconds || 0, status: existing.status === 'COMPLETED' ? 'COMPLETED' : existing.status === 'FAILED' ? 'FAILED' : 'NOT_ANSWERED', recording: row.kind === 'record' && typeof p.recordFile === 'string' ? p.recordFile : undefined, conversation: row.kind === 'note' && typeof p.conversationRecord === 'string' ? p.conversationRecord : undefined, intent: typeof p.majorIntent === 'string' ? p.majorIntent : undefined, note: row.kind === 'note' ? p.outputTags : undefined });
        }
        await prisma.aliyunReceipt.update({ where: { id: row.id }, data: { processedAt: new Date(), errorCode: null } });
      } catch (e) { await prisma.aliyunReceipt.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, errorCode: e instanceof Error && ['WAITING_FOR_REPORT','RECIPIENT_MISMATCH'].includes(e.message) ? e.message : 'PROCESSING_FAILED' } }); }
    }
  } finally { running = false; }
}
let lastSync = 0;
let ticking = false;
export function startReceiptWorker() {
  if (timer) return;
  timer = setInterval(() => { if (ticking) return; ticking = true; current = (async () => {
    await processInbox();
    if (Date.now() - lastSync < 60000) return;
    lastSync = Date.now();
    const tasks = await prisma.aliyunTask.findMany({ where: { provider: 'aiccs', remoteId: { not: null }, status: { in: ['SUBMITTED', 'RUNNING'] } }, take: 20, orderBy: { syncedAt: { sort: 'asc', nulls: 'first' } } });
    for (const task of tasks) { try { await syncTask(task); } catch { /* Provider failures leave status unchanged for later read-only sync. */ } }
  })().catch(() => { console.warn('[aiccs] receipt processing unavailable'); }).finally(() => { ticking = false; }); }, 10000);
  timer.unref();
}
export async function stopReceiptWorker() { if (timer) clearInterval(timer); timer = undefined; await current; }
