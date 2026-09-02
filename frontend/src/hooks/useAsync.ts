import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/api/client";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await fn(); if (alive.current) setData(d); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; void run(); return () => { alive.current = false; }; }, [run]);
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
