/*
 * 中文导读：数字员工与话术的 use-script-recordings 组件，封装该界面的展示与交互。
 */
"use client";

import type { ConversationPlaybook } from "@/src/lib/api/resources/playbook";
import { loadCloudRecordings, uploadRecordingManifest } from "./recording-cloud";
import { useCallback, useEffect, useRef, useState } from "react";

export type OpeningRecordingClip = {
  id: string;
  voiceId?: string;
  blob: Blob;
  fileName: string;
  transcript: string;
};

export type ScriptRecording = {
  mode: "recording-first" | "ai";
  blob?: Blob;
  direct?: boolean;
  phrases?: string[];
  asset?: {assetId:string;voiceId:string;textHash:string};
  fileName?: string;
  transcript?: string;
  updatedAt?: string;
  openingClips?: OpeningRecordingClip[];
  openingPlayback?: "random" | "fixed";
  selectedOpeningId?: string;
};

export const openingRecordingKey = "opening-recordings";

/** Keep single-recording drafts usable when opening recordings become a list. */
export function openingClips(entry: ScriptRecording | undefined): OpeningRecordingClip[] {
  if (entry?.openingClips) return entry.openingClips;
  return entry?.blob ? [{ id: "original-opening", blob: entry.blob, fileName: entry.fileName || "开场录音", transcript: entry.transcript || "" }] : [];
}

export function withOpeningClips(entry: ScriptRecording, clips: OpeningRecordingClip[]): ScriptRecording {
  return {
    mode: "recording-first",
    openingClips: clips,
    openingPlayback: entry.openingPlayback || "random",
    selectedOpeningId: clips.some(clip => clip.id === entry.selectedOpeningId) ? entry.selectedOpeningId : clips[0]?.id,
  };
}

export function chooseOpeningClip(entry: ScriptRecording | undefined, text: string): OpeningRecordingClip | undefined {
  const clips = openingClips(entry);
  if (entry?.openingPlayback === "fixed") {
    const selected = clips.find(clip => clip.id === entry.selectedOpeningId) || clips[0];
    return !text.trim() || selected?.transcript.trim() === text.trim() ? selected : undefined;
  }
  const ready = clips.filter(clip => !text.trim() || clip.transcript.trim() === text.trim());
  return ready[Math.floor(Math.random() * ready.length)];
}

type Entries = Record<string, ScriptRecording>;
type Draft = {
  scope: string;
  entries: Entries;
  dirty: boolean;
  saving: boolean;
  revision: number;
  storageRevision: number;
  error: string;
};
type View = Draft & { loading: boolean };

const databaseName = "taigua-local-script-recordings";
const storeName = "script-drafts";
class RecordingStorageError extends Error {}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new RecordingStorageError("当前浏览器不支持本地录音存储，请更换浏览器后重试。"));
      return;
    }
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "scope" });
      }
    };
    request.onblocked = () => {
      settled = true;
      reject(new RecordingStorageError("本地录音存储被其他页面占用，请关闭其他预览页面后重试。"));
    };
    request.onerror = () => {
      settled = true;
      reject(new RecordingStorageError("无法打开本地录音存储，请检查浏览器的存储权限。"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function storageError(error: unknown, fallback: string): Error {
  if (error && typeof error === "object" && "name" in error) {
    if (error.name === "QuotaExceededError") {
      return new RecordingStorageError("本地存储空间不足，录音草稿仍保留在当前页面，请腾出空间后重试。");
    }
    if (["SecurityError", "NotAllowedError"].includes(String(error.name))) {
      return new RecordingStorageError("浏览器未允许本地存储，请开放存储权限后重试。");
    }
  }
  return new RecordingStorageError(fallback);
}

function validEntries(value: unknown): Entries {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Entries = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || !("mode" in raw)) continue;
    const recording = raw as ScriptRecording;
    if (recording.mode !== "recording-first" && recording.mode !== "ai") continue;
    Object.defineProperty(entries, key, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        mode: recording.mode,
        ...(recording.direct ? { direct:true, phrases:Array.isArray(recording.phrases)?recording.phrases.filter(p=>typeof p==="string").slice(0,20):[], asset:recording.asset } : {}),
        ...(recording.blob instanceof Blob ? { blob: recording.blob } : {}),
        ...(typeof recording.fileName === "string" ? { fileName: recording.fileName } : {}),
        ...(typeof recording.transcript === "string" ? { transcript: recording.transcript } : {}),
        ...(typeof recording.updatedAt === "string" ? { updatedAt: recording.updatedAt } : {}),
        ...(Array.isArray(recording.openingClips) ? { openingClips: recording.openingClips.filter(clip => clip && typeof clip.id === "string" && clip.blob instanceof Blob && typeof clip.fileName === "string" && typeof clip.transcript === "string").filter((clip, index, clips) => clips.findIndex(other => other.id === clip.id) === index).map(clip => ({ id: clip.id, blob: clip.blob, fileName: clip.fileName, transcript: clip.transcript, ...(typeof clip.voiceId==='string'?{voiceId:clip.voiceId}:{}) })) } : {}),
        ...(recording.openingPlayback === "random" || recording.openingPlayback === "fixed" ? { openingPlayback: recording.openingPlayback } : {}),
        ...(typeof recording.selectedOpeningId === "string" ? { selectedOpeningId: recording.selectedOpeningId } : {}),
      },
    });
  }
  return entries;
}

async function readEntries(scope: string): Promise<{ entries: Entries; storageRevision: number }> {
  const database = await openDatabase();
  try {
    return await new Promise<{ entries: Entries; storageRevision: number }>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(scope);
      transaction.oncomplete = () => resolve({ entries: validEntries(request.result?.entries), storageRevision: Number.isSafeInteger(request.result?.storageRevision) ? request.result.storageRevision : 0 });
      transaction.onerror = () => reject(storageError(transaction.error, "读取本地录音草稿失败，请刷新后重试。"));
      transaction.onabort = () => reject(storageError(transaction.error, "读取本地录音草稿已中断，请刷新后重试。"));
    });
  } finally {
    database.close();
  }
}

async function writeEntries(scope: string, entries: Entries, storageRevision: number): Promise<number> {
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      // One scope is replaced as a single record, including all audio blobs.
      // IndexedDB commits the complete snapshot or keeps the previous snapshot.
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(scope);
      let failure: Error | undefined;
      request.onsuccess = () => {
        const existingRevision = Number.isSafeInteger(request.result?.storageRevision) ? request.result.storageRevision : 0;
        if (existingRevision !== storageRevision) {
          failure = new RecordingStorageError("其他页面已更新这位员工的录音，未覆盖已保存内容。当前修改仍保留，请先备份当前录音，再重新打开页面。");
          transaction.abort();
          return;
        }
        try {
          store.put({ scope, entries, version: 1, storageRevision: storageRevision + 1, updatedAt: new Date().toISOString() });
        } catch (error) {
          failure = storageError(error, "保存录音失败，当前修改仍保留，请重试。");
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(storageRevision + 1);
      transaction.onerror = () => reject(storageError(transaction.error, "保存本地录音草稿失败，当前修改仍保留，请重试。"));
      transaction.onabort = () => reject(failure || storageError(transaction.error, "保存已中断，当前录音修改仍保留，请重试。"));
    });
  } finally {
    database.close();
  }
}

function emptyView(scope: string): View {
  return { scope, entries: {}, loading: true, dirty: false, saving: false, revision: 0, storageRevision: 0, error: "" };
}

/** Local preview only: this hook never sends recordings or configuration to an API. */
export function useScriptRecordings(scope: string, playbook?: ConversationPlaybook) {
  const [view, setView] = useState<View>(() => emptyView(scope));
  const drafts = useRef(new Map<string, Draft>());
  const reads = useRef(new Map<string, Promise<Draft>>());
  const activeScope = useRef(scope);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const updateDraft = useCallback((draftScope: string, update: (current: Draft) => Draft) => {
    const current = drafts.current.get(draftScope);
    if (!current) return;
    const next = update(current);
    drafts.current.set(draftScope, next);
    if (mounted.current && activeScope.current === draftScope) setView({ ...next, loading: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    activeScope.current = scope;
    if (!scope.trim()) {
      setView({ ...emptyView(scope), loading: false, error: "请先登录并选择数字员工，再设置话术录音。" });
      return;
    }
    const cached = drafts.current.get(scope);
    if (cached) {
      setView({ ...cached, loading: false });
      return;
    }
    setView(emptyView(scope));
    let pending = reads.current.get(scope);
    if (!pending) {
      pending = readEntries(scope).then(async ({ entries, storageRevision }) => {
        if(playbook?.recordingReplies){try{entries=await loadCloudRecordings(scope,playbook.recordingReplies,playbook);}catch(error){if(process.env.NEXT_PUBLIC_LOCAL_PREVIEW!=="true"||!Object.keys(entries).length)throw error;}}
        const draft: Draft = { scope, entries, dirty: false, saving: false, revision: 0, storageRevision, error: "" };
        // A delayed read must not replace a newer in-memory draft for this scope.
        if (!drafts.current.has(scope)) drafts.current.set(scope, draft);
        return drafts.current.get(scope)!;
      });
      reads.current.set(scope, pending);
    }
    void pending.then(
      draft => { if (!cancelled && mounted.current) setView({ ...draft, loading: false }); },
      error => {
        if (!cancelled && mounted.current) {
          setView({ ...emptyView(scope), loading: false, error: error instanceof RecordingStorageError ? error.message : storageError(error, "读取本地录音草稿失败，请刷新后重试。").message });
        }
      },
    ).finally(() => {
      if (reads.current.get(scope) === pending) reads.current.delete(scope);
    });
    return () => { cancelled = true; };
  }, [scope]);

  const setEntry = useCallback((key: string, value: ScriptRecording) => {
    if (activeScope.current !== scope || !key) return;
    updateDraft(scope, current => {
      const previous = current.entries[key];
      if (previous?.mode === value.mode && previous.blob === value.blob && previous.fileName === value.fileName && previous.transcript === value.transcript && previous.openingClips === value.openingClips && previous.openingPlayback === value.openingPlayback && previous.selectedOpeningId === value.selectedOpeningId && previous.direct === value.direct && previous.phrases === value.phrases && previous.asset === value.asset) return current;
      return {
        ...current,
        entries: { ...current.entries, [key]: { ...value, updatedAt: new Date().toISOString() } },
        dirty: true,
        revision: current.revision + 1,
        error: "",
      };
    });
  }, [scope, updateDraft]);

  const moveEntry = useCallback((from: string, to: string) => {
    if (activeScope.current !== scope || from === to) return;
    updateDraft(scope, current => {
      if (!current.entries[from] || current.entries[to]) return current;
      const entries = { ...current.entries, [to]: current.entries[from] };
      delete entries[from];
      return { ...current, entries, dirty: true, revision: current.revision + 1, error: "" };
    });
  }, [scope, updateDraft]);

  const save = useCallback(async (): Promise<boolean> => {
    const snapshot = drafts.current.get(scope);
    if (activeScope.current !== scope || !snapshot || snapshot.saving) return false;
    if (!snapshot.dirty) return true;
    updateDraft(scope, current => ({ ...current, saving: true, error: "" }));
    try {
      const storageRevision = await writeEntries(scope, snapshot.entries, snapshot.storageRevision);
      updateDraft(scope, current => ({ ...current, storageRevision, saving: false, dirty: current.revision !== snapshot.revision, error: "" }));
      return true;
    } catch (error) {
      updateDraft(scope, current => ({
        ...current,
        saving: false,
        dirty: true,
        error: error instanceof RecordingStorageError ? error.message : storageError(error, "保存本地录音草稿失败，当前修改仍保留，请重试。").message,
      }));
      return false;
    }
  }, [scope, updateDraft]);

  const current = view.scope === scope ? view : emptyView(scope);
  return {
    manifest: (playbook:ConversationPlaybook) => uploadRecordingManifest(scope,current.entries,playbook),
    entries: current.entries,
    loading: current.loading,
    dirty: current.dirty,
    saving: current.saving,
    error: current.error,
    setEntry,
    moveEntry,
    save,
  };
}
