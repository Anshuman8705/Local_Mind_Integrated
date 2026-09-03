import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { errorMessage } from "@/api/client";

/**
 * Load data for a screen. Runs on mount, whenever `deps` change, and again
 * every time the screen regains focus. Tab screens stay mounted while the
 * user is on another route, so without the focus reload a list (people,
 * subjects, assigned faculty) kept showing what it had when it first
 * loaded and needed a manual page refresh after adding a record.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const mounted = useRef(false);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await fn(); if (alive.current) setData(d); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; mounted.current = true; void run(); return () => { alive.current = false; }; }, [run]);
  // On the web build there is no pull-to-refresh and no app-state change to
  // hook into, so a student who leaves the tab open would keep seeing stale
  // lists. Refetch when the browser tab or window comes back into view.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const doc = (globalThis as unknown as { document?: { addEventListener: Function; removeEventListener: Function; visibilityState?: string } }).document;
    const win = globalThis as unknown as { addEventListener?: Function; removeEventListener?: Function };
    if (!doc || typeof win.addEventListener !== "function") return;
    const onVisible = () => { if (doc.visibilityState === "visible") void run(); };
    doc.addEventListener("visibilitychange", onVisible);
    win.addEventListener("focus", onVisible);
    return () => { doc.removeEventListener("visibilitychange", onVisible); win.removeEventListener!("focus", onVisible); };
  }, [run]);
  useFocusEffect(useCallback(() => {
    // The mount effect above already fetched on first focus; refetch on
    // every later focus so navigating back shows fresh server state.
    if (mounted.current) { mounted.current = false; return; }
    void run();
  }, [run]));
  return { data, error, loading, reload: run, setData };
}

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(...args); } catch (e) { setError(errorMessage(e)); return undefined; } finally { setBusy(false); }
  }, [fn]);
  return { run, busy, error, setError };
}
