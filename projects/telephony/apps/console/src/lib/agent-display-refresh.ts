/*
 * 中文导读：共享基础能力：agent-display-refresh.ts。相关类型、配置或辅助实现集中在本文件。
 */
"use client";

import type { QueryClient } from "@tanstack/react-query";

const storageKey = "taigua:agent-display:v1";

function invalidateDisplays(client: QueryClient, user: string, org: string) {
  // Personal editors keep their unsaved form state. Refresh display consumers only.
  for (const key of [["agents"], ["my-voice"], ["calls"], ["dashboard"], ["outbound"], ["aliyun", "tasks"], ["telephony", user, org, "tasks"]]) {
    void client.invalidateQueries({ queryKey: key });
  }
}

export function refreshAgentDisplays(client: QueryClient, user: string, org: string) {
  invalidateDisplays(client, user, org);
  try { localStorage.setItem(storageKey, JSON.stringify({ user, org, at: Date.now() })); }
  catch { /* The current page still refreshes when browser storage is unavailable. */ }
}

export function listenForAgentDisplayChanges(client: QueryClient, user: string, org: string) {
  const receive = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    try {
      const value: unknown = JSON.parse(event.newValue);
      if (!value || typeof value !== "object") return;
      const change = value as Record<string, unknown>;
      if (change.user === user && change.org === org && typeof change.at === "number") invalidateDisplays(client, user, org);
    } catch { /* Ignore unrelated or invalid browser storage. */ }
  };
  window.addEventListener("storage", receive);
  return () => window.removeEventListener("storage", receive);
}
