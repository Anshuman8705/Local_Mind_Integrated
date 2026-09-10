// Download everything a student can study offline, and keep it fresh.
//
// One request to /api/student/offline/ returns the student's own GET
// responses (subjects, books, every open module with its text, lesson and
// quizzes, the latest tutor conversation per module), keyed by the path the
// app asks for. They are written to the device store; the API client answers
// from there whenever the server cannot be reached.
//
// Runs when a student signs in or the app starts online, when the server
// becomes reachable again after being offline, when the app returns to the
// foreground, and every ten minutes while it stays open.
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { onConnectivityChange } from "./connectivity";
import { META, readEntry, writeEntry, writeMany } from "./store";

interface Bundle { version: string; generated_at: string; entries: Record<string, unknown> }
export interface SyncState { running: boolean; lastSync: string | null; error: string | null }

let state: SyncState = { running: false, lastSync: null, error: null };
const listeners = new Set<(s: SyncState) => void>();
function publish(next: Partial<SyncState>) { state = { ...state, ...next }; listeners.forEach((l) => l(state)); }

let inflight: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    publish({ running: true, error: null });
    try {
      const bundle = await api<Bundle>("/student/offline/", { cacheOffline: false });
      const previous = await readEntry<string>(META.version);
      if (bundle.version !== previous) await writeMany(bundle.entries);
      const now = new Date().toISOString();
      await writeEntry(META.version, bundle.version);
      await writeEntry(META.lastSync, now);
      publish({ running: false, lastSync: now });
    } catch (e) {
      publish({ running: false, error: e instanceof Error ? e.message : String(e) });
    } finally { inflight = null; }
  })();
  return inflight;
}

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

/** Start keeping this student's offline copy fresh. */
export async function startOfflineSync() {
  stopOfflineSync();
  publish({ lastSync: (await readEntry<string>(META.lastSync)) ?? null });
  void syncNow();
  timer = setInterval(() => { void syncNow(); }, 10 * 60 * 1000);
  unsubscribe = onConnectivityChange((online) => { if (online) void syncNow(); });
}

export function stopOfflineSync() {
  if (timer) { clearInterval(timer); timer = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

export function useSyncState(): SyncState {
  const [value, setValue] = useState(state);
  useEffect(() => { listeners.add(setValue); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
