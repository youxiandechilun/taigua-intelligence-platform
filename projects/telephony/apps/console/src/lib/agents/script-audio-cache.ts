/*
 * 中文导读：数字员工与话术：script-audio-cache.ts。相关类型、配置或辅助实现集中在本文件。
 */
"use client";

import type { AgentVoicePreview } from "../api/resources/telephony";
import { ApiError } from "../errors";

type CacheStatus = "PENDING" | "UNKNOWN" | "GENERATING" | "NEEDS_REVIEW" | "REJECTED" | "READY";
type CacheEntry = {
  version: 1;
  key: string;
  scope: string;
  signature: string;
  requestId: string;
  status: CacheStatus;
  blob?: Blob;
  error: string;
  updatedAt: string;
};
export type ScriptAudioIdentity = { key: string; scope: string; signature: string };
export type CachedScriptAudio = { blob: Blob; cached: boolean; warning?: string };
/** Only thrown synchronously before the API call; it never describes a sent request. */
export class CancelledBeforeSubmitError extends Error {
  constructor() {
    super("已停止试听准备，未提交语音生成。");
    this.name = "CancelledBeforeSubmitError";
  }
}

const databaseName = "taigua-local-script-audio";
const storeName = "generated-clips";
const uncertainMessage = "上次生成结果未确认，已停止重复生成，请先核对用量。";
const inFlight = new Map<string, Promise<CachedScriptAudio>>();
// A quota/storage failure must never cause another synthesis in this page.
// Durable PENDING records also prevent another tab or a reload resubmitting it.
const unsavedAudio = new Map<string, CachedScriptAudio>();

function cacheError(message: string, error?: unknown): Error {
  if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError") {
    return new Error("浏览器存储空间不足，尚未提交新的语音生成，请腾出空间后重试。");
  }
  return new Error(message);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("浏览器不支持保存试听音频，已停止生成，请更换浏览器。"));
      return;
    }
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "key" });
      }
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("试听音频存储被其他页面占用，请关闭其他预览页后重试。"));
    };
    request.onerror = () => {
      settled = true;
      reject(cacheError("无法打开试听音频存储，已停止生成，请检查浏览器存储权限。", request.error));
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function validEntry(value: unknown, identity: ScriptAudioIdentity): value is CacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CacheEntry>;
  return entry.version === 1 && entry.key === identity.key && entry.scope === identity.scope &&
    entry.signature === identity.signature && typeof entry.requestId === "string" &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(entry.requestId) &&
    ["PENDING", "UNKNOWN", "GENERATING", "NEEDS_REVIEW", "REJECTED", "READY"].includes(entry.status || "") &&
    typeof entry.error === "string" && (entry.status !== "READY" || entry.blob instanceof Blob);
}

// Reading and reserving the first request ID happen atomically. Without Web
// Locks, a second tab sees PENDING and stops rather than submitting another POST.
async function reserve(identity: ScriptAudioIdentity): Promise<{ entry: CacheEntry; created: boolean }> {
  const database = await openDatabase();
  try {
    return await new Promise<{ entry: CacheEntry; created: boolean }>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(identity.key);
      let result: { entry: CacheEntry; created: boolean } | undefined;
      let failure: Error | undefined;
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            if (!validEntry(request.result, identity)) throw new Error("已有试听缓存无法核对，已停止重复生成，请联系管理员检查。");
            if (request.result.status !== "REJECTED") {
              result = { entry: request.result, created: false };
              return;
            }
          }
          const entry: CacheEntry = { ...identity, version: 1, requestId: crypto.randomUUID(), status: "PENDING", error: "", updatedAt: new Date().toISOString() };
          if (request.result === undefined) store.add(entry);
          else store.put(entry);
          result = { entry, created: true };
        } catch (error) {
          failure = error instanceof Error ? error : cacheError("无法保存试听请求，尚未提交生成。", error);
          transaction.abort();
        }
      };
      transaction.oncomplete = () => result ? resolve(result) : reject(new Error("未能保存试听请求，尚未提交生成。"));
      transaction.onerror = () => reject(cacheError("无法保存试听请求，尚未提交生成。", transaction.error));
      transaction.onabort = () => reject(failure || cacheError("试听请求保存已中断，尚未提交生成。", transaction.error));
    });
  } finally { database.close(); }
}

async function save(entry: CacheEntry): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(entry.key);
      let failure: Error | undefined;
      request.onsuccess = () => {
        try {
          if (!validEntry(request.result, entry) || request.result.requestId !== entry.requestId) {
            throw new Error("试听请求记录已变化，请核对生成结果。");
          }
          store.put(entry);
        } catch (error) {
          failure = error instanceof Error ? error : new Error("试听音频未能保存。");
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("试听音频未能保存到浏览器。"));
      transaction.onabort = () => reject(failure || new Error("试听音频保存已中断。"));
    });
  } finally { database.close(); }
}

async function generateOnce(identity: ScriptAudioIdentity, generate: (requestId: string) => Promise<AgentVoicePreview>, decode: (audio: string) => Blob): Promise<CachedScriptAudio> {
  const memory = unsavedAudio.get(identity.key);
  if (memory) return memory;
  const { entry, created } = await reserve(identity);
  if (entry.status === "READY" && entry.blob) return { blob: entry.blob, cached: true };
  // The existing POST can charge again after its server cache is evicted.
  // There is no read-only lookup endpoint, so no uncertain record is reposted.
  if (!created) throw new Error(entry.status === "NEEDS_REVIEW" ? (entry.error || "上次试听需要核对，已停止重复生成，请先核对用量。") : uncertainMessage);

  let result: AgentVoicePreview;
  try { result = await generate(entry.requestId); }
  catch (error) {
    if (error instanceof CancelledBeforeSubmitError) {
      // Nothing left the browser. A later explicit click can reserve a fresh
      // ID, while a submitted request always follows the conservative path.
      await save({ ...entry, status: "REJECTED", error: error.message, updatedAt: new Date().toISOString() }).catch(() => {});
      throw error;
    }
    // These HTTP errors are returned by auth, validation, model authorization,
    // or request-rate preflight. Synthesis failures are returned as a 200 result
    // with NEEDS_REVIEW. Never infer rejection from network/5xx/409 failures.
    if (error instanceof ApiError && [400, 401, 403, 404, 413, 422, 429].includes(error.status)) {
      await save({ ...entry, status: "REJECTED", error: error.message, updatedAt: new Date().toISOString() }).catch(() => {});
      throw error;
    }
    await save({ ...entry, status: "UNKNOWN", error: uncertainMessage, updatedAt: new Date().toISOString() }).catch(() => {});
    const cause = error instanceof Error ? error.message : "试听请求未返回结果。";
    throw new Error(cause + " " + uncertainMessage);
  }
  if (result.status !== "READY" || !result.audio) {
    const status = result.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : result.status === "GENERATING" ? "GENERATING" : "UNKNOWN";
    const message = (result.error ? result.error + " " : "") + uncertainMessage;
    await save({ ...entry, status, error: message, updatedAt: new Date().toISOString() }).catch(() => {});
    throw new Error(message);
  }
  let blob: Blob;
  try { blob = decode(result.audio); }
  catch (error) {
    await save({ ...entry, status: "UNKNOWN", error: uncertainMessage, updatedAt: new Date().toISOString() }).catch(() => {});
    throw new Error((error instanceof Error ? error.message : "试听音频无法读取。") + " " + uncertainMessage);
  }
  try {
    await save({ ...entry, status: "READY", blob, error: "", updatedAt: new Date().toISOString() });
    return { blob, cached: false };
  } catch {
    const ready = { blob, cached: true, warning: "试听已生成，但本地保存失败。当前页面可继续播放，关闭后请先核对用量，系统不会重复生成。" };
    unsavedAudio.set(identity.key, ready);
    return ready;
  }
}

/** Explicit clicks only. Cache entries are private to their full scope and are never evicted. */
export function cachedScriptAudio(identity: ScriptAudioIdentity, generate: (requestId: string) => Promise<AgentVoicePreview>, decode: (audio: string) => Blob): Promise<CachedScriptAudio> {
  const pending = inFlight.get(identity.key);
  if (pending) return pending;
  const task = (async () => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      // The key contains the exact text/synthesis profile. Hashing only shortens the lock
      // name; the complete signature remains in the stored record and is checked.
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.key));
      const name = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      return navigator.locks.request("taigua-script-audio:" + name, () => generateOnce(identity, generate, decode));
    }
    return generateOnce(identity, generate, decode);
  })();
  inFlight.set(identity.key, task);
  void task.finally(() => { if (inFlight.get(identity.key) === task) inFlight.delete(identity.key); }).catch(() => {});
  return task;
}
